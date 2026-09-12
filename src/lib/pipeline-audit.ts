import {createHash} from "node:crypto"
import {brandMatchKey} from "./refresh-source"
import {toDecimalId} from "./pipeline-integrity-types"

export interface AuditProduct {
  id: string
  product_url: string
  platform: string | null
  brand: string
  brand_node_id: string | null
  updated_at: string
  price: number | null
  original_price: number | null
  sale_price: number | null
  in_stock: boolean
  image_url: string | null
  image_revision: string
  review_count: number | null
  reviews_observed_at: string | null
}
export interface AuditEmbedding {
  product_id: string
  source_image_url: string | null
  source_image_revision: string | null
  embedded_at: string
  embedding_model: string
}
export interface AuditCandidate {
  id: string
  platform_key: string
  product_url: string
  status: string
  updated_at: string
  observation_revision: string
  prepared_observation_revision: string | null
  raw_observed_at: string | null
  matched_brand_node_id: string | null
  imported_product_id: string | null
  processing_token: string | null
  lease_expires_at: string | null
  attempt_count: number
  last_error_code: string | null
  normalization_result: Record<string, unknown> | null
  raw_product: Record<string, unknown>
}
export interface AuditBrand {id: string; brand_name: string; brand_name_normalized: string | null}
export type AuditAction = "reobserve_candidate" | "resume_candidate" | "repair_brand" | "repair_review_count" | "regenerate_embedding" | "manual_review"
export interface PipelineAuditFinding {
  finding_id: string
  entity: "product" | "candidate" | "embedding"
  id: string
  platform: string | null
  issue: string
  certainty: "confirmed" | "suspected" | "unverified"
  action: AuditAction
  evidence: Record<string, unknown>
  expected: Record<string, unknown>
  proposed: Record<string, unknown>
}
export interface PipelineAuditManifest {
  schema_version: 1
  kind: "pipeline_integrity_audit"
  generated_at: string
  /** All selected-scope reads completed; does not assert an unlimited catalog scan. */
  complete: boolean
  scope: {platform: string | null; limit: number | null; max_observation_age_hours: number}
  scanned: {products: number; candidates: number; embeddings: number}
  findings: PipelineAuditFinding[]
  content_hash: string
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]))
  return value
}
export function pipelineAuditHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")
}

