export type RollingListingHealth = {
  status: "success" | "degraded" | "failed"
  reason: "none" | "no_progress" | "source_failure_rate" | "db_write_rate" | "retry_pending"
  write_attempted: number
}

/** Keep source and telemetry exceptions visible without failing useful rolling work. */
export function assessRollingListingHealth(counts: {
  attempted_slices: number
  completed_sources: number
  partial_slices: number
  skipped_sources: number
  failed_slices: number
  confirmed_products: number
  updated_products: number
  update_failures: number
  last_seen_failures: number
  telemetry_failures: number
  guard_tripped: number
}): RollingListingHealth {
  const writeFailures = counts.update_failures + counts.last_seen_failures
  const writeAttempted = counts.confirmed_products + counts.updated_products + writeFailures
  const sourceFailures = counts.skipped_sources + counts.failed_slices
  if (counts.attempted_slices > 0 && counts.completed_sources + counts.partial_slices === 0) {
    return {status: "failed", reason: "no_progress", write_attempted: writeAttempted}
  }
  if (sourceFailures >= 3 && sourceFailures / counts.attempted_slices >= 0.2) {
    return {status: "failed", reason: "source_failure_rate", write_attempted: writeAttempted}
  }
  if (writeFailures >= 3 && writeAttempted > 0 && writeFailures / writeAttempted >= 0.02) {
    return {status: "failed", reason: "db_write_rate", write_attempted: writeAttempted}
  }
  const retryPending = sourceFailures + writeFailures + counts.telemetry_failures + counts.guard_tripped > 0
  return {
    status: retryPending ? "degraded" : "success",
    reason: retryPending ? "retry_pending" : "none",
    write_attempted: writeAttempted,
  }
}
