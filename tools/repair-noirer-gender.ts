#!/usr/bin/env npx tsx
/**
 * Repair NOIRER's legacy brand-scope contamination.
 *
 * The brand operates official MEN and WOMEN departments, so brand scope is
 * unisex (mixed catalogue), while each product keeps its department gender.
 * Dry-run by default; pass --apply to write. No rows are deleted.
 */
import {createClient} from "@supabase/supabase-js"

type Gender = "men" | "women"
type ProductRow = {
  id: number
  gender: unknown
  gender_source: string | null
  product_url: string
}
type BrandRow = {
  id: number
  brand_name: string
  gender_scope: unknown
  wiki: Record<string, unknown> | null
}

const BRAND_ID = 5230
const EXPECTED_BRAND = "NOIRER"
const CATEGORY_GENDER = new Map<number, Gender>([
  [76, "men"],
  [202, "men"],
  [321, "men"],
  [341, "men"],
  [180, "women"],
  [326, "women"],
])
const OFFICIAL_SOURCES = [
  "https://noirer.com/category/men/76/",
  "https://noirer.com/category/women/180/",
]

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function cateNo(url: string): number | null {
  try {
    const value = new URL(url).searchParams.get("cate_no")
    return value && /^\d+$/.test(value) ? Number(value) : null
  } catch {
    return null
  }
}

const {data: brandData, error: brandError} = await db
  .from("brand_nodes")
  .select("id,brand_name,gender_scope,wiki")
  .eq("id", BRAND_ID)
  .single()
if (brandError) throw brandError
const brand = brandData as BrandRow
if (brand.brand_name !== EXPECTED_BRAND) {
  throw new Error(`brand precondition failed: expected ${EXPECTED_BRAND}, found ${brand.brand_name}`)
}

const products: ProductRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db
    .from("products")
    .select("id,gender,gender_source,product_url")
    .eq("brand_node_id", BRAND_ID)
    .order("id")
    .range(offset, offset + 999)
  if (error) throw error
  products.push(...data as ProductRow[])
  if (!data || data.length < 1000) break
}

const decisions = products.map((product) => {
  const category = cateNo(product.product_url)
  const gender = category === null ? undefined : CATEGORY_GENDER.get(category)
  if (!gender) throw new Error(`unmapped product category: id=${product.id} url=${product.product_url}`)
  return {id: product.id, category, gender}
})
const counts = {men: 0, women: 0}
for (const decision of decisions) counts[decision.gender]++

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  brand: {id: brand.id, name: brand.brand_name, before: brand.gender_scope, after: ["unisex"]},
  products: products.length,
  counts,
}, null, 2))

if (apply) {
  const verifiedAt = new Date().toISOString()
  const nextWiki = {
    ...(brand.wiki ?? {}),
    gender: "공용",
    gender_verified_at: verifiedAt,
    gender_confidence: 0.99,
    gender_sources: OFFICIAL_SOURCES,
    gender_verification_rule: "official_store_separate_men_women_departments",
  }
  const {data: updatedBrand, error: updateBrandError} = await db
    .from("brand_nodes")
    .update({gender_scope: ["unisex"], wiki: nextWiki})
    .eq("id", BRAND_ID)
    .eq("brand_name", EXPECTED_BRAND)
    .select("id,gender_scope")
  if (updateBrandError) throw updateBrandError
  if (!updatedBrand || updatedBrand.length !== 1) throw new Error("brand update affected an unexpected number of rows")

  let updatedProducts = 0
  for (const gender of ["men", "women"] as const) {
    const group = decisions.filter((decision) => decision.gender === gender)
    for (let i = 0; i < group.length; i += 100) {
      const ids = group.slice(i, i + 100).map((decision) => decision.id)
      const {data: updated, error} = await db
        .from("products")
        .update({gender: [gender], gender_source: "repair_url", updated_at: verifiedAt})
        .in("id", ids)
        .eq("brand_node_id", BRAND_ID)
        .select("id")
      if (error) throw error
      if ((updated?.length ?? 0) !== ids.length) {
        throw new Error(`product update count mismatch: expected=${ids.length} actual=${updated?.length ?? 0}`)
      }
      updatedProducts += updated.length
    }
  }
  console.log(`updated_brand=1 updated_products=${updatedProducts}`)
}

const {data: verifiedBrand, error: verifyBrandError} = await db
  .from("brand_nodes")
  .select("gender_scope")
  .eq("id", BRAND_ID)
  .single()
if (verifyBrandError) throw verifyBrandError

const {data: distribution, error: distributionError} = await db
  .from("products")
  .select("gender,gender_source")
  .eq("brand_node_id", BRAND_ID)
if (distributionError) throw distributionError
const actual = new Map<string, number>()
for (const row of distribution ?? []) {
  const key = `${JSON.stringify(row.gender)}\t${row.gender_source ?? "null"}`
  actual.set(key, (actual.get(key) ?? 0) + 1)
}
console.log(JSON.stringify({verifiedBrandScope: verifiedBrand.gender_scope, distribution: Object.fromEntries(actual)}, null, 2))
