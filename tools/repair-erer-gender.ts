#!/usr/bin/env npx tsx
/**
 * Repair ERER products from the official WOMEN/MEN department membership.
 * Products exposed in both departments are explicitly unisex. Dry-run by
 * default; pass --apply to write. Products absent from the current official
 * departments are reported and left unchanged.
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

const BRAND_ID = 5412
const BRAND_NAME = "ERER (에르에르)"
const BASE_URL = "https://erer.kr"
const DEPARTMENTS = {
  women: 118,
  men: 119,
} as const
const REQUESTED_WOMEN_PRODUCT_NOS = new Set(["975", "976", "977", "978", "979", "980"])
const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function productNo(productUrl: string): string | null {
  try {
    const url = new URL(productUrl)
    return url.searchParams.get("product_no")
      ?? url.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/i)?.[1]
      ?? null
  } catch {
    return null
  }
}

function categoryProductNos(html: string, cateNo: number): Set<string> {
  const numbers = new Set<string>()
  const query = new RegExp(`product_no=(\\d+)&(?:amp;)?cate_no=${cateNo}(?:&|&amp;|["'])`, "gi")
  for (const match of html.matchAll(query)) numbers.add(match[1])
  const pretty = new RegExp(`/product/[^"']+/(\\d+)/category/${cateNo}/display/\\d+`, "gi")
  for (const match of html.matchAll(pretty)) numbers.add(match[1])
  return numbers
}

function lastPage(html: string, cateNo: number): number {
  let last = 1
  const pattern = new RegExp(`(?:\\?|&)cate_no=${cateNo}(?:&|&amp;)page=(\\d+)|[?&]page=(\\d+)[^"']*cate_no=${cateNo}`, "gi")
  for (const match of html.matchAll(pattern)) last = Math.max(last, Number(match[1] ?? match[2] ?? 1))
  const explicit = /page=(\d+)["'][^>]*class=["']last["']/gi
  for (const match of html.matchAll(explicit)) last = Math.max(last, Number(match[1]))
  return last
}

async function fetchDepartment(cateNo: number): Promise<Set<string>> {
  const fetchPage = async (page: number): Promise<string> => {
    const response = await fetch(`${BASE_URL}/product/list.html?cate_no=${cateNo}&page=${page}`, {
      headers: {"User-Agent": "Mozilla/5.0 (compatible; kiko-gender-repair/1.0)"},
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`ERER category ${cateNo} page ${page}: HTTP ${response.status}`)
    return response.text()
  }
  const first = await fetchPage(1)
  const pages = lastPage(first, cateNo)
  const htmlPages = [first]
  for (let page = 2; page <= pages; page += 1) htmlPages.push(await fetchPage(page))
  const numbers = new Set<string>()
  for (const html of htmlPages) {
    for (const number of categoryProductNos(html, cateNo)) numbers.add(number)
  }
  if (numbers.size === 0) throw new Error(`ERER category ${cateNo}: no products found`)
  return numbers
}

const [women, men] = await Promise.all([
  fetchDepartment(DEPARTMENTS.women),
  fetchDepartment(DEPARTMENTS.men),
])
for (const number of REQUESTED_WOMEN_PRODUCT_NOS) {
  if (!women.has(number) || men.has(number)) {
    throw new Error(`Henley department precondition failed: product_no=${number}`)
  }
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

const decisions: Array<{id: number; productNo: string; gender: Gender}> = []
const unmatched: ProductRow[] = []
for (const product of products) {
  const number = productNo(product.product_url)
  if (!number) {
    unmatched.push(product)
    continue
  }
  const inWomen = women.has(number)
  const inMen = men.has(number)
  if (!inWomen && !inMen) {
    unmatched.push(product)
    continue
  }
  decisions.push({
    id: product.id,
    productNo: number,
    gender: inWomen && inMen ? "unisex" : inWomen ? "women" : "men",
  })
}

const counts: Record<Gender, number> = {men: 0, women: 0, unisex: 0}
for (const decision of decisions) counts[decision.gender] += 1
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  official: {women: women.size, men: men.size, overlap: [...women].filter((number) => men.has(number)).length},
  brand: {id: brand.id, before: brand.gender_scope, after: ["unisex"]},
  database: {total: products.length, matched: decisions.length, unmatched: unmatched.length, counts},
}, null, 2))

if (apply) {
  const verifiedAt = new Date().toISOString()
  const nextWiki = {
    ...(brand.wiki ?? {}),
    gender: "공용",
    gender_verified_at: verifiedAt,
    gender_confidence: 0.99,
    gender_sources: [
      `${BASE_URL}/product/list.html?cate_no=${DEPARTMENTS.women}`,
      `${BASE_URL}/product/list.html?cate_no=${DEPARTMENTS.men}`,
    ],
    gender_verification_rule: "official_department_membership_with_overlap_as_unisex",
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
    const group = decisions.filter((decision) => decision.gender === gender)
    for (let index = 0; index < group.length; index += 100) {
      const ids = group.slice(index, index + 100).map((decision) => decision.id)
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

const {data: requested, error: requestedError} = await db
  .from("products")
  .select("id,name,gender,gender_source,product_url")
  .eq("brand_node_id", BRAND_ID)
  .like("name", "[2차 리오더] Henley%")
  .order("id")
if (requestedError) throw requestedError
console.log(JSON.stringify({requested}, null, 2))
