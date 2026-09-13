import {toDecimalId, type ClaimedProductRefreshCandidate, type PreparedProductWrite} from "./pipeline-integrity-types"

export interface CandidateFilters {
  limit: number
  maxAttempts: number
  originCountry: string | null
  platform: string | null
  inStockOnly: boolean
  maxAgeHours: number
}

export type FinishOutcome = "retry" | "rejected" | "awaiting_observation" | "release" | "stale"
export type PublishResult =
  | {outcome: "imported"; product_id: string; write_outcome: "inserted" | "updated" | "unchanged"; code?: string}
  | {outcome: "conflicted" | "rejected" | "stale" | "lost_claim"; product_id: string | null; code?: string}

export interface CurrentProductSnapshot {
  id: string
  updated_at: string
  name: string
  brand: string
  category: string
  subcategory: string | null
  tags: string[] | null
}

export interface CandidateRepository {
  list(filters: CandidateFilters): Promise<ClaimedProductRefreshCandidate[]>
  claim(filters: CandidateFilters): Promise<ClaimedProductRefreshCandidate[]>
  heartbeat(id: string, token: string): Promise<boolean>
  checkpoint(id: string, token: string, revision: string, prepared: PreparedProductWrite): Promise<"ready" | "stale" | "lost_claim">
  finish(id: string, token: string, revision: string, outcome: FinishOutcome, error?: {code: string; message: string}, maxAttempts?: number): Promise<string>
  publish(id: string, token: string, revision: string): Promise<PublishResult>
  currentProduct(id: string): Promise<CurrentProductSnapshot | null>
  brandGenderScope(id: string): Promise<string[] | null>
  publishNormalization(input: {candidateId: string; token: string; revision: string; productId: string; expectedUpdatedAt: string; normalization: PreparedProductWrite["normalization"]; category: string; subcategory: string | null}): Promise<PublishResult>
}

type DbResult = {data: unknown; error: {message: string} | null}
type RpcDb = {rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>; from(name: string): any}

function rpcError(name: string, error: {message: string} | null): void {
  if (error) throw new Error(`${name} failed`)
}

const decimal = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
function claimedRows(value: unknown, listing = false): ClaimedProductRefreshCandidate[] {
  if (!Array.isArray(value)) throw new Error("claim returned an invalid response")
  const rows = (value as Array<Record<string, unknown>>).map((source) => {
    const row = {...source}
    if (listing) {
      row.id = toDecimalId(row.id as string | number | bigint)
      row.observation_revision = toDecimalId(row.observation_revision as string | number | bigint)
      if (row.prepared_observation_revision !== null && row.prepared_observation_revision !== undefined)
        row.prepared_observation_revision = toDecimalId(row.prepared_observation_revision as string | number | bigint)
      if (row.matched_brand_node_id !== null && row.matched_brand_node_id !== undefined)
        row.matched_brand_node_id = toDecimalId(row.matched_brand_node_id as string | number | bigint)
      if (row.imported_product_id !== null && row.imported_product_id !== undefined)
        row.imported_product_id = toDecimalId(row.imported_product_id as string | number | bigint)
    }
    return row
  })
  for (const row of rows) {
    if (!row || !decimal(row.id) || !decimal(row.observation_revision) ||
      (!listing && (typeof row.processing_token !== "string" || !row.processing_token)) ||
      (!listing && (typeof row.lease_expires_at !== "string" || !Number.isFinite(Date.parse(row.lease_expires_at)))) ||
      typeof row.platform_key !== "string" || typeof row.product_url !== "string" ||
      !row.raw_product || typeof row.raw_product !== "object" || Array.isArray(row.raw_product)) {
      throw new Error("claim returned an invalid response")
    }
  }
  return rows as unknown as ClaimedProductRefreshCandidate[]
}
function publishResult(value: unknown): PublishResult {
  const row = value as Record<string, unknown> | null
  if (!row || !["imported", "conflicted", "rejected", "stale", "lost_claim"].includes(String(row.outcome)) ||
    !(row.product_id === null || decimal(row.product_id)) ||
    (row.outcome === "imported" && (!decimal(row.product_id) ||
      !["inserted", "updated", "unchanged"].includes(String(row.write_outcome))))) {
    throw new Error("publish returned an invalid response")
  }
  return row as PublishResult
}

