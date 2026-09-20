export type RefreshBatchSourceStatus = "pending" | "running" | "partial" | "success" | "exception"

export type RefreshExceptionCode =
  | "external_block"
  | "endpoint_removed"
  | "config_drift"
  | "transient_exhausted"
  | "db_read_failed"
  | "db_write_failed"
  | "coverage_guard"
  | "source_failed"

export function classifyRefreshException(input: {
  status: string
  errors: string[]
  unreachable: string[]
  dbReadFailed?: boolean
  dbWriteFailed?: boolean
  coverageGuard?: boolean
}): RefreshExceptionCode | null {
  if (input.status === "success" || input.status === "partial") return null
  const messages = [...input.errors, ...input.unreachable]
  if (messages.some((error) => /robots\.txt (?:fetch|body read) failed/i.test(error))) {
    return "transient_exhausted"
  }
  if (messages.some((error) => /HTTP 403|robots|disallow/i.test(error))) return "external_block"
  if (messages.some((error) => /HTTP (404|410)/i.test(error))) return "endpoint_removed"
  if (messages.some((error) => /timeout|fetch failed|HTTP (429|5\d\d)/i.test(error))) {
    return "transient_exhausted"
  }
  if (input.dbReadFailed) return "db_read_failed"
  if (input.dbWriteFailed) return "db_write_failed"
  if (input.coverageGuard || input.status === "skipped") return "coverage_guard"
  if (messages.some((error) => /category|catalog/i.test(error))) return "config_drift"
  return "source_failed"
}

export function retryAtFromErrors(errors: string[]): string | null {
  for (const error of errors) {
    const match = error.match(/\bretry_at=([^\s|]+)/i)
    if (match && Number.isFinite(Date.parse(match[1]))) return new Date(match[1]).toISOString()
  }
  return null
}

export function isRefreshBatchSourceRunnable(
  status: RefreshBatchSourceStatus,
  attempts: number,
  maxAttempts: number,
  exceptionCode: string | null = null,
  exceptionMessage: string | null = null,
): boolean {
  if (status === "success") return false
  if (status !== "exception") return true
  return (
    exceptionCode === "transient_exhausted" ||
    exceptionCode === "db_read_failed" ||
    (exceptionCode === "external_block" && /robots\.txt (?:fetch|body read) failed/i.test(exceptionMessage ?? "")) ||
    // Compatibility with batches created before the failure taxonomy was fixed.
    exceptionCode === "db_write_exhausted"
  ) && attempts < maxAttempts
}
