import type {ClaimedProductRefreshCandidate} from "./pipeline-integrity-types"
import {DEFAULT_NORMALIZATION_POLICY_VERSION} from "./prepare-product-for-import"
import {qwenNormalizationInputHash} from "./product-qwen-normalization"
import type {Product} from "./types"

export function canReuseCandidateCheckpoint(candidate: ClaimedProductRefreshCandidate,
  maxAgeHours: number, now = Date.now()): boolean {
  const prepared = candidate.enriched_product
  const normalization = candidate.normalization_result
  const raw = candidate.raw_product as Partial<Product>
  // An identical listing can refresh raw_observed_at without refreshing detail evidence.
  const preparedObservedAt = prepared && Date.parse(prepared.observed_at)
  return prepared !== null && normalization !== null &&
    typeof preparedObservedAt === "number" && Number.isFinite(preparedObservedAt) &&
    preparedObservedAt >= now - maxAgeHours * 3_600_000 &&
    candidate.prepared_observation_revision === candidate.observation_revision &&
    normalization.policy_version === DEFAULT_NORMALIZATION_POLICY_VERSION &&
    typeof normalization.completed_at === "string" &&
    JSON.stringify(prepared.normalization) === JSON.stringify(normalization) &&
    typeof raw.productUrl === "string" && typeof raw.name === "string" && typeof raw.brand === "string" &&
    normalization.input_hash === qwenNormalizationInputHash({productUrl: raw.productUrl,
      name: raw.name, brand: raw.brand, category: raw.category ?? "other",
      subcategory: raw.subcategory, tags: raw.tags})
}