export function createCandidateRepository(db: RpcDb): CandidateRepository {
  const rpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const {data, error} = await db.rpc(name, args)
    rpcError(name, error)
    return data
  }
  return {
    async list(filters) {
      if (filters.originCountry && !/^[A-Za-z][A-Za-z .'-]{0,63}$/.test(filters.originCountry))
        throw new Error("invalid origin country filter")
      const oldest = new Date(Date.now() - filters.maxAgeHours * 3_600_000).toISOString()
      let query = db.from("product_refresh_candidates")
        .select("*,product_refresh_sources!inner(enabled),brand_nodes!inner(wiki)")
        .eq("product_refresh_sources.enabled", true).gte("raw_observed_at", oldest)
        .lt("attempt_count", filters.maxAttempts)
        .or("next_attempt_at.is.null,next_attempt_at.lte.now()")
        .or("status.in.(discovered,failed),and(status.in.(enriching,ready),or(processing_token.is.null,lease_expires_at.lte.now()))")
        .order("first_seen_at", {ascending: true}).order("id", {ascending: true}).limit(filters.limit)
      if (filters.platform) query = query.eq("platform_key", filters.platform)
      if (filters.originCountry) query = query.or(`wiki->>origin_country.ilike.${filters.originCountry}`, {referencedTable: "brand_nodes"})
      if (filters.inStockOnly) query = query.or("raw_product->>inStock.eq.true,raw_product->>in_stock.eq.true")
      const {data, error} = await query
      rpcError("candidate dry-run listing", error)
      return claimedRows(data ?? [], true)
    },
    async claim(filters) {
      return claimedRows(await rpc("claim_product_refresh_candidates_v2", {
        p_limit: filters.limit,
        p_max_attempts: filters.maxAttempts,
        p_origin_country: filters.originCountry,
        p_platform_key: filters.platform,
        p_in_stock_only: filters.inStockOnly,
        p_max_age_hours: filters.maxAgeHours,
      }) ?? [])
    },
    async heartbeat(id, token) {
      return (await rpc("heartbeat_product_refresh_candidate", {p_id: id, p_token: token})) === true
    },
    async checkpoint(id, token, revision, prepared) {
      const value = await rpc("checkpoint_product_refresh_candidate", {
        p_id: id, p_token: token, p_expected_revision: revision, p_prepared: prepared,
      }) as {outcome?: "ready" | "stale" | "lost_claim"}
      if (!value || !["ready", "stale", "lost_claim"].includes(String(value.outcome))) throw new Error("checkpoint returned an invalid response")
      return value.outcome as "ready" | "stale" | "lost_claim"
    },
    async finish(id, token, revision, outcome, error, maxAttempts = 3) {
      const value = await rpc("finish_product_refresh_candidate_attempt", {
        p_id: id, p_token: token, p_expected_revision: revision, p_outcome: outcome,
        p_error_code: error?.code ?? null, p_error_message: error?.message ?? null,
        p_max_attempts: maxAttempts,
      }) as {outcome?: string}
      if (!value || !["retry", "rejected", "awaiting_observation", "release", "stale", "lost_claim"].includes(String(value.outcome))) throw new Error("finish returned an invalid response")
      return value.outcome as string
    },
    async publish(id, token, revision) {
      return publishResult(await rpc("publish_product_refresh_candidate", {
        p_id: id, p_token: token, p_expected_revision: revision,
      }))
    },
    async currentProduct(id) {
      const {data, error} = await db.from("products")
        .select("updated_at,name,brand,category,subcategory,tags").eq("id", id).maybeSingle()
      rpcError("current product lookup", error)
      if (!data) return null
      const row = data as Record<string, unknown>
      if (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)) ||
        typeof row.name !== "string" || typeof row.brand !== "string" || typeof row.category !== "string" ||
        !(row.subcategory === null || typeof row.subcategory === "string") ||
        !(row.tags === null || Array.isArray(row.tags) && row.tags.every((tag) => typeof tag === "string"))) {
        throw new Error("current product lookup returned an invalid response")
      }
      return {...row, id} as CurrentProductSnapshot
    },
    async brandGenderScope(id) {
      const {data, error} = await db.from("brand_nodes").select("gender_scope").eq("id", id).maybeSingle()
      rpcError("brand gender scope lookup", error)
      if (!data) return null
      const scope = (data as {gender_scope?: unknown}).gender_scope
      if (!Array.isArray(scope) || !scope.every((value) =>
        value === "men" || value === "women" || value === "unisex")) {
        throw new Error("brand gender scope lookup returned an invalid response")
      }
      return scope
    },
    async publishNormalization(input) {
      return publishResult(await rpc("publish_product_refresh_candidate_normalization", {
        p_id: input.candidateId, p_token: input.token, p_expected_revision: input.revision,
        p_product_id: input.productId, p_expected_updated_at: input.expectedUpdatedAt,
        p_normalization: input.normalization,
        p_category: input.category, p_subcategory: input.subcategory,
      }))
    },
  }
}
