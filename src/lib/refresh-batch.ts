export type RefreshBatchSourceStatus = "pending" | "running" | "partial" | "success" | "exception"

export function isRefreshBatchSourceRunnable(
  status: RefreshBatchSourceStatus,
  attempts: number,
  maxAttempts: number,
): boolean {
  return status !== "success" && status !== "exception" && attempts < maxAttempts
}
