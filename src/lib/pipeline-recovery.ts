import {pipelineAuditHash, type AuditBrand, type AuditCandidate, type AuditEmbedding, type AuditProduct, type PipelineAuditFinding, type PipelineAuditManifest} from "./pipeline-audit"
import {brandMatchKey} from "./refresh-source"

export interface RecoveryCandidate extends AuditCandidate {
  processing_observation_revision: string | null
  processing_max_age_hours: number | null
  enriched_product: Record<string, unknown> | null
  next_attempt_at: string | null
  last_error: string | null
}

export interface RecoveryStore {
  readCandidate(id: string): Promise<RecoveryCandidate | null>
  updateCandidate(current: RecoveryCandidate, patch: Record<string, unknown>): Promise<boolean>
  readProduct(id: string): Promise<AuditProduct | null>
  updateProduct(current: AuditProduct, patch: Record<string, unknown>): Promise<boolean>
  readBrands(): Promise<AuditBrand[]>
  countReviews(productId: string): Promise<number>
  readEmbedding(productId: string): Promise<AuditEmbedding | null>
  deleteEmbedding(current: AuditEmbedding): Promise<boolean>
}

export type RecoveryOutcome = "planned" | "applied" | "unchanged" | "conflicted" | "failed" | "deferred"
export interface RecoveryItemResult {
  finding_id: string
  entity: PipelineAuditFinding["entity"]
  id: string
  action: PipelineAuditFinding["action"]
  outcome: RecoveryOutcome
  code?: string
}
export interface RecoveryRunResult {
  manifest_hash: string
  mode: "dry_run" | "apply"
  status: "success" | "incomplete"
  counts: Record<RecoveryOutcome, number>
  results: RecoveryItemResult[]
}
export interface RecoveryCheckpoint {
  schema_version: 1
  kind: "pipeline_integrity_recovery_checkpoint"
  manifest_hash: string
  updated_at: string
  outcomes: Record<string, RecoveryItemResult>
}

export function validateRecoveryCheckpoint(value: unknown, manifestHash: string): asserts value is RecoveryCheckpoint {
  const checkpoint = value as RecoveryCheckpoint | null
  if (!checkpoint || checkpoint.schema_version !== 1 ||
      checkpoint.kind !== "pipeline_integrity_recovery_checkpoint" ||
      checkpoint.manifest_hash !== manifestHash || !checkpoint.outcomes ||
      typeof checkpoint.outcomes !== "object" || Array.isArray(checkpoint.outcomes)) {
    throw new Error("Checkpoint does not belong to this manifest")
  }
}

const EXPECTED_PRODUCT_KEYS = [
  "id", "product_url", "platform", "brand", "brand_node_id", "updated_at",
  "price", "original_price", "sale_price", "in_stock", "image_url",
  "image_revision", "review_count", "reviews_observed_at",
] as const
const EXPECTED_CANDIDATE_KEYS = [
  "id", "platform_key", "product_url", "status", "updated_at",
  "observation_revision", "prepared_observation_revision", "raw_observed_at",
  "matched_brand_node_id", "imported_product_id", "processing_token",
  "lease_expires_at", "attempt_count", "last_error_code",
] as const

function exactExpected(
  current: Record<string, unknown>,
  expected: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) =>
    Object.prototype.hasOwnProperty.call(expected, key) &&
    pipelineAuditHash(current[key]) === pipelineAuditHash(expected[key]))
}

