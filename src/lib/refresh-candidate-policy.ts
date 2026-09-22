export interface RefreshCandidatePolicy {
  auditPrices: boolean
  priceOnly: boolean
  existingOnly: boolean
  discoverCandidates: boolean
}

/** Reuse listing observations for discovery without a second crawl. */
export function shouldObserveRefreshCandidates(policy: RefreshCandidatePolicy): boolean {
  if (policy.auditPrices || policy.priceOnly) return false
  return !policy.existingOnly || policy.discoverCandidates
}
