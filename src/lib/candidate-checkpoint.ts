import type {ClaimedProductRefreshCandidate} from "./pipeline-integrity-types"
import {DEFAULT_NORMALIZATION_POLICY_VERSION} from "./prepare-product-for-import"

export function canReuseCandidateCheckpoint(candidate: ClaimedProductRefreshCandidate,
  maxAgeHours: number, now = Date.now()): boolean {
  const prepared = candidate.enriched_product
  const normalization = candidate.normalization_result
  // An identical listing can refresh raw_observed_at without refreshing detail evidence.
  const preparedObservedAt = prepared && Date.parse(prepared.observed_at)
  return prepared !== null && normalization !== null &&
    typeof preparedObservedAt === "number" && Number.isFinite(preparedObservedAt) &&
    preparedObservedAt >= now - maxAgeHours * 3_600_000 &&
    candidate.prepared_observation_revision === candidate.observation_revision &&
    normalization.policy_version === DEFAULT_NORMALIZATION_POLICY_VERSION &&
    typeof normalization.completed_at === "string" &&
    JSON.stringify(prepared.normalization) === JSON.stringify(normalization) &&
    prepared.product.product_url === candidate.product_url &&
    prepared.product.brand_node_id === candidate.matched_brand_node_id
}