export function validateRecoveryManifest(value: unknown): asserts value is PipelineAuditManifest {
  const manifest = value as PipelineAuditManifest | null
  if (!manifest || manifest.schema_version !== 1 || manifest.kind !== "pipeline_integrity_audit" ||
      manifest.complete !== true || !Number.isFinite(Date.parse(manifest.generated_at)) ||
      !manifest.scope || !Array.isArray(manifest.findings) ||
      !Number.isFinite(manifest.scope.max_observation_age_hours) || manifest.scope.max_observation_age_hours <= 0 ||
      typeof manifest.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(manifest.content_hash) ||
      manifest.content_hash !== pipelineAuditHash({...manifest, content_hash: undefined})) {
    throw new Error("Invalid, incomplete, or modified recovery manifest")
  }
  const ids = new Set<string>()
  for (const finding of manifest.findings) {
    if (!finding || typeof finding.finding_id !== "string" || !finding.finding_id ||
        !["product", "candidate", "embedding"].includes(finding.entity) ||
        !/^[1-9]\d*$/.test(finding.id) || typeof finding.issue !== "string" ||
        !["reobserve_candidate", "resume_candidate", "repair_brand", "repair_review_count", "regenerate_embedding", "manual_review"].includes(finding.action) ||
        !finding.expected || typeof finding.expected !== "object" ||
        !finding.proposed || typeof finding.proposed !== "object") {
      throw new Error("Invalid recovery finding")
    }
    if (ids.has(finding.finding_id)) throw new Error("Duplicate recovery finding_id")
    ids.add(finding.finding_id)
    if (manifest.scope.platform !== null && finding.platform !== manifest.scope.platform) {
      throw new Error("Finding is outside manifest platform scope")
    }
    if (finding.expected.id !== finding.id ||
        (finding.entity === "candidate" && finding.expected.platform_key !== finding.platform) ||
        (finding.entity !== "candidate" && finding.expected.platform !== finding.platform)) {
      throw new Error("Finding identity does not match its expected snapshot")
    }
    const allowed = finding.entity === "candidate"
      ? ["reobserve_candidate", "resume_candidate", "manual_review"]
      : finding.entity === "embedding"
        ? ["regenerate_embedding", "manual_review"]
        : ["repair_brand", "repair_review_count", "manual_review"]
    if (!allowed.includes(finding.action)) throw new Error("Recovery action does not match its entity")
    for (const key of ["id", "observation_revision", "prepared_observation_revision", "matched_brand_node_id", "imported_product_id"] as const) {
      const field = finding.expected[key]
      if (field !== undefined && field !== null && (typeof field !== "string" || !/^[1-9]\d*$/.test(field))) {
        throw new Error("Recovery snapshot contains an invalid ID or revision")
      }
    }
  }
}

function selectedFindings(
  manifest: PipelineAuditManifest,
  options: {platform?: string; ids?: ReadonlySet<string>},
): PipelineAuditFinding[] {
  if (options.platform && manifest.scope.platform && options.platform !== manifest.scope.platform) {
    throw new Error("Requested platform is outside manifest scope")
  }
  const selected = manifest.findings.filter((finding) =>
    (!options.platform || finding.platform === options.platform) &&
    (!options.ids || options.ids.has(finding.id)),
  )
  const grouped = new Map<string, PipelineAuditFinding[]>()
  for (const finding of selected) {
    const key = `${finding.entity}:${finding.id}`
    grouped.set(key, [...(grouped.get(key) ?? []), finding])
  }
  const results: PipelineAuditFinding[] = []
  for (const findings of grouped.values()) {
    if (findings[0].entity === "candidate") {
      results.push(
        findings.find((finding) => finding.action === "reobserve_candidate") ??
        findings.find((finding) => finding.action === "resume_candidate") ??
        findings[0],
      )
    } else {
      const byAction = new Map<string, PipelineAuditFinding>()
      for (const finding of findings) {
        const existing = byAction.get(finding.action)
        if (existing && pipelineAuditHash(existing.proposed) !== pipelineAuditHash(finding.proposed)) {
          throw new Error("Conflicting duplicate recovery actions")
        }
        byAction.set(finding.action, existing ?? finding)
      }
      results.push(...byAction.values())
    }
  }
  return results.sort((a, b) => a.entity.localeCompare(b.entity) ||
    (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : a.action.localeCompare(b.action)))
}

function result(finding: PipelineAuditFinding, outcome: RecoveryOutcome, code?: string): RecoveryItemResult {
  return {finding_id: finding.finding_id, entity: finding.entity, id: finding.id, action: finding.action, outcome, ...(code ? {code} : {})}
}

