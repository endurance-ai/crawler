#!/usr/bin/env npx tsx
/**
 * Repair every ERER row from the category-parameter-free product detail.
 * The WOMEN and MEN listing pages overlap, so listing overlap is not evidence
 * of unisex. An explicit [UN] name is unisex; otherwise the canonical detail
 * hierarchy decides WOMEN/MEN. The separate top-level ACC department is shared.
 * Dry-run by default; pass --apply to write.
 */
import {createClient} from "@supabase/supabase-js"

type Gender = "men" | "women" | "unisex"
type ProductRow = {
  id: number
  name: string
  product_url: string
  gender: unknown
  gender_source: string | null
}
type BrandRow = {
  id: number
  brand_name: string
  gender_scope: unknown
  wiki: Record<string, unknown> | null
}
type CanonicalEvidence = {
  productNo: string
  gender: Gender | null
  categories: string[]
}
type Decision = {
  product: ProductRow
  productNo: string
  after: Gender
  categories: string[]
}

const BRAND_ID = 5412
const BRAND_NAME = "ERER (에르에르)"
const BASE_URL = "https://erer.kr"
const SHARED_ACC_CATEGORIES = new Set([120, 131, 132, 133, 134, 137])
const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function productNo(productUrl: string): string | null {
  try {
    const url = new URL(productUrl)
    return url.searchParams.get("product_no")
      ?? url.pathname.match(/\/product\/(?:[^/]+\/)?(\d+)(?:\/|$)/i)?.[1]
      ?? null
  } catch {
    return null
  }
}

function categoryNo(productUrl: string): number | null {
  try {
    const url = new URL(productUrl)
    const value = url.searchParams.get("cate_no")
      ?? url.pathname.match(/\/category\/(\d+)(?:\/|$)/i)?.[1]
    return value ? Number(value) : null
  } catch {
    return null
  }
}

function canonicalCategories(html: string): string[] {
  const info = html.match(/"oCategoryInfo":(\{.*?\}),"aProductPurchaseInfo_/s)?.[1] ?? ""
  return [...info.matchAll(/"category_name":"([^"]+)"/g)].map((match) => match[1].trim())
}

async function fetchCanonicalEvidence(number: string, name: string): Promise<CanonicalEvidence> {
  let response: Response | null = null
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`${BASE_URL}/product/detail.html?product_no=${number}`, {
        headers: {"User-Agent": "Mozilla/5.0 (compatible; kiko-gender-repair/2.0)"},
        signal: AbortSignal.timeout(20_000),
      })
      break
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 400))
    }
  }
  if (!response) throw lastError
  if (!response.ok) throw new Error(`ERER product_no=${number}: HTTP ${response.status}`)
  const categories = canonicalCategories(await response.text())
  const normalized = new Set(categories.map((category) => category.toUpperCase()))
  let gender: Gender | null = null
  if (/^\[UN\]/i.test(name.trim())) gender = "unisex"
  else if (normalized.has("WOMEN") !== normalized.has("MEN")) {
    gender = normalized.has("WOMEN") ? "women" : "men"
  } else if (normalized.has("ACC")) {
    gender = "unisex"
  }
  return {productNo: number, gender, categories}
}

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

const products: ProductRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db
    .from("products")
    .select("id,name,product_url,gender,gender_source")
    .eq("brand_node_id", BRAND_ID)
    .order("id")
    .range(offset, offset + 999)
  if (error) throw error
  products.push(...data as ProductRow[])
  if (!data || data.length < 1000) break
}

const namesByProductNo = new Map<string, string>()
for (const product of products) {
  const number = productNo(product.product_url)
  if (number && !namesByProductNo.has(number)) namesByProductNo.set(number, product.name)
}
const evidence = new Map<string, CanonicalEvidence>()
const entries = [...namesByProductNo]
for (let index = 0; index < entries.length; index += 6) {
  const batch = entries.slice(index, index + 6)
  const results = await Promise.all(batch.map(([number, name]) => fetchCanonicalEvidence(number, name)))
  for (const result of results) evidence.set(result.productNo, result)
}
for (const [number] of entries) {
  const canonical = evidence.get(number)
  if (canonical?.gender) continue
  const categories = products
    .filter((product) => productNo(product.product_url) === number)
    .map((product) => categoryNo(product.product_url))
  if (categories.length > 0 && categories.every((category) => category !== null && SHARED_ACC_CATEGORIES.has(category))) {
    evidence.set(number, {productNo: number, gender: "unisex", categories: ["ACC (legacy URL)"]})
  }
}

