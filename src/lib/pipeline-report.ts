import {randomUUID} from "node:crypto"
import {mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises"
import * as path from "node:path"
import type {PipelineError, PipelineReport} from "./pipeline-integrity-types"

export function sanitizePipelineMessage(value: string): string {
  return value
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s<>"']+/gi, "[redacted-url]")
    .replace(/\b(?:Bearer\s+)[\w.\-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:[\w-]*(?:token|secret|password|api[_-]?key))\s*[:=]\s*[^\s,;]+/gi, "credential=[redacted]")
    .slice(0, 2000)
}

function sanitizedError(error: PipelineError): PipelineError {
  const result = {...error, message: sanitizePipelineMessage(error.message)}
  if (result.productUrl) {
    try {
      const url = new URL(result.productUrl)
      if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported URL")
      url.username = ""
      url.password = ""
      // Product URLs are diagnostic identifiers; query credentials are unnecessary.
      url.search = ""
      url.hash = ""
      result.productUrl = url.toString()
    } catch {
      delete result.productUrl
    }
  }
  return result
}

export function createPipelineReport(options: {
  mode: PipelineReport["mode"]
  runId?: string
  now?: string
}): PipelineReport {
  return {
    schema_version: 1,
    run_id: options.runId ?? randomUUID(),
    mode: options.mode,
    status: options.mode === "dry_run" ? "planned" : "success",
    started_at: options.now ?? new Date().toISOString(),
    ended_at: null,
    counts: {},
    stages: {},
    errors: [],
    files: [],
  }
}

export function addPipelineError(report: PipelineReport, error: PipelineError): void {
  report.errors.push(sanitizedError(error))
}

export function finalizePipelineReport(
  report: PipelineReport,
  options: {status?: PipelineReport["status"]; now?: string} = {},
): PipelineReport {
  const result = structuredClone(report)
  const incomplete = result.errors.length > 0 ||
    (result.counts.failed ?? 0) > 0 || (result.counts.pending ?? 0) > 0 ||
    result.files.some((file) => file.status === "failed" || file.status === "partial" || file.errors.length > 0) ||
    Object.values(result.stages).some((stage) => stage.status === "failed" || stage.status === "partial") ||
    result.status === "failed" || result.status === "partial" || options.status === "failed" || options.status === "partial"
  const completed = (result.counts.inserted ?? 0) + (result.counts.updated ?? 0) + (result.counts.unchanged ?? 0)
  result.status = incomplete
    ? (completed > 0 || result.files.some((file) => file.status === "success") ? "partial" : "failed")
    : result.mode === "dry_run" ? "planned" : "success"
  result.ended_at = options.now ?? new Date().toISOString()
  result.errors = result.errors.map(sanitizedError)
  result.files = result.files.map((file) => ({...file, errors: file.errors.map(sanitizedError)}))
  return result
}

export function pipelineExitCode(report: PipelineReport): 0 | 1 {
  return report.status === "failed" || report.status === "partial" ? 1 : 0
}

function validCounts(value: unknown): value is Record<string, number> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
}

function validErrors(value: unknown): value is PipelineError[] {
  return Array.isArray(value) && value.every((error) => error &&
    typeof error.stage === "string" && typeof error.code === "string" &&
    typeof error.message === "string" && typeof error.retryable === "boolean" &&
    (error.platform === undefined || typeof error.platform === "string") &&
    (error.productUrl === undefined || typeof error.productUrl === "string") &&
    (error.candidateId === undefined || typeof error.candidateId === "string"))
}

export function validatePipelineReport(value: unknown): asserts value is PipelineReport {
  const report = value as PipelineReport | null
  if (!report || report.schema_version !== 1 || typeof report.run_id !== "string" || !report.run_id ||
    !["apply", "dry_run"].includes(report.mode) || !["success", "partial", "failed", "planned"].includes(report.status) ||
    !Number.isFinite(Date.parse(report.started_at)) || typeof report.ended_at !== "string" ||
    !Number.isFinite(Date.parse(report.ended_at)) || !validCounts(report.counts) || !validErrors(report.errors) ||
    !report.stages || typeof report.stages !== "object" || Array.isArray(report.stages) ||
    !Object.values(report.stages).every((stage) => stage && typeof stage.status === "string" && validCounts(stage.counts)) ||
    !Array.isArray(report.files) || !report.files.every((file) => file && typeof file.platform === "string" &&
      typeof file.status === "string" && validCounts(file.counts) && validErrors(file.errors))) {
    throw new Error("Invalid or incomplete pipeline report")
  }
  if (finalizePipelineReport(report).status !== report.status) throw new Error("Inconsistent pipeline report status")
}

export async function writePipelineReport(filename: string, report: PipelineReport): Promise<void> {
  validatePipelineReport(report)
  const destination = path.resolve(filename)
  await mkdir(path.dirname(destination), {recursive: true})
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(finalizePipelineReport(report, {now: report.ended_at!}), null, 2)}\n`, {mode: 0o600, flag: "wx"})
    await rename(temporary, destination)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error })
  }
}

export async function readPipelineReport(filename: string): Promise<PipelineReport> {
  const report: unknown = JSON.parse(await readFile(filename, "utf8"))
  validatePipelineReport(report)
  return report
}

/** A child process and its report must both confirm completion. */
export function assessPipelineChild(report: PipelineReport | null, code: number | null, expectedPlatforms: string[]): {
  failedPlatforms: string[]
  success: boolean
  applied: number
} {
  if (!report || report.mode !== "apply") return {failedPlatforms: [...expectedPlatforms], success: false, applied: 0}
  try { validatePipelineReport(report) } catch { return {failedPlatforms: [...expectedPlatforms], success: false, applied: 0} }
  const failedPlatforms = expectedPlatforms.filter((platform) => {
    const files = report.files.filter((file) => file.platform === platform)
    return files.length === 0 || files.some((file) => file.status !== "success" || file.errors.length > 0)
  })
  const success = code === 0 && report.status === "success" && failedPlatforms.length === 0
  // A global failure without any file-level explanation (e.g. guardrail) affects all sites.
  if (!success && failedPlatforms.length === 0) failedPlatforms.push(...expectedPlatforms)
  return {failedPlatforms, success, applied: (report.counts.inserted ?? 0) + (report.counts.updated ?? 0) + (report.counts.unchanged ?? 0)}
}