async function recoverCandidate(
  store: RecoveryStore,
  finding: PipelineAuditFinding,
  now: string,
  maxAgeHours: number,
): Promise<RecoveryItemResult> {
  const current = await store.readCandidate(finding.id)
  if (!current) return result(finding, "conflicted", "candidate_missing")
  const status = finding.action === "reobserve_candidate" ? "awaiting_observation" : "discovered"
  const sameIdentity = current.id === finding.expected.id &&
    current.platform_key === finding.expected.platform_key &&
    current.product_url === finding.expected.product_url &&
    current.observation_revision === finding.expected.observation_revision &&
    current.raw_observed_at === finding.expected.raw_observed_at &&
    current.matched_brand_node_id === finding.expected.matched_brand_node_id &&
    current.imported_product_id === finding.expected.imported_product_id
  const already = sameIdentity && current.status === status && current.attempt_count === 0 &&
    current.processing_token === null && current.lease_expires_at === null &&
    current.processing_observation_revision === null && current.enriched_product === null &&
    current.prepared_observation_revision === null && current.normalization_result === null &&
    current.next_attempt_at === null && current.last_error_code === null && current.last_error === null
  if (already) return result(finding, "unchanged")
  if (!exactExpected(current as unknown as Record<string, unknown>, finding.expected, EXPECTED_CANDIDATE_KEYS)) {
    return result(finding, "conflicted", current ? "candidate_changed" : "candidate_missing")
  }
  if (current.processing_token && current.lease_expires_at &&
      Date.parse(current.lease_expires_at) > Date.parse(now)) {
    return result(finding, "conflicted", "active_lease")
  }
  if (finding.action === "resume_candidate") {
    if (!current.matched_brand_node_id) return result(finding, "conflicted", "brand_unmatched")
    const observed = current.raw_observed_at ? Date.parse(current.raw_observed_at) : NaN
    if (!Number.isFinite(observed) || observed < Date.parse(now) - maxAgeHours * 3_600_000) {
      return result(finding, "conflicted", "observation_stale")
    }
  }
  const applied = await store.updateCandidate(current, {
    status,
    attempt_count: 0,
    processing_token: null,
    processing_observation_revision: null,
    processing_max_age_hours: null,
    lease_expires_at: null,
    enriched_product: null,
    prepared_observation_revision: null,
    normalization_result: null,
    next_attempt_at: null,
    last_error_code: null,
    last_error: null,
  })
  return result(finding, applied ? "applied" : "conflicted", applied ? undefined : "candidate_race")
}

async function repairBrand(
  store: RecoveryStore,
  finding: PipelineAuditFinding,
  approvedReviewCount?: number,
): Promise<RecoveryItemResult> {
  const current = await store.readProduct(finding.id)
  const proposed = finding.proposed.brand_node_id
  if (current && typeof proposed === "string" && current.brand_node_id === proposed &&
      EXPECTED_PRODUCT_KEYS.filter((key) => !["brand_node_id","updated_at", ...(approvedReviewCount !== undefined ? ["review_count"] : [])].includes(key))
        .every((key) => pipelineAuditHash(current[key]) === pipelineAuditHash(finding.expected[key]))) {
    if (approvedReviewCount === undefined || (current.review_count ?? 0) === approvedReviewCount) {
      return result(finding, "unchanged")
    }
  }
  if (!current || !exactExpected(current as unknown as Record<string, unknown>, finding.expected, EXPECTED_PRODUCT_KEYS)) {
    return result(finding, "conflicted", current ? "product_changed" : "product_missing")
  }
  if (current.brand_node_id !== null) return result(finding, "conflicted", "brand_already_mapped")
  const evidence = finding.evidence.exact_matches
  if (typeof proposed !== "string" || !/^[1-9]\d*$/.test(proposed) || !Array.isArray(evidence) ||
      evidence.length !== 1 || (evidence[0] as {id?: unknown}).id !== proposed) {
    return result(finding, "deferred", "brand_evidence_ambiguous")
  }
  const key = brandMatchKey(current.brand)
  const matches = (await store.readBrands()).filter((brand) =>
    [brand.brand_name, brand.brand_name_normalized].some((name) => name && brandMatchKey(name) === key),
  )
  if (!key || matches.length !== 1 || matches[0].id !== proposed) {
    return result(finding, "deferred", "brand_evidence_ambiguous")
  }
  const applied = await store.updateProduct(current, {brand_node_id: proposed})
  return result(finding, applied ? "applied" : "conflicted", applied ? undefined : "product_race")
}

async function repairReviewCount(
  store: RecoveryStore,
  finding: PipelineAuditFinding,
  approvedBrandId?: string,
): Promise<RecoveryItemResult> {
  const current = await store.readProduct(finding.id)
  const proposed = finding.proposed.review_count
  if (current && Number.isSafeInteger(proposed) && (current.review_count ?? 0) === proposed &&
      EXPECTED_PRODUCT_KEYS.filter((key) => !["review_count","updated_at", ...(approvedBrandId ? ["brand_node_id"] : [])].includes(key))
        .every((key) => pipelineAuditHash(current[key]) === pipelineAuditHash(finding.expected[key])) &&
      (!approvedBrandId || current.brand_node_id === approvedBrandId) &&
      await store.countReviews(current.id) === proposed) {
    return result(finding, "unchanged")
  }
  const siblingBrandApplied = approvedBrandId !== undefined && current?.brand_node_id === approvedBrandId &&
    EXPECTED_PRODUCT_KEYS.filter((key) => !["brand_node_id","updated_at"].includes(key))
      .every((key) => pipelineAuditHash(current[key]) === pipelineAuditHash(finding.expected[key]))
  if (!current || (!siblingBrandApplied &&
      !exactExpected(current as unknown as Record<string, unknown>, finding.expected, EXPECTED_PRODUCT_KEYS))) {
    return result(finding, "conflicted", current ? "product_changed" : "product_missing")
  }
  if (!Number.isSafeInteger(proposed) || Number(proposed) < 0) return result(finding, "failed", "invalid_review_count")
  const actual = await store.countReviews(current.id)
  if (actual !== proposed) return result(finding, "conflicted", "reviews_changed")
  if ((current.review_count ?? 0) === proposed) return result(finding, "unchanged")
  const applied = await store.updateProduct(current, {review_count: proposed})
  return result(finding, applied ? "applied" : "conflicted", applied ? undefined : "reviews_race")
}

