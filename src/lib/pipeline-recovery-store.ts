import type {SupabaseClient} from "@supabase/supabase-js"
import {auditDecimalId, type AuditBrand, type AuditEmbedding, type AuditProduct} from "./pipeline-audit"
import {readAuditPages} from "./pipeline-audit-reader"
import type {RecoveryCandidate, RecoveryStore} from "./pipeline-recovery"

interface FilterBuilder {
  eq(column: string, value: unknown): FilterBuilder
  is(column: string, value: null): FilterBuilder
  select(columns: string): PromiseLike<{data: Array<{id?: unknown; product_id?: unknown}> | null; error: {message: string} | null}>
}

function nullableFilter(query: FilterBuilder, column: string, value: unknown, jsonb = false): FilterBuilder {
  return value === null ? query.is(column, null) : query.eq(column, jsonb ? JSON.stringify(value) : value)
}

function one<T>(data: T[] | null, error: {message: string} | null, label: string): T | null {
  if (error) throw new Error(`${label} failed`)
  if (!data || data.length === 0) return null
  if (data.length !== 1) throw new Error(`${label} returned multiple rows`)
  return data[0]
}

export class SupabaseRecoveryStore implements RecoveryStore {
  constructor(private readonly db: SupabaseClient) {}

  async readCandidate(id: string): Promise<RecoveryCandidate | null> {
    const {data, error} = await this.db.from("product_refresh_candidates")
      .select("id,platform_key,product_url,status,updated_at,observation_revision,prepared_observation_revision,raw_observed_at,matched_brand_node_id,imported_product_id,processing_token,processing_observation_revision,processing_max_age_hours,lease_expires_at,attempt_count,last_error_code,normalization_result,raw_product,enriched_product,next_attempt_at,last_error")
      .eq("id", id).limit(2)
    const row = one(data, error, "Candidate read")
    if (!row) return null
    return {
      ...row,
      id: auditDecimalId(row.id),
      observation_revision: auditDecimalId(row.observation_revision),
      prepared_observation_revision: row.prepared_observation_revision === null ? null : auditDecimalId(row.prepared_observation_revision),
      matched_brand_node_id: row.matched_brand_node_id === null ? null : auditDecimalId(row.matched_brand_node_id),
      imported_product_id: row.imported_product_id === null ? null : auditDecimalId(row.imported_product_id),
      processing_observation_revision: row.processing_observation_revision === null ? null : auditDecimalId(row.processing_observation_revision),
    } as RecoveryCandidate
  }

  async updateCandidate(current: RecoveryCandidate, patch: Record<string, unknown>): Promise<boolean> {
    let query = this.db.from("product_refresh_candidates").update(patch)
      .eq("id", current.id).eq("platform_key", current.platform_key)
      .eq("product_url", current.product_url).eq("status", current.status)
      .eq("updated_at", current.updated_at).eq("observation_revision", current.observation_revision)
      .eq("attempt_count", current.attempt_count) as unknown as FilterBuilder
    for (const [column, value] of [
      ["prepared_observation_revision", current.prepared_observation_revision],
      ["raw_observed_at", current.raw_observed_at],
      ["matched_brand_node_id", current.matched_brand_node_id],
      ["imported_product_id", current.imported_product_id],
      ["processing_token", current.processing_token],
      ["processing_observation_revision", current.processing_observation_revision],
      ["processing_max_age_hours", current.processing_max_age_hours],
      ["lease_expires_at", current.lease_expires_at],
      ["last_error_code", current.last_error_code],
      ["normalization_result", current.normalization_result],
      ["enriched_product", current.enriched_product],
      ["next_attempt_at", current.next_attempt_at],
      ["last_error", current.last_error],
    ] as const) query = nullableFilter(query, column, value,
      column === "normalization_result" || column === "enriched_product")
    const {data, error} = await query.select("id")
    if (error) throw new Error("Candidate conditional update failed")
    return data?.length === 1
  }

  async readProduct(id: string): Promise<AuditProduct | null> {
    const {data, error} = await this.db.from("products")
      .select("id,product_url,platform,brand,brand_node_id,updated_at,price,original_price,sale_price,in_stock,image_url,image_revision,review_count,reviews_observed_at")
      .eq("id", id).limit(2)
    const row = one(data, error, "Product read")
    if (!row) return null
    return {
      ...row,
      id: auditDecimalId(row.id),
      brand_node_id: row.brand_node_id === null ? null : auditDecimalId(row.brand_node_id),
      image_revision: auditDecimalId(row.image_revision),
    } as AuditProduct
  }

  async updateProduct(current: AuditProduct, patch: Record<string, unknown>): Promise<boolean> {
    let query = this.db.from("products").update(patch)
      .eq("id", current.id).eq("product_url", current.product_url)
      .eq("brand", current.brand).eq("updated_at", current.updated_at)
      .eq("in_stock", current.in_stock).eq("image_revision", current.image_revision)
      .eq("review_count", current.review_count ?? 0) as unknown as FilterBuilder
    for (const [column, value] of [
      ["platform", current.platform], ["brand_node_id", current.brand_node_id],
      ["price", current.price], ["original_price", current.original_price],
      ["sale_price", current.sale_price], ["image_url", current.image_url],
      ["reviews_observed_at", current.reviews_observed_at],
    ] as const) query = nullableFilter(query, column, value)
    const {data, error} = await query.select("id")
    if (error) throw new Error("Product conditional update failed")
    return data?.length === 1
  }

  async readBrands(): Promise<AuditBrand[]> {
    return readAuditPages<AuditBrand>({decimal: true, id: (row) => row.id,
      fetchPage: async (cursor, limit) => {
        let query = this.db.from("brand_nodes")
          .select("id,brand_name,brand_name_normalized").order("id", {ascending: true}).limit(limit)
        if (cursor) query = query.gt("id", cursor)
        const {data, error} = await query
        if (error) throw new Error("Brand verification read failed")
        return (data ?? []).map((row) => ({...row, id: auditDecimalId(row.id)})) as AuditBrand[]
      },
    })
  }

  async countReviews(productId: string): Promise<number> {
    const {count, error} = await this.db.from("product_reviews")
      .select("id", {count: "exact", head: true}).eq("product_id", productId)
    if (error || count === null) throw new Error("Review count verification failed")
    return count
  }

  async readEmbedding(productId: string): Promise<AuditEmbedding | null> {
    const {data, error} = await this.db.from("product_embeddings")
      .select("product_id,source_image_url,source_image_revision,embedded_at,embedding_model")
      .eq("product_id", productId).limit(2)
    const row = one(data, error, "Embedding read")
    if (!row) return null
    return {
      ...row,
      product_id: auditDecimalId(row.product_id),
      source_image_revision: row.source_image_revision === null ? null : auditDecimalId(row.source_image_revision),
    } as AuditEmbedding
  }

  async deleteEmbedding(current: AuditEmbedding): Promise<boolean> {
    let query = this.db.from("product_embeddings").delete()
      .eq("product_id", current.product_id)
      .eq("embedded_at", current.embedded_at)
      .eq("embedding_model", current.embedding_model) as unknown as FilterBuilder
    query = nullableFilter(query, "source_image_url", current.source_image_url)
    query = nullableFilter(query, "source_image_revision", current.source_image_revision)
    const {data, error} = await query.select("product_id")
    if (error) throw new Error("Embedding conditional delete failed")
    return data?.length === 1
  }
}