const decisions: Decision[] = []
const unresolved: ProductRow[] = []
for (const product of products) {
  const number = productNo(product.product_url)
  const canonical = number ? evidence.get(number) : undefined
  if (!number || !canonical?.gender) {
    unresolved.push(product)
    continue
  }
  decisions.push({product, productNo: number, after: canonical.gender, categories: canonical.categories})
}
if (unresolved.length > 0) {
  console.error(JSON.stringify({unresolved: unresolved.map(({id, name, product_url, gender, gender_source}) => ({
    id, name, product_url, gender, gender_source,
  }))}, null, 2))
  throw new Error(`canonical gender unresolved for ${unresolved.length} rows: ${unresolved.slice(0, 20).map((row) => row.id).join(",")}`)
}

const changed = decisions.filter(
  (decision) => JSON.stringify(decision.product.gender) !== JSON.stringify([decision.after])
    || decision.product.gender_source !== "repair_url",
)

const counts: Record<Gender, number> = {men: 0, women: 0, unisex: 0}
const changedCounts: Record<Gender, number> = {men: 0, women: 0, unisex: 0}
for (const decision of decisions) counts[decision.after] += 1
for (const decision of changed) changedCounts[decision.after] += 1
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  brand: {id: brand.id, before: brand.gender_scope, after: ["unisex"]},
  database: {
    total: products.length,
    uniqueProducts: evidence.size,
    resolved: decisions.length,
    unresolved: unresolved.length,
    counts,
    changes: changed.length,
    changedCounts,
  },
  changedWomen: changed
    .filter((decision) => decision.after === "women")
    .map(({product, productNo}) => ({
      id: product.id,
      name: product.name,
      productNo,
      before: product.gender,
      beforeSource: product.gender_source,
    })),
}, null, 2))

if (apply) {
  const verifiedAt = new Date().toISOString()
  const nextWiki = {
    ...(brand.wiki ?? {}),
    gender: "공용",
    gender_verified_at: verifiedAt,
    gender_confidence: 0.99,
    gender_sources: [
      `${BASE_URL}/product/list.html?cate_no=118`,
      `${BASE_URL}/product/list.html?cate_no=119`,
      `${BASE_URL}/product/detail.html?product_no={product_no}`,
    ],
    gender_verification_rule: "explicit_UN_else_category_parameter_free_detail_hierarchy",
  }
  const {data: updatedBrand, error: updateBrandError} = await db
    .from("brand_nodes")
    .update({gender_scope: ["unisex"], wiki: nextWiki})
    .eq("id", BRAND_ID)
    .eq("brand_name", BRAND_NAME)
    .select("id")
  if (updateBrandError) throw updateBrandError
  if (updatedBrand?.length !== 1) throw new Error("brand update count mismatch")

  let updatedProducts = 0
  for (const gender of ["women", "men", "unisex"] as const) {
    const group = changed.filter((decision) => decision.after === gender)
    for (let index = 0; index < group.length; index += 100) {
      const ids = group.slice(index, index + 100).map((decision) => decision.product.id)
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

const {data: verification, error: verificationError} = await db
  .from("products")
  .select("id,name,gender,gender_source,product_url")
  .eq("brand_node_id", BRAND_ID)
  .order("id")
if (verificationError) throw verificationError
const verificationMismatches = (verification ?? []).filter((row) => {
  const number = productNo(row.product_url)
  const expected = number ? evidence.get(number)?.gender : null
  return expected && JSON.stringify(row.gender) !== JSON.stringify([expected])
})
console.log(JSON.stringify({verification: {
  total: verification?.length ?? 0,
  mismatches: verificationMismatches.length,
  sample: verificationMismatches.slice(0, 20),
}}, null, 2))
