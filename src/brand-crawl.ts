#!/usr/bin/env npx tsx
/**
 * Brand-node product crawl state CLI.
 *
 * Examples:
 *   pnpm brand-crawl -- list --status=not_started
 *   pnpm brand-crawl -- detect --brand-id=123
 *   pnpm brand-crawl -- detect --status=imported --platform-type=unknown --preserve-status
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
import {
  isRetryableEligibilityError,
  krEligibilityPatch,
  probeKrMarketEligibility,
  retryableKrEligibilityAssessment,
  type KrEligibilityAssessment,
} from "./lib/kr-market-eligibility"
import type {Product} from "./lib/types"

type Flags = Record<string, string | boolean>

export interface DetectResult {
  platform_type: "cafe24" | "shopify" | "custom"
  category_discovery: "manual" | "auto"
  platform_key: string
  categories: Array<Record<string, unknown>>
  detection: Record<string, unknown>
  krEligibility?: KrEligibilityAssessment
}

interface CrawledProduct {
  category?: unknown
  categories?: unknown
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
/**
 * product_crawl_status.platform_key UNIQUE 충돌 여부 판정.
 * PostgREST 는 유니크 위반을 인덱스명이 담긴 에러 메시지로 돌려준다.
 */
export function isPlatformKeyConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes("idx_product_crawl_status_platform_key")
}

/**
 * 충돌한 platform_key 를 brand_node_id 접미사로 고유화한다.
 * brand_node_id 는 PK 라 전역 유일하므로 재충돌하지 않는다.
 */
