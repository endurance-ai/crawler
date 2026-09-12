import {randomUUID} from "node:crypto"
import {mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"
import type {PipelineAuditManifest} from "../src/lib/pipeline-audit"
import {runPipelineRecovery, validateRecoveryCheckpoint, validateRecoveryManifest, type RecoveryCheckpoint} from "../src/lib/pipeline-recovery"
import {SupabaseRecoveryStore} from "../src/lib/pipeline-recovery-store"
import {addPipelineError, createPipelineReport, finalizePipelineReport, pipelineExitCode, writePipelineReport} from "../src/lib/pipeline-report"

interface Flags {
  manifest: string
  apply: boolean
  platform?: string
  ids?: Set<string>
  checkpoint?: string
  report?: string
}

function parseArgs(argv: string[]): Flags {
  let manifest: string | undefined
  let apply = false
  let platform: string | undefined
  let checkpoint: string | undefined
  let report: string | undefined
  const ids = new Set<string>()
  for (const arg of argv.filter((value) => value !== "--")) {
    if (arg === "--apply") apply = true
    else if (arg.startsWith("--manifest=") && !manifest) manifest = arg.slice(11)
    else if (arg.startsWith("--platform=") && !platform) platform = arg.slice(11)
    else if (arg.startsWith("--ids=")) {
      for (const id of arg.slice(6).split(",")) {
        if (!/^[1-9]\d*$/.test(id)) throw new Error("Invalid --ids value")
        ids.add(id)
      }
    } else if (arg.startsWith("--checkpoint=") && !checkpoint) checkpoint = arg.slice(13)
    else if (arg.startsWith("--report=") && !report) report = arg.slice(9)
    else throw new Error("Invalid recovery CLI argument")
  }
  if (!manifest) throw new Error("--manifest is required")
  if (!apply && checkpoint) throw new Error("--checkpoint is only valid with --apply")
  return {manifest, apply, ...(platform ? {platform} : {}), ...(ids.size ? {ids} : {}), ...(checkpoint ? {checkpoint} : {}), ...(report ? {report} : {})}
}

async function atomicWrite(filename: string, content: string): Promise<void> {
  const destination = path.resolve(filename)
  await mkdir(path.dirname(destination), {recursive: true})
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, {mode: 0o600, flag: "wx"})
    await rename(temporary, destination)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
  }
}

async function mergeCheckpoint(filename: string, next: RecoveryCheckpoint): Promise<void> {
  let prior: RecoveryCheckpoint | null = null
  try {
    prior = JSON.parse(await readFile(filename, "utf8")) as RecoveryCheckpoint
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (prior && (prior.schema_version !== 1 || prior.kind !== next.kind ||
      prior.manifest_hash !== next.manifest_hash || typeof prior.outcomes !== "object")) {
    throw new Error("Checkpoint does not belong to this manifest")
  }
  await atomicWrite(filename, `${JSON.stringify({
    ...next,
    outcomes: {...(prior?.outcomes ?? {}), ...next.outcomes},
  }, null, 2)}\n`)
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(await readFile(flags.manifest, "utf8")) as PipelineAuditManifest
  validateRecoveryManifest(manifest)
  const checkpointPath = flags.apply
    ? path.resolve(flags.checkpoint ?? `${flags.manifest}.recovery-checkpoint.json`)
    : undefined
  const outputs = [checkpointPath, flags.report].filter((value): value is string => Boolean(value)).map((value) => path.resolve(value))
  if (outputs.includes(path.resolve(flags.manifest)) || new Set(outputs).size !== outputs.length) {
    throw new Error("Manifest, checkpoint, and report paths must be distinct")
  }
  if (checkpointPath) {
    try {
      validateRecoveryCheckpoint(JSON.parse(await readFile(checkpointPath, "utf8")), manifest.content_hash)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  const report = createPipelineReport({mode: flags.apply ? "apply" : "dry_run"})
  const store = flags.apply
    ? (() => {
        if (!process.env.DB_URL || !process.env.DB_TOKEN) throw new Error("Recovery database configuration is required")
        return new SupabaseRecoveryStore(createClient(process.env.DB_URL, process.env.DB_TOKEN))
      })()
    : undefined
  const run = await runPipelineRecovery({
    manifest,
    store,
    apply: flags.apply,
    platform: flags.platform,
    ids: flags.ids,
    onResult: checkpointPath
      ? async (item) => mergeCheckpoint(checkpointPath, {
          schema_version: 1,
          kind: "pipeline_integrity_recovery_checkpoint",
          manifest_hash: manifest.content_hash,
          updated_at: new Date().toISOString(),
          outcomes: {[item.finding_id]: item},
        })
      : undefined,
  })
  report.counts = {
    input: run.results.length,
    inserted: 0,
    updated: run.counts.applied,
    unchanged: run.counts.unchanged,
    policy_excluded: run.counts.deferred,
    failed: run.counts.failed + run.counts.conflicted,
    pending: 0,
    planned: run.counts.planned,
  }
  report.stages.recovery = {
    status: run.status === "incomplete" ? "partial" : "success",
    counts: {...run.counts},
  }
  if (run.status === "incomplete") {
    addPipelineError(report, {
      stage: "recovery",
      code: "RECOVERY_INCOMPLETE",
      message: "One or more manifest actions conflicted or failed",
      retryable: true,
    })
  }
  const finalReport = finalizePipelineReport(report)
  if (flags.report) await writePipelineReport(flags.report, finalReport)
  console.log(JSON.stringify({mode: run.mode, status: run.status, counts: run.counts}))
  process.exitCode = pipelineExitCode(finalReport)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recovery failed")
  process.exitCode = 2
})
