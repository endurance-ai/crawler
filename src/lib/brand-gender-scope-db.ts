import type {SupabaseClient} from "@supabase/supabase-js"

import {
  shouldWidenBrandScopeToUnisex,
  summarizeTrustedBrandGenderEvidence,
  type BrandGenderEvidenceSummary,
  type BrandGenderProductEvidence,
} from "./brand-gender-scope"

interface BrandRow {
  id: number
  brand_name: string
  gender_scope: unknown
  wiki: Record<string, unknown> | null
}

interface ProductRow extends BrandGenderProductEvidence {
  id: number
  brand_node_id: number
}

export interface BrandScopeWidening {
  brandId: number
  brandName: string
  before: unknown
  after: ["unisex"]
  homepageUrl: string | null
  evidence: BrandGenderEvidenceSummary
}

async function loadBrands(db: SupabaseClient, brandIds?: number[]): Promise<BrandRow[]> {
  const rows: BrandRow[] = []
  const chunks = brandIds?.length ? Array.from({length: Math.ceil(brandIds.length / 100)}, (_, i) => brandIds.slice(i * 100, i * 100 + 100)) : [null]
  for (const ids of chunks) {
    for (let offset = 0; ; offset += 1000) {
      let query = db.from("brand_nodes").select("id,brand_name,gender_scope,wiki").order("id").range(offset, offset + 999)
      if (ids) query = query.in("id", ids)
      const {data, error} = await query
      if (error) throw error
      rows.push(...(data as BrandRow[]))
      if (!data || data.length < 1000) break
    }
  }
  return rows
}

async function loadProducts(db: SupabaseClient, brandIds?: number[]): Promise<ProductRow[]> {
  const rows: ProductRow[] = []
  const chunks = brandIds?.length ? Array.from({length: Math.ceil(brandIds.length / 100)}, (_, i) => brandIds.slice(i * 100, i * 100 + 100)) : [null]
  for (const ids of chunks) {
    for (let offset = 0; ; offset += 1000) {
      let query = db.from("products").select("id,brand_node_id,gender,gender_source").order("id").range(offset, offset + 999)
      if (ids) query = query.in("brand_node_id", ids)
      const {data, error} = await query
      if (error) throw error
      rows.push(...(data as ProductRow[]))
      if (!data || data.length < 1000) break
    }
  }
  return rows
}

function nextWiki(row: BrandRow, evidence: BrandGenderEvidenceSummary, officialSources: string[]): Record<string, unknown> {
  const wiki = row.wiki && typeof row.wiki === "object" ? row.wiki : {}
  const {
    gender_verified_at: previousVerifiedAt,
    gender_confidence: previousConfidence,
    gender_sources: previousSources,
    ...rest
  } = wiki
  const inferredAt = new Date().toISOString()
  return {
    ...rest,
    gender: "공용",
    gender_verified_at: inferredAt,
    gender_confidence: 0.99,
    gender_sources: officialSources,
    gender_inferred_at: inferredAt,
    gender_inference: {
      rule: "trusted_product_gender_union",
      trusted_men: evidence.trustedMen,
      trusted_women: evidence.trustedWomen,
      trusted_unisex: evidence.trustedUnisex,
      sample_men_product_ids: evidence.sampleMenProductIds,
      sample_women_product_ids: evidence.sampleWomenProductIds,
      sample_unisex_product_ids: evidence.sampleUnisexProductIds,
    },
    ...((previousVerifiedAt !== undefined || previousConfidence !== undefined || previousSources !== undefined)
      ? {
          gender_verification_superseded: {
            at: inferredAt,
            reason: "contradicted_by_trusted_product_gender_union",
            previous_gender: wiki.gender,
            previous_verified_at: previousVerifiedAt,
            previous_confidence: previousConfidence,
            previous_sources: previousSources,
          },
        }
      : {}),
  }
}

export async function reconcileBrandGenderScopes(
  db: SupabaseClient,
  options: {brandIds?: number[]; apply?: boolean; verifiedSources?: Map<number, string[]>} = {},
): Promise<BrandScopeWidening[]> {
  const brandIds = options.brandIds ? [...new Set(options.brandIds)] : undefined
  if (brandIds?.length === 0) return []
  const [brands, products] = await Promise.all([loadBrands(db, brandIds), loadProducts(db, brandIds)])
  const productsByBrand = new Map<number, ProductRow[]>()
  for (const product of products) {
    const list = productsByBrand.get(product.brand_node_id) ?? []
    list.push(product)
    productsByBrand.set(product.brand_node_id, list)
  }

  const widenings = brands.flatMap((brand): BrandScopeWidening[] => {
    const evidence = summarizeTrustedBrandGenderEvidence(productsByBrand.get(brand.id) ?? [])
    if (!shouldWidenBrandScopeToUnisex(brand.gender_scope, evidence)) return []
    const homepageUrl = typeof brand.wiki?.homepage_url === "string" ? brand.wiki.homepage_url : null
    return [{brandId: brand.id, brandName: brand.brand_name, before: brand.gender_scope, after: ["unisex"], homepageUrl, evidence}]
  })
  if (!options.apply) return widenings
  if (!options.verifiedSources) throw new Error("apply requires official verifiedSources")

  const verifiedWidenings = widenings.filter((item) => options.verifiedSources!.has(item.brandId))
  for (const item of verifiedWidenings) {
    const row = brands.find((brand) => brand.id === item.brandId)!
    const {error} = await db
      .from("brand_nodes")
      .update({gender_scope: item.after, wiki: nextWiki(row, item.evidence, options.verifiedSources.get(item.brandId)!)})
      .eq("id", item.brandId)
    if (error) throw error
  }
  return verifiedWidenings
}