export function uniquePlatformKey(platformKey: string, brandNodeId: number): string {
  return `${platformKey}-${brandNodeId}`
}

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

  // 429 를 넣는 이유: 레이트리밋도 "페이지를 못 봤다" 는 뜻이다. 빠져 있던 동안
  // 429 응답이 bot_protected=false 로 기록돼 아무 신호도 못 찾은 결과가
  // platform_type='custom' 이라는 **단정**으로 남았다 (실측 2026-07-30:
  // rasario / harriet-allure).
  const botProtected =
    htmlResult.status === 403 ||
    htmlResult.status === 429 ||
    htmlResult.status === 503 ||
    BOT_CHALLENGE_PATTERN.test(html)
  let platformFamily: string | null = platformType !== "custom" ? platformType : null
  if (!platformFamily && !botProtected) {
    platformFamily = FAMILY_FINGERPRINTS.find(({pattern}) => pattern.test(html))?.family ?? null
  }
  const wooStoreApiOk = platformFamily === "woocommerce" ? await probeWooStoreApi(homepage) : false
  const jsonldProduct = /"@type"\s*:\s*"?Product"?/.test(html)

  const uniqueCateNos = extractCafe24CateNos(html)
  const categories = uniqueCateNos.map((cateNo) => ({cateNo}))

  const categoryDiscovery = platformType === "cafe24" && categories.length > 0 ? "manual" : "auto"
  const originCountry =
    typeof brand.wiki?.origin_country === "string" ? brand.wiki.origin_country : null
  const krEligibility = await probeKrMarketEligibility({
    homepageUrl: homepage,
    homepageHtml: html,
    platformType,
    originCountry,
    verifiedStorefront:
      typeof brand.wiki?.homepage_storefront === "string" ? brand.wiki.homepage_storefront : null,
    verifiedCurrency:
      typeof brand.wiki?.homepage_currency === "string" ? brand.wiki.homepage_currency : null,
    verifiedSources: brand.wiki?.homepage_sources,
  })
  return {
    platform_type: platformType,
    category_discovery: categoryDiscovery,
    platform_key: brand.platform_key ?? keyFromUrl(homepage),
    categories,
    krEligibility,
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
  const pricePresent = products.filter((p) => hasValue(p.price) || hasValue(p.source_price)).length
  const imagePresent = products.filter((p) => hasValue(p.imageUrl) || hasValue(p.image_url) || hasValue(p.images)).length
  const inStock = products.filter((p) => p.inStock !== false && p.in_stock !== false).length

  const pct = (count: number): number => (total === 0 ? 0 : Math.round((10000 * count) / total) / 100)
  const metrics: Record<string, unknown> = {
    total,
    category_present: categoryPresent,
    price_present: pricePresent,
    image_present: imagePresent,
    in_stock: inStock,
    category_fill_rate: pct(categoryPresent),
    price_fill_rate: pct(pricePresent),
    image_fill_rate: pct(imagePresent),
  }

  let passed = total > 0 && categoryPresent === total
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
  // Optional onboarding scope. Durable configs from already-collected sources
  // are no longer country-scoped by generate-platform-configs.ts.
  const country = stringFlag(flags, "country")
  const eligibilityStatus = stringFlag(flags, "eligibility-status")
  const eligibilityStaleDays = numberFlag(flags, "eligibility-stale-days")
  const q = cleanSearch(stringFlag(flags, "q") ?? "")
  if (status) {
    const statuses = status.split(",").map((value) => value.trim()).filter(Boolean)
    if (statuses.length === 1) query = query.eq("status", statuses[0]!)
    else if (statuses.length > 1) query = query.in("status", statuses)
  }
  if (platformType) query = query.eq("platform_type", platformType)
  if (country) query = query.eq("wiki->>origin_country", country.toUpperCase())
  if (eligibilityStatus) {
    const statuses = eligibilityStatus.split(",").map((value) => value.trim()).filter(Boolean)
    if (statuses.length === 1) query = query.eq("kr_eligibility_status", statuses[0]!)
    else if (statuses.length > 1) query = query.in("kr_eligibility_status", statuses)
  }
  if (eligibilityStaleDays) {
    const cutoff = new Date(Date.now() - eligibilityStaleDays * 86_400_000).toISOString()
    query = query.lt("kr_eligibility_checked_at", cutoff)
  }
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

/**
 * detect 결과 → `product_crawl_status` patch.
 *
 * @MX:ANCHOR: [AUTO] `--preserve-status` 의 유일한 판정 지점. 순수 함수로 뽑아
 * 테스트로 고정한다.
 * @MX:REASON: 2026-07-30 이전 이 로직은 `status`/`config_status` 를 **무조건**
 * 세팅한 뒤 `...(preserveStatus ? {} : {status: "tech_detected"})` 를 뒤에 붙였다.
 * 두 분기가 같은 값이라 spread 가 양쪽 다 no-op 이었고, `--preserve-status` 는
 * 아무것도 보존하지 못했다.
 *
 * 조용한 피해: `imported` 브랜드에 detect 를 재실행하면 status 가
 * `tech_detected` 로 되돌아간다. 그런데 `shouldGeneratePlatformConfig` 는
 * `tech_detected` 를 **origin_country==='KR' 일 때만** 통과시킨다
 * (`imported` 는 COLLECTED_STATUSES 라 무조건 통과). 즉 비KR 브랜드는 detect 를
 * 돌리는 순간 config 생성 대상에서 빠져 refresh 워크리스트에서 조용히 사라진다.
 * 실측 2026-07-30: orphan 대상 47개 중 19개(재고 2,513건)가 이 경로였다.
 *
 * patch 는 upsert(onConflict=brand_node_id) 로 나가므로 키를 빼면 기존 값이 남는다.
 */
export function detectStatusPatch(args: {
  platformKey: string
  result: DetectResult
  detectedAt: string
  preserveStatus: boolean
}): Record<string, unknown> {
  const inconclusive = isInconclusiveDetection(args.result)
  return {
    platform_key: args.platformKey,
    // 판정 실패면 플랫폼 관련 필드를 아예 쓰지 않는다 — 기존 값이 남는다.
    ...(inconclusive
      ? {}
      : {
          platform_type: args.result.platform_type,
          category_discovery: args.result.category_discovery,
          categories: args.result.categories,
        }),
    // detection 은 실패 근거(status/bot_protected)를 담으므로 항상 기록한다.
    detection: args.result.detection,
    detected_at: args.detectedAt,
    ...(args.result.krEligibility ? krEligibilityPatch(args.result.krEligibility) : {}),
    ...(inconclusive
      ? {last_error: "detection inconclusive: homepage bot-protected or rate-limited"}
      : {last_error: null, blocked_reason: null}),
    // 이미 수집 단계를 지난 브랜드(imported/embedded/active)를 되돌리지 않는다.
    ...(args.preserveStatus
      ? {}
      : {status: "tech_detected" as const, config_status: "needed" as const}),
  }
}

/**
 * 홈페이지를 사실상 못 본 탐지인가.
 *
 * `platform_type='custom'` 은 "cafe24 도 shopify 도 아니다" 라는 **단정**이다.
 * 403/429/503 이나 챌린지 페이지를 받아 아무 신호도 못 찾은 경우까지 custom 으로
 * 기록하면, 아직 탐지되지 않았다는 뜻인 `unknown` 을 거짓 단정으로 덮어쓴다.
 * 신호가 하나라도 잡혔다면(cafe24/shopify) 차단 페이지였어도 그 판정은 유효하다.
 */
export function isInconclusiveDetection(result: DetectResult): boolean {
  return result.platform_type === "custom" && result.detection.bot_protected === true
}

async function detectOneBrand(
  db: ProductCollectionClient,
  brand: ProductCrawlBrand,
  preserveStatus: boolean,
): Promise<void> {
  const startedAt = Date.now()
  const runId = await startProductRun(db, {
    brandNodeId: brand.brand_node_id,
    stage: "detect",
    platformKey: brand.platform_key,
  })
  try {
    const result = await detectBrand(brand)
    // platform_key 는 호스트 첫 라벨(keyFromUrl)에서 파생되므로, 무관한 다른
    // brand_node 가 같은 라벨을 이미 선점했으면 UNIQUE 충돌이 난다
    // (예: 수동 config 의 "goyowear" vs intl.goyowear.kr).
    // 폴백이 없으면 upsert 가 throw 되고 바깥 catch 가 정상 감지된 브랜드를
    // "blocked" 로 잘못 마킹해 이후 크롤 배치에서 조용히 누락된다.
    const detectedAt = new Date().toISOString()
    const statusFor = (platformKey: string) =>
      detectStatusPatch({platformKey, result, detectedAt, preserveStatus})
    try {
      await upsertProductCrawlStatus(db, brand.brand_node_id, statusFor(result.platform_key))
    } catch (keyErr) {
      if (!isPlatformKeyConflict(keyErr)) throw keyErr
      result.platform_key = uniquePlatformKey(result.platform_key, brand.brand_node_id)
      await upsertProductCrawlStatus(db, brand.brand_node_id, statusFor(result.platform_key))
    }
    await finishProductRun(db, runId, {
      status: "success",
      metrics: {
        platform_type: result.platform_type,
        platform_key: result.platform_key,
        platform_family: result.detection.platform_family ?? null,
        bot_protected: result.detection.bot_protected ?? false,
        category_discovery: result.category_discovery,
        cate_no_count: result.categories.length,
        kr_eligibility_status: result.krEligibility?.status ?? "unchecked",
        kr_price_currency: result.krEligibility?.priceCurrency ?? null,
      },
      startedAt,
    })
    const family = result.detection.platform_family
    const familyNote = family && family !== result.platform_type ? ` family=${family}` : ""
    // 판정 실패는 platform_type 을 쓰지 않으므로 로그도 그렇게 말해야 한다 —
    // "custom" 으로 찍으면 저장된 값과 어긋난다.
    const verdict = isInconclusiveDetection(result)
      ? `inconclusive(http=${result.detection.homepage_status ?? "?"}) — platform_type 유지`
      : `${result.platform_type}${familyNote}`
    console.log(
      `#${brand.brand_node_id} ${brand.brand_name}: ${verdict} (${result.platform_key}) eligibility=${result.krEligibility?.status ?? "unchecked"}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const retryable = isRetryableEligibilityError(err)
    await upsertProductCrawlStatus(db, brand.brand_node_id, {
      last_error: message,
      ...(retryable
        ? {
            ...krEligibilityPatch(retryableKrEligibilityAssessment(err)),
            // A transient transport failure is not proof that Korea is unsupported.
            blocked_reason: null,
          }
        : {
            blocked_reason: message,
            ...(preserveStatus ? {} : {status: "blocked", config_status: "blocked"}),
          }),
    })
    await finishProductRun(db, runId, {status: "failed", errorMessage: message, startedAt})
    console.error(`#${brand.brand_node_id} ${brand.brand_name}: ${message}`)
  }
}

async function detectBrands(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  const brands = await selectBrands(db, flags)
  const concurrency = Math.min(numberFlag(flags, "concurrency") ?? 1, 12)
  const preserveStatus = flags["preserve-status"] === true
  let cursor = 0
  const workers = Array.from({length: Math.max(1, concurrency)}, async () => {
    while (cursor < brands.length) {
      const brand = brands[cursor++]
      await detectOneBrand(db, brand, preserveStatus)
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
        : {status: "qc_failed", last_error: "QC failed: category fill must be 100%"}),
    })
    await finishProductRun(db, runId, {
      status: passed ? "success" : "failed",
      metrics: {...metrics, passed},
      artifactPath: artifactRelPath,
      errorMessage: passed ? null : "category fill below threshold",
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
