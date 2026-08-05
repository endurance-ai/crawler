#!/usr/bin/env npx tsx
/** Read-only recrawl plan for brand nodes whose gender scope changed in this audit. */
import {createClient} from "@supabase/supabase-js"
import {getSiteConfig} from "../src/configs/platforms"

const CHANGED_BRAND_IDS = [
  22, 31, 32, 34, 48, 77, 103, 135, 159, 187, 208, 210, 213, 216, 394,
  455, 501, 534, 5530, 589, 660, 690, 697, 945, 1103, 1106, 1138, 1147,
  1182, 1211, 1215, 1247, 1292, 1340, 1379, 1401, 1435, 1461, 1581, 1596,
  1739, 1749, 1841, 1863, 1865, 1908, 1936, 1946, 2016, 2050, 2205, 2352,
  2368, 2669, 2745, 2762, 2794, 2808, 3656, 3685, 3765, 3789, 3835, 5189,
  5229, 5230, 5245, 5258, 5290, 5381, 5396, 5417, 5432, 5793, 5834, 5836,
  5839, 5840, 5842, 5847, 5848, 5852, 5856,
] as const

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

const [{data: brands, error: brandError}, {data: statuses, error: statusError}, {data: products, error: productError}] = await Promise.all([
  db.from("brand_nodes").select("id,brand_name,gender_scope").in("id", [...CHANGED_BRAND_IDS]).order("id"),
  db.from("product_crawl_status").select("brand_node_id,platform_key,platform_type,status,config_status,imported_at").in("brand_node_id", [...CHANGED_BRAND_IDS]),
  db.from("products").select("id,brand_node_id,platform,gender,gender_source").in("brand_node_id", [...CHANGED_BRAND_IDS]),
])
if (brandError) throw brandError
if (statusError) throw statusError
if (productError) throw productError

const statusById = new Map((statuses ?? []).map((row) => [row.brand_node_id as number, row]))
// `brand_fallback` 은 세지 않는다 — GENDER_SOURCE_VALUES 에 없는 값이고 DB 에도
// 0행이다 (2026-08-05 확인). 브랜드 스코프 폴백은 2026-08 회귀에서 복원되지
// 않았으므로 앞으로도 생기지 않는다 (src/lib/product-gender.ts 헤더).
const productStats = new Map<number, {total: number; configDefault: number; unverifiedLegacy: number; platforms: Record<string, number>}>()
for (const product of products ?? []) {
  const id = product.brand_node_id as number
  const stats = productStats.get(id) ?? {total: 0, configDefault: 0, unverifiedLegacy: 0, platforms: {}}
  stats.total++
  if (product.gender_source === "config_default") stats.configDefault++
  if (product.gender_source === "unverified_legacy") stats.unverifiedLegacy++
  if (typeof product.platform === "string") stats.platforms[product.platform] = (stats.platforms[product.platform] ?? 0) + 1
  productStats.set(id, stats)
}

const rows = (brands ?? []).map((brand) => {
  const status = statusById.get(brand.id as number)
  const platformKey = typeof status?.platform_key === "string" ? status.platform_key : null
  const config = platformKey ? getSiteConfig(platformKey) : undefined
  const eligible = Boolean(config && !config.disabled && status?.status && ["imported", "embedded", "crawled", "qc_failed"].includes(status.status as string))
  return {
    brandId: brand.id,
    brandName: brand.brand_name,
    genderScope: brand.gender_scope,
    platformKey,
    platformType: status?.platform_type ?? null,
    crawlStatus: status?.status ?? null,
    configStatus: status?.config_status ?? null,
    configFound: Boolean(config),
    configType: config?.type ?? null,
    configDisabled: config?.disabled ?? null,
    eligible,
    products: productStats.get(brand.id as number) ?? {total: 0, configDefault: 0, unverifiedLegacy: 0, platforms: {}},
  }
})

const totals = {
  changedBrands: rows.length,
  withProducts: rows.filter((row) => row.products.total > 0).length,
  products: rows.reduce((sum, row) => sum + row.products.total, 0),
  fallbackProducts: rows.reduce((sum, row) => sum + row.products.configDefault + row.products.unverifiedLegacy, 0),
  withStatus: rows.filter((row) => row.platformKey).length,
  configFound: rows.filter((row) => row.configFound).length,
  eligible: rows.filter((row) => row.eligible).length,
}
console.log(JSON.stringify(totals, null, 2))
console.log("eligible:")
for (const row of rows.filter((item) => item.eligible)) {
  console.log(`${row.brandId}\t${row.brandName}\t${row.platformKey}\t${row.configType}\tproducts=${row.products.total}`)
}
const sourcePlatforms: Record<string, {products: number; affected: number; brands: Set<number>; sources: Record<string, number>}> = {}
for (const row of rows) {
  for (const [platform, count] of Object.entries(row.products.platforms)) {
    const item = sourcePlatforms[platform] ?? {products: 0, affected: 0, brands: new Set<number>(), sources: {}}
    item.products += count
    item.brands.add(row.brandId as number)
    sourcePlatforms[platform] = item
  }
}
for (const product of products ?? []) {
  if (typeof product.platform !== "string") continue
  const item = sourcePlatforms[product.platform]
  if (item) {
    const source = typeof product.gender_source === "string" ? product.gender_source : "(null)"
    item.sources[source] = (item.sources[source] ?? 0) + 1
  }
  if (!["config_default", "unverified_legacy"].includes(product.gender_source as string)) continue
  if (item) item.affected++
}
console.log("source-platforms:")
for (const [platform, item] of Object.entries(sourcePlatforms).sort((a, b) => b[1].products - a[1].products)) {
  const sources = Object.entries(item.sources)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source}:${count}`)
    .join(",")
  console.log(`${platform}\tproducts=${item.products}\taffected=${item.affected}\tbrands=${item.brands.size}\tconfig=${Boolean(getSiteConfig(platform))}\tsources=${sources}`)
}
if (!process.argv.includes("--summary")) for (const row of rows) console.log(JSON.stringify(row))
