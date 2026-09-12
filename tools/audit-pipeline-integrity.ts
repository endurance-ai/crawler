import {randomUUID} from "node:crypto"
import {mkdir, rename, unlink, writeFile} from "node:fs/promises"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"
import {auditManifestCsv, pipelineAuditHash, type PipelineAuditManifest} from "../src/lib/pipeline-audit"
import {readPipelineAudit} from "../src/lib/pipeline-audit-reader"
import {addPipelineError, createPipelineReport, finalizePipelineReport, writePipelineReport} from "../src/lib/pipeline-report"

async function atomicWrite(filename: string, content: string) {
  const destination = path.resolve(filename)
  const temporary = `${destination}.${randomUUID()}.tmp`
  await mkdir(path.dirname(destination), {recursive: true})
  try {
    await writeFile(temporary, content, {mode: 0o600, flag: "wx"})
    await rename(temporary, destination)
  } finally { await unlink(temporary).catch(() => undefined) }
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--")
  if (args.includes("--help")) {
    console.log("Read-only pipeline audit: --out=manifest.json [--csv=findings.csv] [--report=report.json] [--platform=KEY] [--limit=N] [--max-observation-age-hours=24]. Requires migrations 119–122. No database mutations or model calls.")
    return
  }
  const flags = new Map<string, string>()
  for (const arg of args) {
    const match = /^--(out|csv|report|platform|limit|max-observation-age-hours)=(.+)$/.exec(arg)
    if (!match || flags.has(match[1])) throw new Error("Invalid audit CLI argument")
    flags.set(match[1], match[2])
  }
  const out = flags.get("out")
  if (!out) throw new Error("--out is required")
  const limit = flags.has("limit") ? Number(flags.get("limit")) : undefined
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error("Invalid audit limit")
  const maxAge = Number(flags.get("max-observation-age-hours") ?? 24)
  if (!Number.isFinite(maxAge) || maxAge <= 0) throw new Error("Invalid observation age")
  const reportPath = flags.get("report") ?? `${out}.report.json`
  const outputs = [out, reportPath, flags.get("csv")].filter((value): value is string => value !== undefined).map((value) => path.resolve(value))
  if (new Set(outputs).size !== outputs.length) throw new Error("Audit output destinations must be distinct")
  const report = createPipelineReport({mode: "dry_run"})
  const incomplete: PipelineAuditManifest = {
    schema_version: 1, kind: "pipeline_integrity_audit", generated_at: report.started_at, complete: false,
    scope: {platform: flags.get("platform") ?? null, limit: limit ?? null, max_observation_age_hours: maxAge},
    scanned: {products: 0, candidates: 0, embeddings: 0}, findings: [], content_hash: "",
  }
  incomplete.content_hash = pipelineAuditHash({...incomplete, content_hash: undefined})
  // Invalidate a previous artifact at this destination before attempting a new audit.
  await atomicWrite(out, `${JSON.stringify(incomplete, null, 2)}\n`)
  try {
    if (!process.env.DB_URL || !process.env.DB_TOKEN) throw new Error("Audit database configuration is required")
    const manifest = await readPipelineAudit(createClient(process.env.DB_URL, process.env.DB_TOKEN), {platform: flags.get("platform"), limit, maxObservationAgeHours: maxAge})
    report.counts = {input: manifest.scanned.products + manifest.scanned.candidates, findings: manifest.findings.length}
    report.stages.audit = {status: "success", counts: {...manifest.scanned}}
    await atomicWrite(out, `${JSON.stringify(manifest, null, 2)}\n`)
    if (flags.has("csv")) await atomicWrite(flags.get("csv")!, auditManifestCsv(manifest))
    console.log(`Audit: products=${manifest.scanned.products} candidates=${manifest.scanned.candidates} findings=${manifest.findings.length}; manifest=${out}`)
  } catch {
    await atomicWrite(out, `${JSON.stringify(incomplete, null, 2)}\n`)
    addPipelineError(report, {stage: "audit", code: "AUDIT_INCOMPLETE", message: "Audit read or artifact write failed; no new complete manifest was produced", retryable: true})
    process.exitCode = 1
  }
  await writePipelineReport(reportPath, finalizePipelineReport(report))
}
main().catch(() => { console.error("Invalid audit setup or report destination"); process.exitCode = 2 })
