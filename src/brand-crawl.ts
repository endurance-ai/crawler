#!/usr/bin/env npx tsx
/**
 * Brand-node product crawl state CLI.
 *
 * Examples:
 *   pnpm brand-crawl -- list --status=not_started
 *   pnpm brand-crawl -- detect --brand-id=123
 *   pnpm brand-crawl -- detect --status=not_started --url=present --limit=20
 *   pnpm brand-crawl -- qc --brand-id=123 --site=matteveil
 *   pnpm brand-crawl -- mark --brand-id=123 --status=crawled --platform-key=matteveil
 */

import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

import {
  createProductCollectionClient,
  finishProductRun,
  loadProductCrawlBrand,
  startProductRun,
  upsertProductCrawlStatus,
  type ProductCollectionClient,
  type ProductCrawlBrand,
} from "./lib/product-collection"
import {getSiteConfig} from "./configs/platforms"
import {assessCafe24ProductQuality} from "./lib/cafe24-chain"
import type {Product} from "./lib/types"

type Flags = Record<string, string | boolean>

interface DetectResult {
  platform_type: "cafe24" | "shopify" | "custom"
  category_discovery: "manual" | "auto"
  platform_key: string
  categories: Array<Record<string, unknown>>
  detection: Record<string, unknown>
}

interface CrawledProduct {
  category?: unknown
  categories?: unknown
  color?: unknown
  colors?: unknown
  gender?: unknown
  gender_scope?: unknown
  price?: unknown
  source_price?: unknown
  imageUrl?: unknown
  image_url?: unknown
  images?: unknown
  inStock?: unknown
  in_stock?: unknown
}

function parseArgs(argv: string[]): {command: string; flags: Flags} {
  const args = [...argv]
  while (args[0] === "--") args.shift()
  const [command = "help", ...rest] = args
  const flags: Flags = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--" || !arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else {
      const key = arg.slice(2)
      const next = rest[i + 1]
      if (next && next !== "--" && !next.startsWith("--")) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    }
  }
  return {command, flags}
}

function stringFlag(flags: Flags, key: string): string | null {
  const value = flags[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberFlag(flags: Flags, key: string): number | null {
  const value = stringFlag(flags, key)
  if (!value) return null
  const num = Number(value)
  return Number.isInteger(num) && num > 0 ? num : null
}

function cleanSearch(value: string): string {
  return value.replace(/[,%]/g, " ").trim().slice(0, 100)
}

function normalizeHomepageUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("homepage_url must be http(s)")
  }
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function homepageUrl(brand: ProductCrawlBrand): string | null {
  if (brand.homepage_url?.trim()) return brand.homepage_url.trim()
  const wikiUrl = brand.wiki?.homepage_url
  return typeof wikiUrl === "string" && wikiUrl.trim() ? wikiUrl.trim() : null
}

function keyFromUrl(raw: string): string {
  const host = new URL(raw).hostname.replace(/^www\./, "")
  const first = host.split(".")[0] ?? "brand"
  const key = first.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^[^a-z]+/, "")
  return key.length >= 2 ? key.slice(0, 40) : `brand-${crypto.randomBytes(2).toString("hex")}`
}

async function fetchText(url: string): Promise<{status: number; text: string; finalUrl: string}> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 kiko.ai brand-node product crawl detector",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  })
  return {status: res.status, text: await res.text(), finalUrl: res.url}
}