async function regenerateEmbedding(store: RecoveryStore, finding: PipelineAuditFinding): Promise<RecoveryItemResult> {
  const expectedProduct = finding.expected as Record<string, unknown>
  const currentProduct = await store.readProduct(finding.id)
  if (!currentProduct || currentProduct.product_url !== expectedProduct.product_url ||
      currentProduct.image_url !== expectedProduct.image_url ||
      currentProduct.image_revision !== expectedProduct.image_revision) {
    return result(finding, "conflicted", currentProduct ? "product_image_changed" : "product_missing")
  }
  const expectedEmbedding = expectedProduct.embedding as AuditEmbedding | undefined
  const current = await store.readEmbedding(finding.id)
  if (!current) return result(finding, "unchanged")
  if (!expectedEmbedding || pipelineAuditHash(current) !== pipelineAuditHash(expectedEmbedding)) {
    return result(finding, "conflicted", "embedding_changed")
  }
  const applied = await store.deleteEmbedding(current)
  return result(finding, applied ? "applied" : "conflicted", applied ? undefined : "embedding_race")
}

export async function runPipelineRecovery(options: {
  manifest: PipelineAuditManifest
  store?: RecoveryStore
  apply?: boolean
  platform?: string
  ids?: ReadonlySet<string>
  now?: string
  onResult?: (item: RecoveryItemResult) => Promise<void>
}): Promise<RecoveryRunResult> {
  validateRecoveryManifest(options.manifest)
  const manifestHash = options.manifest.content_hash
  const findings = selectedFindings(options.manifest, options)
  const approvedBrands = new Map(findings.filter((finding) => finding.action === "repair_brand" &&
    typeof finding.proposed.brand_node_id === "string").map((finding) => [finding.id, finding.proposed.brand_node_id as string]))
  const approvedReviewCounts = new Map(findings.filter((finding) => finding.action === "repair_review_count" &&
    Number.isSafeInteger(finding.proposed.review_count)).map((finding) => [finding.id, finding.proposed.review_count as number]))
  const mode = options.apply ? "apply" : "dry_run"
  const results: RecoveryItemResult[] = []
  const now = options.now ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid recovery time")
  for (const finding of findings) {
    let item: RecoveryItemResult
    if (finding.action === "manual_review") {
      item = result(finding, "deferred", "manual_review")
    } else if (!options.apply) {
      item = result(finding, "planned")
    } else {
      if (!options.store) throw new Error("Recovery store is required in apply mode")
      try {
        if (finding.action === "reobserve_candidate" || finding.action === "resume_candidate") {
          item = await recoverCandidate(options.store, finding, now, options.manifest.scope.max_observation_age_hours)
        } else if (finding.action === "repair_brand") {
          item = await repairBrand(options.store, finding, approvedReviewCounts.get(finding.id))
        } else if (finding.action === "repair_review_count") {
          item = await repairReviewCount(options.store, finding, approvedBrands.get(finding.id))
        } else {
          item = await regenerateEmbedding(options.store, finding)
        }
      } catch {
        item = result(finding, "failed", "storage_error")
      }
    }
    results.push(item)
    if (options.onResult) await options.onResult(item)
  }
  const counts: Record<RecoveryOutcome, number> = {
    planned: 0, applied: 0, unchanged: 0, conflicted: 0, failed: 0, deferred: 0,
  }
  for (const item of results) counts[item.outcome] += 1
  return {
    manifest_hash: manifestHash,
    mode,
    status: counts.failed > 0 || counts.conflicted > 0 ? "incomplete" : "success",
    counts,
    results,
  }
}

export function createRecoveryCheckpoint(run: RecoveryRunResult, now = new Date().toISOString()): RecoveryCheckpoint {
  return {
    schema_version: 1,
    kind: "pipeline_integrity_recovery_checkpoint",
    manifest_hash: run.manifest_hash,
    updated_at: now,
    outcomes: Object.fromEntries(run.results.map((item) => [item.finding_id, item])),
  }
}
