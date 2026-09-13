import type {SupabaseClient} from "@supabase/supabase-js"
import {
  auditDecimalId, createPipelineAuditManifest,
  type AuditBrand, type AuditCandidate, type AuditEmbedding, type AuditProduct, type PipelineAuditManifest,
} from "./pipeline-audit"

export async function readAuditPages<T>(options: {
  fetchPage: (cursor: string | null, limit: number) => Promise<T[]>
  id: (row: T) => string
  decimal?: boolean
  limit?: number
  pageSize?: number
}): Promise<T[]> {
  const rows: T[] = []
  let cursor: string | null = null
  const pageSize = options.pageSize ?? 500
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))) throw new Error("Invalid audit pagination limits")
  for (;;) {
    const count = Math.min(pageSize, options.limit === undefined ? pageSize : options.limit - rows.length)
    if (count <= 0) break
    const page = await options.fetchPage(cursor, count)
    if (!Array.isArray(page) || page.length > count) throw new Error("Invalid audit page")
    for (const row of page) {
      const id = options.id(row)
      if (!id || (cursor !== null && (options.decimal ? BigInt(id) <= BigInt(cursor) : id <= cursor))) throw new Error("Audit cursor did not advance")
      cursor = id
      rows.push(row)
    }
    if (page.length < count) break
  }
  return rows
}

export async function readPipelineAudit(db: SupabaseClient, options: {
  platform?: string
  limit?: number
  maxObservationAgeHours?: number
  now?: string
} = {}): Promise<PipelineAuditManifest> {
  const maxAge = options.maxObservationAgeHours ?? 24
  if (!Number.isFinite(maxAge) || maxAge <= 0) throw new Error("Invalid observation age")
  const timeout = () => AbortSignal.timeout(30_000)
  const products = await readAuditPages<AuditProduct>({decimal: true, limit: options.limit, id: (row) => row.id,
    fetchPage: async (cursor, limit) => {
      let query = db.from("products").select("id,product_url,platform,brand,brand_node_id,updated_at,price,original_price,sale_price,in_stock,image_url,image_revision,review_count,reviews_observed_at").order("id", {ascending: true}).limit(limit)
      if (cursor) query = query.gt("id", cursor)
      if (options.platform) query = query.eq("platform", options.platform)
      const {data, error} = await query.abortSignal(timeout())
      if (error) throw new Error("Audit product read failed")
      return (data ?? []).map((row) => ({...row, id: auditDecimalId(row.id), brand_node_id: row.brand_node_id === null ? null : auditDecimalId(row.brand_node_id), image_revision: auditDecimalId(row.image_revision)})) as AuditProduct[]
    },
  })
  const brands = await readAuditPages<AuditBrand>({decimal: true, id: (row) => row.id,
    fetchPage: async (cursor, limit) => {
      let query = db.from("brand_nodes").select("id,brand_name,brand_name_normalized").order("id", {ascending: true}).limit(limit)
      if (cursor) query = query.gt("id", cursor)
      const {data, error} = await query.abortSignal(timeout())
      if (error) throw new Error("Audit brand read failed")
      return (data ?? []).map((row) => ({...row, id: auditDecimalId(row.id)})) as AuditBrand[]
    },
  })
  const reviewCounts = new Map(products.map((product) => [product.id, 0]))
  const embeddings: AuditEmbedding[] = []
  for (let start = 0; start < products.length; start += 150) {
    const ids = products.slice(start, start + 150).map((product) => product.id)
    const reviews = await readAuditPages<{id: string; product_id: string}>({id: (row) => row.id,
      fetchPage: async (cursor, limit) => {
        let query = db.from("product_reviews").select("id,product_id").in("product_id", ids).order("id", {ascending: true}).limit(limit)
        if (cursor) query = query.gt("id", cursor)
        const {data, error} = await query.abortSignal(timeout())
        if (error) throw new Error("Audit review read failed")
        return (data ?? []).map((row) => ({id: String(row.id), product_id: auditDecimalId(row.product_id)}))
      },
    })
    for (const review of reviews) {
      if (!reviewCounts.has(review.product_id)) throw new Error("Review outside audited scope")
      reviewCounts.set(review.product_id, reviewCounts.get(review.product_id)! + 1)
    }
    const {data, error} = await db.from("product_embeddings")
      .select("product_id,source_image_url,source_image_revision,embedded_at,embedding_model")
      .in("product_id", ids).order("product_id", {ascending: true}).limit(150).abortSignal(timeout())
    if (error) throw new Error("Audit embedding read failed")
    embeddings.push(...(data ?? []).map((row) => ({...row, product_id: auditDecimalId(row.product_id), source_image_revision: row.source_image_revision === null ? null : auditDecimalId(row.source_image_revision)})) as AuditEmbedding[])
  }
  const candidates = await readAuditPages<AuditCandidate>({decimal: true, limit: options.limit, id: (row) => row.id,
    fetchPage: async (cursor, limit) => {
      let query = db.from("product_refresh_candidates")
        .select("id,platform_key,product_url,status,updated_at,observation_revision,prepared_observation_revision,raw_observed_at,matched_brand_node_id,imported_product_id,processing_token,lease_expires_at,attempt_count,last_error_code,normalization_result,raw_product")
        .order("id", {ascending: true}).limit(limit)
      if (cursor) query = query.gt("id", cursor)
      if (options.platform) query = query.eq("platform_key", options.platform)
      const {data, error} = await query.abortSignal(timeout())
      if (error) throw new Error("Audit candidate read failed")
      return (data ?? []).map((row) => ({...row,
        id: auditDecimalId(row.id), observation_revision: auditDecimalId(row.observation_revision),
        prepared_observation_revision: row.prepared_observation_revision === null ? null : auditDecimalId(row.prepared_observation_revision),
        matched_brand_node_id: row.matched_brand_node_id === null ? null : auditDecimalId(row.matched_brand_node_id),
        imported_product_id: row.imported_product_id === null ? null : auditDecimalId(row.imported_product_id),
      })) as AuditCandidate[]
    },
  })
  return createPipelineAuditManifest({products, candidates, embeddings, brands, reviewCounts,
    now: options.now ?? new Date().toISOString(), scope: {platform: options.platform ?? null, limit: options.limit ?? null, max_observation_age_hours: maxAge}})
}