export function createPipelineAuditManifest(input: {
  products: AuditProduct[]
  candidates: AuditCandidate[]
  embeddings: AuditEmbedding[]
  brands: AuditBrand[]
  reviewCounts: Map<string, number>
  now: string
  scope: PipelineAuditManifest["scope"]
}): PipelineAuditManifest {
  if (!Number.isFinite(Date.parse(input.now))) throw new Error("Invalid audit time")
  const findings: PipelineAuditFinding[] = []
  const add = (finding: Omit<PipelineAuditFinding, "finding_id">) => findings.push({
    ...finding, finding_id: pipelineAuditHash([finding.entity, finding.id, finding.issue]).slice(0, 24),
  })
  const embeddings = new Map(input.embeddings.map((embedding) => [embedding.product_id, embedding]))
  for (const product of input.products) {
    const expected = {...product}
    const base = {entity: "product" as const, id: product.id, platform: product.platform, expected}
    if (!product.brand_node_id) {
      const key = brandMatchKey(product.brand)
      const matches = key ? input.brands.filter((brand) => [brand.brand_name, brand.brand_name_normalized].some((name) => name && brandMatchKey(name) === key)) : []
      add({...base, issue: "product_brand_missing", certainty: "confirmed", action: matches.length === 1 ? "repair_brand" : "manual_review",
        evidence: {brand: product.brand, exact_matches: matches.map((brand) => ({id: brand.id, name: brand.brand_name}))},
        proposed: matches.length === 1 ? {brand_node_id: matches[0].id} : {}})
    }
    if (!Number.isFinite(product.price) || product.price! <= 0 ||
      (product.original_price !== null && (!Number.isFinite(product.original_price) || product.original_price < product.price!)) ||
      (product.sale_price !== null && (product.sale_price !== product.price || product.original_price === null || product.sale_price >= product.original_price))) {
      add({...base, issue: "product_price_invalid", certainty: "confirmed", action: "manual_review",
        evidence: {price: product.price, original_price: product.original_price, sale_price: product.sale_price}, proposed: {requires: "fresh confirmed storefront pricing"}})
    }
    const actualCount = input.reviewCounts.get(product.id)
    if (actualCount === undefined) throw new Error("Review count missing from audited scope")
    if (actualCount !== (product.review_count ?? 0)) {
      add({...base, issue: "review_count_mismatch", certainty: "confirmed", action: "repair_review_count",
        evidence: {reported_count: product.review_count, stored_sample_count: actualCount}, proposed: {review_count: actualCount}})
    }
    const embedding = embeddings.get(product.id)
    if (embedding) {
      const provenanceMissing = embedding.source_image_url === null || embedding.source_image_revision === null
      if (provenanceMissing || embedding.source_image_url !== product.image_url || embedding.source_image_revision !== product.image_revision) {
        add({entity: "embedding", id: product.id, platform: product.platform,
          issue: provenanceMissing ? "embedding_provenance_unknown" : "embedding_source_mismatch",
          certainty: provenanceMissing ? "unverified" : "confirmed", action: product.in_stock && product.image_url ? "regenerate_embedding" : "manual_review",
          evidence: {...embedding}, expected: {...expected, embedding: {...embedding}}, proposed: {source_image_url: product.image_url, source_image_revision: product.image_revision}})
      }
    }
  }
  const staleBefore = Date.parse(input.now) - input.scope.max_observation_age_hours * 3600_000
  for (const candidate of input.candidates) {
    const {raw_product, normalization_result, ...expected} = candidate
    const base = {entity: "candidate" as const, id: candidate.id, platform: candidate.platform_key, expected, proposed: {}}
    const timestamp = candidate.raw_observed_at === null ? NaN : Date.parse(candidate.raw_observed_at)
    const stale = !Number.isFinite(timestamp) || timestamp < staleBefore
    const activeLease = candidate.processing_token !== null && candidate.lease_expires_at !== null && Date.parse(candidate.lease_expires_at) > Date.parse(input.now)
    const recoveryAction: AuditAction = activeLease ? "manual_review" : stale ? "reobserve_candidate" : "resume_candidate"
    const observation = raw_product.pricingObservation as Record<string, unknown> | undefined
    const normalizationVerified = normalization_result !== null &&
      ["not_required", "succeeded", "unchanged"].includes(String(normalization_result.status)) &&
      typeof normalization_result.input_hash === "string" && /^[a-f0-9]{64}$/i.test(normalization_result.input_hash) &&
      typeof normalization_result.policy_version === "string" && normalization_result.policy_version.trim().length > 0 &&
      typeof normalization_result.completed_at === "string" && Number.isFinite(Date.parse(normalization_result.completed_at)) &&
      (normalization_result.status === "not_required" || (typeof normalization_result.model === "string" && normalization_result.model.trim().length > 0))
    if (!observation || observation.version !== 2 || !["sale", "regular"].includes(String(observation.state))) {
      add({...base, issue: "candidate_price_unconfirmed", certainty: "unverified", action: candidate.status === "imported" ? "manual_review" : recoveryAction,
        evidence: {pricing_observation: observation ?? null, last_error_code: candidate.last_error_code}})
    }
    if (stale && !["imported", "rejected"].includes(candidate.status)) {
      add({...base, issue: "candidate_observation_stale", certainty: candidate.raw_observed_at === null ? "unverified" : "confirmed", action: activeLease ? "manual_review" : "reobserve_candidate",
        evidence: {raw_observed_at: candidate.raw_observed_at, max_age_hours: input.scope.max_observation_age_hours}})
    }
    if (candidate.matched_brand_node_id === null) {
      add({...base, issue: "candidate_brand_unmatched", certainty: "confirmed", action: "manual_review", evidence: {brand: raw_product.brand ?? null}})
    }
    if (candidate.status === "imported" && (candidate.imported_product_id === null ||
      !normalizationVerified ||
      candidate.prepared_observation_revision !== candidate.observation_revision)) {
      const definite = candidate.imported_product_id === null || normalization_result?.status === "failed"
      add({...base, issue: "candidate_import_completion_unverified", certainty: definite ? "confirmed" : "unverified", action: candidate.matched_brand_node_id ? recoveryAction : "manual_review",
        evidence: {imported_product_id: candidate.imported_product_id, normalization_status: normalization_result?.status ?? null,
          prepared_observation_revision: candidate.prepared_observation_revision, observation_revision: candidate.observation_revision}})
    } else if (["failed", "blocked"].includes(candidate.status) && candidate.matched_brand_node_id) {
      add({...base, issue: "candidate_retry_incomplete", certainty: "confirmed", action: recoveryAction,
        evidence: {status: candidate.status, attempt_count: candidate.attempt_count, last_error_code: candidate.last_error_code}})
    }
  }
  findings.sort((a, b) => a.entity.localeCompare(b.entity) || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : a.issue.localeCompare(b.issue)))
  const manifest: PipelineAuditManifest = {
    schema_version: 1, kind: "pipeline_integrity_audit", generated_at: input.now, complete: true,
    scope: input.scope, scanned: {products: input.products.length, candidates: input.candidates.length, embeddings: input.embeddings.length},
    findings, content_hash: "",
  }
  manifest.content_hash = pipelineAuditHash({...manifest, content_hash: undefined})
  return manifest
}

/** Normalize only ID fields; timestamps stay lossless strings for CAS. */
export function auditDecimalId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new Error("Invalid audit ID")
  const id = toDecimalId(value)
  if (id === "0") throw new Error("Audit IDs must be positive")
  return id
}

export function auditManifestCsv(manifest: PipelineAuditManifest): string {
  const cell = (value: unknown) => {
    let text = typeof value === "string" ? value : JSON.stringify(value)
    if (/^[=+@-]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return ["finding_id,entity,id,platform,issue,certainty,action,evidence,expected,proposed",
    ...manifest.findings.map((finding) => [finding.finding_id, finding.entity, finding.id, finding.platform, finding.issue, finding.certainty, finding.action, finding.evidence, finding.expected, finding.proposed].map(cell).join(",")), ""].join("\n")
}
