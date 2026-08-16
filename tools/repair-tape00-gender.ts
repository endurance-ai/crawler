#!/usr/bin/env npx tsx
/**
 * Repair 0Tape rows contaminated by the former site-wide unisex default.
 * Dry-run by default; pass --apply to write. No rows are deleted.
 */
import {createClient} from "@supabase/supabase-js"

type BrandRow = {
  id: number
  brand_name: string
  gender_scope: unknown
  wiki: Record<string, unknown> | null
}

const BRAND_ID = 2149
const BRAND_NAME = "0Tape"
const PLATFORM = "tape00"
const SOURCES = [
  "https://tape00.cafe24.com/product/list.html?cate_no=56",
  "https://tape00.cafe24.com/product/tress-sleeveless-white/146/category/63/display/1/",
]

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

const {data: brandData, error: brandError} = await db
  .from("brand_nodes")
  .select("id,brand_name,gender_scope,wiki")
  .eq("id", BRAND_ID)
  .single()
if (brandError) throw brandError
const brand = brandData as BrandRow
if (brand.brand_name !== BRAND_NAME) {
  throw new Error(`brand precondition failed: expected ${BRAND_NAME}, found ${brand.brand_name}`)
}

const products: Array<{id: number; gender: unknown; gender_source: string | null; product_url: string}> = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db
    .from("products")
    .select("id,gender,gender_source,product_url")
    .eq("platform", PLATFORM)
    .order("id")
    .range(offset, offset + 999)
  if (error) throw error
  products.push(...data)
  if (data.length < 1000) break
}
if (products.length === 0) throw new Error(`no products found for platform=${PLATFORM}`)
if (products.some((product) => !product.product_url.includes("tape00.cafe24.com/"))) {
  throw new Error("unexpected external product URL in 0Tape repair scope")
}

const before = new Map<string, number>()
for (const product of products) {
  const key = `${JSON.stringify(product.gender)}\t${product.gender_source ?? "null"}`
  before.set(key, (before.get(key) ?? 0) + 1)
}
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  brand: {id: brand.id, before: brand.gender_scope, after: ["women"]},
  products: products.length,
  before: Object.fromEntries(before),
  after: {gender: ["women"], gender_source: "config_default"},
}, null, 2))

if (apply) {
  const verifiedAt = new Date().toISOString()
  const nextWiki = {
    ...(brand.wiki ?? {}),
    gender: "여성",
    gender_verified_at: verifiedAt,
    gender_confidence: 0.99,
    gender_sources: SOURCES,
    gender_verification_rule: "official_womens_catalog_and_female_model_measurements",
  }
  const {data: updatedBrand, error: updateBrandError} = await db
    .from("brand_nodes")
    .update({gender_scope: ["women"], wiki: nextWiki})
    .eq("id", BRAND_ID)
    .eq("brand_name", BRAND_NAME)
    .select("id")
  if (updateBrandError) throw updateBrandError
  if (!updatedBrand || updatedBrand.length !== 1) throw new Error("brand update count mismatch")

  let updatedProducts = 0
  for (let index = 0; index < products.length; index += 100) {
    const ids = products.slice(index, index + 100).map((product) => product.id)
    const {data: updated, error} = await db
      .from("products")
      .update({gender: ["women"], gender_source: "config_default", updated_at: verifiedAt})
      .in("id", ids)
      .eq("platform", PLATFORM)
      .select("id")
    if (error) throw error
    if ((updated?.length ?? 0) !== ids.length) {
      throw new Error(`product update count mismatch: expected=${ids.length} actual=${updated?.length ?? 0}`)
    }
    updatedProducts += updated.length
  }
  console.log(`updated_brand=1 updated_products=${updatedProducts}`)
}

const {data: verifiedBrand, error: verifyBrandError} = await db
  .from("brand_nodes")
  .select("gender_scope")
  .eq("id", BRAND_ID)
  .single()
if (verifyBrandError) throw verifyBrandError
const {data: verifiedProducts, error: verifyProductsError} = await db
  .from("products")
  .select("gender,gender_source")
  .eq("platform", PLATFORM)
if (verifyProductsError) throw verifyProductsError
const distribution = new Map<string, number>()
for (const product of verifiedProducts) {
  const key = `${JSON.stringify(product.gender)}\t${product.gender_source ?? "null"}`
  distribution.set(key, (distribution.get(key) ?? 0) + 1)
}
console.log(JSON.stringify({
  verifiedBrandScope: verifiedBrand.gender_scope,
  verifiedProducts: verifiedProducts.length,
  distribution: Object.fromEntries(distribution),
}, null, 2))