async function probeShopifyProductsJson(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/products.json?limit=1", baseUrl)
    const res = await fetch(url, {
      headers: {"User-Agent": "Mozilla/5.0 kiko.ai brand-node product crawl detector", Accept: "application/json"},
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return false
    const json = (await res.json()) as {products?: unknown[]}
    return Array.isArray(json.products)
  } catch {
    return false
  }
}

/**
 * Minor-platform fingerprints checked against static homepage HTML.
 * platform_type stays within the DB CHECK values ('cafe24'|'shopify'|'custom');
 * the fine-grained family only lives in detection.platform_family so no
 * migration is needed. Order matters: specific platforms before the generic
 * "nextjs-headless" marker.
 */
const FAMILY_FINGERPRINTS: Array<{family: string; pattern: RegExp}> = [
  {family: "imweb", pattern: /imweb\.me|cdn\.imweb/i},
  {family: "sixshop", pattern: /sixshop/i},
  {family: "godomall", pattern: /godo\.co\.kr|godomall|nhn-commerce/i},
  {family: "makeshop", pattern: /makeshop/i},
  {family: "shopby", pattern: /shop-?by\.co\.kr|e-ncp\.com/i},
  {family: "woocommerce", pattern: /woocommerce/i},
  {family: "wix", pattern: /wixstatic\.com|wix\.com\/website/i},
  {family: "squarespace", pattern: /squarespace/i},
  {family: "demandware", pattern: /demandware|salesforce.*commerce/i},
  {family: "magento", pattern: /magento/i},
  {family: "nextjs-headless", pattern: /__NEXT_DATA__|\/_next\/static\//},
]

const BOT_CHALLENGE_PATTERN = /cf-chl|just a moment|challenge-platform|_incapsula_|akamai.*bot|px-captcha/i

async function probeWooStoreApi(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/wp-json/wc/store/v1/products?per_page=1", baseUrl)
    const res = await fetch(url, {
      headers: {"User-Agent": "Mozilla/5.0 kiko.ai brand-node product crawl detector", Accept: "application/json"},
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return false
    const json = (await res.json()) as unknown
    return Array.isArray(json)
  } catch {
    return false
  }
}

async function probeSitemap(baseUrl: string): Promise<boolean> {
  try {
    const {status, text} = await fetchText(new URL("/sitemap.xml", baseUrl).toString())
    return status >= 200 && status < 300 && (text.includes("<urlset") || text.includes("<sitemapindex"))
  } catch {
    return false
  }
}

/**
 * @MX:ANCHOR: [AUTO] Pure cate_no extraction seam (fan_in=1 caller today, but
 * kept pure + exported because two silent-corruption incidents already hit
 * this exact logic — see inline reasoning below). Extracts ONLY genuine
 * cafe24 product-category cate_no values from raw homepage HTML.
 * @MX:REASON: A naive `cate_no=(\d+)` scan matches cafe24 board-widget links
 * that reuse the same query param (dadadaseoul: board cate_no 9/13 replaced
 * the real 42/43/45.. categories, crawl 0). A naive `/category/slug/(\d+)/`
 * scan matches CDN upload paths (kyod/roseanne/wknd-project: editor image
 * paths like `/web/upload/category/editor/2025/12/07/hash.jpg` were read as
 * cate_no 2025). Both patterns below are anchored to a real `href="..."`
 * value spanning the whole match, and the pretty-URL form requires exactly
 * two path segments after `/category/` with no room for extra segments.
 */
export function extractCafe24CateNos(html: string): number[] {
  const cateNos = [
    ...[...html.matchAll(/\/product\/list\.html\?[^"'\s]*\bcate_no=(\d+)/g)].map((m) => Number(m[1])),
    ...[...html.matchAll(/href="(?:https?:\/\/[^"'/]+)?\/category\/[a-zA-Z0-9\-_%]+\/(\d+)\/?"/g)].map((m) =>
      Number(m[1]),
    ),
  ].filter((n) => Number.isInteger(n))
  return [...new Set(cateNos)].slice(0, 80)
}

async function detectBrand(brand: ProductCrawlBrand): Promise<DetectResult> {
  const rawHomepage = homepageUrl(brand)
  if (!rawHomepage) throw new Error("brand_nodes.wiki.homepage_url is required before product crawling")

  const homepage = normalizeHomepageUrl(rawHomepage)
  const [htmlResult, shopifyJsonOk, sitemapOk] = await Promise.all([
    fetchText(homepage),
    probeShopifyProductsJson(homepage),
    probeSitemap(homepage),
  ])
  const html = htmlResult.text
  const lower = html.toLowerCase()

  const cafe24Signals = [
    lower.includes("cafe24"),
    lower.includes("ec-image"),
    lower.includes("cate_no="),
    /\/product\/list\.html\?cate_no=/i.test(html),
  ]
  const shopifySignals = [
    shopifyJsonOk,
    /\/cdn\/shop\//i.test(html),
    /shopify\.com|cdn\.shopify|Shopify\.theme/i.test(html),
  ]

  let platformType: DetectResult["platform_type"] = "custom"
  if (cafe24Signals.some(Boolean)) platformType = "cafe24"
  else if (shopifySignals.some(Boolean)) platformType = "shopify"

  const botProtected =
    htmlResult.status === 403 || htmlResult.status === 503 || BOT_CHALLENGE_PATTERN.test(html)
  let platformFamily: string | null = platformType !== "custom" ? platformType : null
  if (!platformFamily && !botProtected) {
    platformFamily = FAMILY_FINGERPRINTS.find(({pattern}) => pattern.test(html))?.family ?? null
  }
  const wooStoreApiOk = platformFamily === "woocommerce" ? await probeWooStoreApi(homepage) : false
  const jsonldProduct = /"@type"\s*:\s*"?Product"?/.test(html)

  const uniqueCateNos = extractCafe24CateNos(html)
  const categories = uniqueCateNos.map((cateNo) => ({
    cateNo,
    gender: brand.gender_scope && brand.gender_scope.length > 0 ? brand.gender_scope : undefined,
  }))

  const categoryDiscovery = platformType === "cafe24" && categories.length > 0 ? "manual" : "auto"
  return {
    platform_type: platformType,
    category_discovery: categoryDiscovery,
    platform_key: brand.platform_key ?? keyFromUrl(homepage),
    categories,
    detection: {
      detected_at: new Date().toISOString(),
      brand_node_id: brand.brand_node_id,
      brand_name: brand.brand_name,
      homepage_url: homepage,
      homepage_status: htmlResult.status,
      final_url: htmlResult.finalUrl,
      html_bytes: html.length,
      platform_family: platformFamily,
      bot_protected: botProtected,
      needs_browser: botProtected,
      jsonld_product: jsonldProduct,
      sitemap: sitemapOk,
      signals: {
        cafe24: cafe24Signals,
        shopify: shopifySignals,
        shopify_products_json: shopifyJsonOk,
        woo_store_api: wooStoreApiOk,
      },
      cate_no_count: uniqueCateNos.length,
    },
  }
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.length > 0
  return value != null
}

function analyzeArtifact(filePath: string, platformKey?: string): {metrics: Record<string, unknown>; passed: boolean; sha256: string} {
  const text = fs.readFileSync(filePath, "utf-8")
  const sha256 = crypto.createHash("sha256").update(text).digest("hex")
  const products = JSON.parse(text) as CrawledProduct[]
  if (!Array.isArray(products)) throw new Error("artifact JSON must be an array")

  const total = products.length
  const categoryPresent = products.filter((p) => hasValue(p.category) || hasValue(p.categories)).length
  const colorPresent = products.filter((p) => hasValue(p.color) || hasValue(p.colors)).length
  const genderPresent = products.filter((p) => hasValue(p.gender) || hasValue(p.gender_scope)).length
  const pricePresent = products.filter((p) => hasValue(p.price) || hasValue(p.source_price)).length
  const imagePresent = products.filter((p) => hasValue(p.imageUrl) || hasValue(p.image_url) || hasValue(p.images)).length
  const inStock = products.filter((p) => p.inStock !== false && p.in_stock !== false).length

  const pct = (count: number): number => (total === 0 ? 0 : Math.round((10000 * count) / total) / 100)
  const metrics: Record<string, unknown> = {
    total,
    category_present: categoryPresent,
    color_present: colorPresent,
    gender_present: genderPresent,
    price_present: pricePresent,
    image_present: imagePresent,
    in_stock: inStock,
    category_fill_rate: pct(categoryPresent),
    color_fill_rate: pct(colorPresent),
    gender_fill_rate: pct(genderPresent),
    price_fill_rate: pct(pricePresent),
    image_fill_rate: pct(imagePresent),
  }

  let passed = total > 0 && categoryPresent === total && colorPresent === total && genderPresent === total
  const config = platformKey ? getSiteConfig(platformKey) : undefined
  if (config?.type === "cafe24") {
    const quality = assessCafe24ProductQuality(products as Product[], config)
    metrics.cafe24_quality = quality.metrics
    metrics.cafe24_quality_reasons = quality.reasons
    passed = passed && quality.passed
  }

  return {
    metrics,
    passed,
    sha256,
  }
}

async function selectBrands(db: ProductCollectionClient, flags: Flags): Promise<ProductCrawlBrand[]> {
  const id = numberFlag(flags, "brand-id") ?? numberFlag(flags, "id")
  if (id) {
    const brand = await loadProductCrawlBrand(db, id)
    return brand ? [brand] : []
  }

  let query = db
    .from("product_crawl_brands")
    .select("*")
    .order("brand_updated_at", {ascending: false, nullsFirst: false})
    .limit(numberFlag(flags, "limit") ?? 50)

  const status = stringFlag(flags, "status") ?? stringFlag(flags, "tech-status")
  const platformType = stringFlag(flags, "platform-type")
  const urlFilter = stringFlag(flags, "url")
  const q = cleanSearch(stringFlag(flags, "q") ?? "")
  if (status) query = query.eq("status", status)
  if (platformType) query = query.eq("platform_type", platformType)
  if (urlFilter === "missing") query = query.is("homepage_url", null)
  else if (urlFilter === "present") query = query.not("homepage_url", "is", null)
  if (q) {
    const like = `%${q}%`
    query = query.or(
      `brand_name.ilike.${like},brand_name_normalized.ilike.${like},homepage_url.ilike.${like},platform_key.ilike.${like}`,
    )
  }

  const {data, error} = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ProductCrawlBrand[]
}

async function listBrands(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  const brands = await selectBrands(db, flags)
  for (const brand of brands) {
    console.log(
      [
        `#${brand.brand_node_id}`,
        brand.brand_name,
        brand.status,
        `config=${brand.config_status}`,
        brand.platform_type,
        brand.platform_key ?? "-",
        homepageUrl(brand) ?? "URL_MISSING",
      ].join(" | "),
    )
  }
  console.log(`total=${brands.length}`)
}

async function detectOneBrand(db: ProductCollectionClient, brand: ProductCrawlBrand): Promise<void> {
  const startedAt = Date.now()
  const runId = await startProductRun(db, {
    brandNodeId: brand.brand_node_id,
    stage: "detect",
    platformKey: brand.platform_key,
  })
  try {
    const result = await detectBrand(brand)
    await upsertProductCrawlStatus(db, brand.brand_node_id, {
      platform_key: result.platform_key,
      platform_type: result.platform_type,
      category_discovery: result.category_discovery,
      categories: result.categories,
      detection: result.detection,
      status: "tech_detected",
      config_status: "needed",
      detected_at: new Date().toISOString(),
      last_error: null,
      blocked_reason: null,
    })
    await finishProductRun(db, runId, {
      status: "success",
      metrics: {
        platform_type: result.platform_type,
        platform_key: result.platform_key,
        platform_family: result.detection.platform_family ?? null,
        bot_protected: result.detection.bot_protected ?? false,
        category_discovery: result.category_discovery,
        cate_no_count: result.categories.length,
      },
      startedAt,
    })
    const family = result.detection.platform_family
    const familyNote = family && family !== result.platform_type ? ` family=${family}` : ""
    console.log(
      `#${brand.brand_node_id} ${brand.brand_name}: ${result.platform_type}${familyNote} (${result.platform_key})`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await upsertProductCrawlStatus(db, brand.brand_node_id, {
      status: "blocked",
      config_status: "blocked",
      last_error: message,
      blocked_reason: message,
    })
    await finishProductRun(db, runId, {status: "failed", errorMessage: message, startedAt})
    console.error(`#${brand.brand_node_id} ${brand.brand_name}: ${message}`)
  }
}

async function detectBrands(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  const brands = await selectBrands(db, flags)
  const concurrency = Math.min(numberFlag(flags, "concurrency") ?? 1, 12)
  let cursor = 0
  const workers = Array.from({length: Math.max(1, concurrency)}, async () => {
    while (cursor < brands.length) {
      const brand = brands[cursor++]
      await detectOneBrand(db, brand)
    }
  })
  await Promise.all(workers)
}

async function qcBrand(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  const brandNodeId = numberFlag(flags, "brand-id") ?? numberFlag(flags, "id")
  if (!brandNodeId) throw new Error("qc requires --brand-id")

  const brand = await loadProductCrawlBrand(db, brandNodeId)
  if (!brand) throw new Error(`brand_node ${brandNodeId} not found`)

  const platformKey = stringFlag(flags, "site") ?? brand.platform_key
  if (!platformKey) throw new Error("qc requires --site or a status row with platform_key")

  const artifactPath = path.resolve(
    stringFlag(flags, "file") ?? path.join(process.cwd(), "data", `${platformKey}-products.json`),
  )
  const artifactRelPath = path.relative(process.cwd(), artifactPath)
  const startedAt = Date.now()
  const runId = await startProductRun(db, {
    brandNodeId,
    stage: "qc",
    platformKey,
  })
  try {
    const {metrics, passed, sha256} = analyzeArtifact(artifactPath, platformKey)
    // Manual QC gate no longer promotes status — crawl.ts/import-products.ts auto-sync
    // (2026-07-06) already carries crawled -> imported. A pass just records the diagnostic;
    // a fail still downgrades to qc_failed.
    await upsertProductCrawlStatus(db, brandNodeId, {
      latest_artifact_path: artifactRelPath,
      latest_artifact_sha256: sha256,
      qc_summary: {...metrics, passed},
      ...(passed
        ? {last_error: null}
        : {status: "qc_failed", last_error: "QC failed: category/color/gender fill must be 100%"}),
    })
    await finishProductRun(db, runId, {
      status: passed ? "success" : "failed",
      metrics: {...metrics, passed},
      artifactPath: artifactRelPath,
      errorMessage: passed ? null : "category/color/gender fill below threshold",
      startedAt,
    })
    console.log(`#${brandNodeId} ${platformKey}: qc ${passed ? "passed" : "failed"} ${JSON.stringify(metrics)}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await upsertProductCrawlStatus(db, brandNodeId, {status: "qc_failed", last_error: message})
    await finishProductRun(db, runId, {status: "failed", errorMessage: message, startedAt})
    throw err
  }
}

function statusTimestamps(patch: Record<string, unknown>): void {
  const nowIso = new Date().toISOString()
  if (patch.status === "tech_detected") patch.detected_at = nowIso
  if (patch.status === "crawled") patch.crawled_at = nowIso
  if (patch.status === "imported") patch.imported_at = nowIso
  if (patch.status === "embedded" || patch.status === "active") patch.embedded_at = nowIso
}

async function markBrand(flags: Flags): Promise<void> {
  const brandNodeId = numberFlag(flags, "brand-id") ?? numberFlag(flags, "id")
  if (!brandNodeId) throw new Error("mark requires --brand-id")

  const patch: Record<string, unknown> = {}
  for (const [flag, column] of [
    ["status", "status"],
    ["tech-status", "status"],
    ["config-status", "config_status"],
    ["platform-key", "platform_key"],
    ["platform-type", "platform_type"],
    ["category-discovery", "category_discovery"],
    ["blocked-reason", "blocked_reason"],
    ["error", "last_error"],
    ["notes", "notes"],
  ] as const) {
    const value = stringFlag(flags, flag)
    if (value !== null) patch[column] = value
  }
  statusTimestamps(patch)
  if (Object.keys(patch).length === 0) throw new Error("mark requires at least one update flag")

  const db = createProductCollectionClient()
  const runId = await startProductRun(db, {brandNodeId, stage: "manual", status: "running"})
  await upsertProductCrawlStatus(db, brandNodeId, patch)
  await finishProductRun(db, runId, {status: "success", metrics: {patch}, startedAt: Date.now()})
  console.log(`brand_node #${brandNodeId} updated`)
}

async function listRuns(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  let query = db
    .from("product_crawl_runs")
    .select("*")
    .order("created_at", {ascending: false})
    .limit(numberFlag(flags, "limit") ?? 30)
  const brandNodeId = numberFlag(flags, "brand-id") ?? numberFlag(flags, "id")
  if (brandNodeId) query = query.eq("brand_node_id", brandNodeId)
  const {data, error} = await query
  if (error) throw new Error(error.message)
  for (const run of data ?? []) {
    console.log(
      [
        `#${run.id}`,
        `brand_node=${run.brand_node_id}`,
        run.stage,
        run.status,
        run.platform_key ?? "-",
        run.error_message ?? "",
      ].join(" | "),
    )
  }
}

function printHelp(): void {
  console.log(`
Brand-node product crawl state

Commands:
  list      [--status=...] [--platform-type=...] [--url=present|missing] [--q=...] [--limit=50]
  detect    --brand-id=ID | [--status=not_started] [--url=present] [--limit=20]
  qc        --brand-id=ID [--site=KEY] [--file=data/KEY-products.json]
  mark      --brand-id=ID [--status=...] [--config-status=...] [--platform-key=...]
  runs      [--brand-id=ID] [--limit=30]
`)
}

async function main(): Promise<void> {
  const {command, flags} = parseArgs(process.argv.slice(2))
  if (command === "help" || command === "--help") return printHelp()
  if (command === "list") return listBrands(flags)
  if (command === "detect") return detectBrands(flags)
  if (command === "qc") return qcBrand(flags)
  if (command === "mark") return markBrand(flags)
  if (command === "runs") return listRuns(flags)
  throw new Error(`unknown command: ${command}`)
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
