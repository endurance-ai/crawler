/** Shared wire types for the pipeline-integrity RPC and JSON boundaries. */

export type NormalizationStatus = "not_required" | "succeeded" | "unchanged" | "failed"

export interface NormalizationError {
  code: string
  message: string
  retryable: boolean
}

export interface NormalizationResult {
  status: NormalizationStatus
  inputHash: string
  policyVersion: string
  model: string | null
  completedAt: string | null
  category: string
  subcategory: string | null
  error?: NormalizationError
}

export interface ReviewCollection {
  status: "not_requested" | "succeeded" | "partial" | "failed"
  observedAt: string | null
  confirmedEmpty: boolean
  error?: string
}

export type BrandResolution =
  | {status: "existing"; brand: string; brandNodeId: string; genderScope?: string[] | null}
  | {status: "would_create"; brand: string}
  | {status: "quarantined"; brand: string; reason: string}

export interface PipelineError {
  stage: string
  code: string
  message: string
  retryable: boolean
  platform?: string
  productUrl?: string
  candidateId?: string
}

export interface PipelineStageReport {
  status: string
  counts: Record<string, number>
}

export interface PipelineFileReport {
  platform: string
  file?: string
  status: string
  counts: Record<string, number>
  errors: PipelineError[]
}

export interface PipelineReport {
  schema_version: 1
  run_id: string
  mode: "apply" | "dry_run"
  status: "success" | "partial" | "failed" | "planned"
  started_at: string
  ended_at: string | null
  counts: Record<string, number>
  stages: Record<string, PipelineStageReport>
  errors: PipelineError[]
  files: PipelineFileReport[]
}

export interface PreparedNormalization {
  status: NormalizationStatus
  input_hash: string
  policy_version: string
  model: string | null
  completed_at: string | null
}

export interface PreparedPricingObservation {
  state: "sale" | "regular"
  source: "variant" | "api" | "listing" | "detail"
  version: 2
}

/** Snake-case row accepted by upsert_prepared_products. */
export interface PreparedProductRow extends Record<string, unknown> {
  product_url: string
  brand_node_id: string
  gender: string[]
  category: string
  subcategory: string | null
  price: number
  original_price: number
  sale_price: number | null
  source_currency: string
  source_price: number
  image_url: string
}

export interface PreparedProductWrite {
  product: PreparedProductRow
  normalization: PreparedNormalization
  pricing_observation: PreparedPricingObservation
  observed_at: string
  expected_updated_at: string | null
}

export type PreparedProductWriteOutcome =
  | "inserted"
  | "updated"
  | "unchanged"
  | "conflicted"
  | "rejected"

export interface PreparedProductWriteResult {
  product_url: string
  id: string | null
  outcome: PreparedProductWriteOutcome
  code?: string
  message?: string
}

export type ProductRefreshCandidateStatus =
  | "discovered"
  | "brand_unmatched"
  | "enriching"
  | "ready"
  | "imported"
  | "rejected"
  | "failed"
  | "blocked"
  | "awaiting_observation"

/** Candidate returned by claim_product_refresh_candidates_v2. */
export interface ClaimedProductRefreshCandidate {
  id: string
  platform_key: string
  identity_key: string
  product_url: string
  raw_product: Record<string, unknown>
  raw_observed_at: string | null
  detected_brand: string | null
  matched_brand_node_id: string | null
  status: ProductRefreshCandidateStatus
  observation_revision: string
  processing_token: string
  lease_expires_at: string
  prepared_observation_revision: string | null
  enriched_product: PreparedProductWrite | null
  normalization_result: PreparedNormalization | null
  imported_product_id: string | null
  attempt_count: number
  last_error_code: string | null
  updated_at: string
  last_seen_at: string
  next_attempt_at: string | null
}

export interface ProductRefreshObservation {
  platform_key: string
  identity_key: string
  product_url: string
  raw_product: Record<string, unknown>
  detected_brand: string | null
  matched_brand_node_id: string | null
  raw_observed_at: string | null
}

export interface ProductRefreshObservationResult {
  inserted: number
  updated: number
  unchanged: number
  stale: number
  conflicted: number
  rematched: number
}

/** Convert a bigint-compatible ID to its lossless unsigned decimal wire form. */
export function toDecimalId(value: string | number | bigint): string {
  if (typeof value === "bigint") {
    if (value < BigInt(0)) throw new RangeError("ID must be non-negative")
    return value.toString(10)
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("numeric ID must be a non-negative safe integer")
    }
    return String(value)
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new TypeError("ID must be an unsigned decimal string")
  return value
}
