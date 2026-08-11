#!/usr/bin/env npx tsx
/**
 * DB → SiteConfig codegen (read-only, never writes to DB).
 *
 * Adds new KR-origin or verified KR-market storefronts after detection and retains every generated
 * storefront that has already collected data. This keeps refresh inventory
 * independent from later brand onboarding status transitions. Supported
 * generated engines are Shopify, Cafe24, and Imweb.
 *
 * Idempotent self-reference guard: when computing "already configured"
 * hosts/keys, entries produced by a *previous* run of this generator are
 * excluded from the comparison set (only hand-authored PLATFORMS entries
 * count as "manual"). Otherwise every re-run would see its own prior output
 * as a conflict and silently drop candidates.
 *
 * Usage: npx dotenv -e .env.local -- tsx tools/generate-platform-configs.ts
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {createProductCollectionClient} from "../src/lib/product-collection"
import {MANUAL_PLATFORMS} from "../src/configs/platforms"
import {
  generatedPlatformType,
  shouldDisableGeneratedConfig,
  shouldGeneratePlatformConfig,
  type PlatformConfigLifecycleRow,
} from "../src/lib/platform-config-lifecycle"
import type {PlatformType, SiteConfig} from "../src/lib/types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Keys to force-disable regardless of DB state (curated after validation crawls). */
const DISABLED_KEYS = new Set<string>([
  // batch 1 (2026-07-17): 검증 크롤에서 0개 상품 — cateNo가 detect 시점 이후 바뀐 것으로 추정, 재탐지 필요
  "en-208", // lesugiatelier
  "le17septembre",
  "lvir",
  "wesken-509",
  "yujiofficial",
  "en-1190", // MMIC
  // batch 2 (2026-07-18): 검증 크롤에서 0개 상품 — cateNo 재탐지 필요
  "sansangear",
  "asif-calie",
  "margesherwood-1789",
  "thevinylhouse",
  "moif",
  "colocynth",
  "safarispot",
  "les-official",
  "en-2368", // BASTONG — 502개 크롤됐지만 QC(color_missing)에 전량 드롭, detail 셀렉터 튜닝 필요
  // batch 3 (2026-07-23): daily-onboard 2회 연속 실측 — cateNo 9/13 둘 다 0개.
  // 실제 사이트(noscouleurs.com) 네비게이션 확인 결과 진짜 카테고리는
  // 24(outer)/25(tops)/27(bottoms)/28(acc)/42(all)/47(remix)/59(best) — detect
  // 시점 이후 카테고리 번호가 바뀐 것으로 추정. cateNo 재탐지 필요.
  "noscouleurs",
  // 2026-08-11: official KR and international storefronts both expose only
  // the region selector and no current product_no entries.
  "intl-5332", // HYOVASMI
  // 2026-08-11: multi-brand secondhand select shop; product pages expose no
  // item-level gender evidence and titles are often only the designer name.
  "kamadeva",
  // 2026-08-11: official storefront has no gender navigation or item-level
  // gender evidence; 17/19 current products remain unresolved (2 name-only).
  "sideservice",
  // 2026-08-11: official retailer records show a mix of men/unisex products,
  // while the source storefront exposes no item-level gender field (0/10 POC).
  "wellmadecom",
  // 2026-08-11: bags/caps-only catalogue with no explicit gender evidence;
  // accessory-only is not sufficient evidence for a blanket unisex default.
  "thepaze",
])

const CAFE24_SOURCE_CURRENCY_BY_KEY: Partial<Record<string, SiteConfig["sourceCurrency"]>> = {
  // BALANSA English Cafe24 storefront exposes list prices as USD decimals
  // (for example: "Price : $79.00"). Without this, the KRW parser drops prices.
  "en-3887": "USD",
  // Sienne English Cafe24 storefront declares SHOP_CURRENCY_INFO currency_code=USD.
  "en-4821": "USD",
}

const CAFE24_BASE_URL_BY_KEY: Partial<Record<string, string>> = {
  // The former .shop host no longer has DNS; the KR storefront is live here.
  sideservice: "https://sideservice.store",
}

const CAFE24_MULTI_BRAND_KEYS = new Set(["kamadeva"])

const CAFE24_CATEGORIES_BY_KEY: Partial<Record<string, NonNullable<SiteConfig["category"]>["categories"]>> = {
  kamadeva: [
    {name: "All Items", cateNo: 24},
    {name: "Outerwear", cateNo: 25},
    {name: "Tops", cateNo: 26},
    {name: "Bottoms", cateNo: 27},
    {name: "Bag & Shoes", cateNo: 28},
    {name: "Accessories", cateNo: 42},
    {name: "Etc", cateNo: 43},
  ],
  // This theme returns 404 for /product/list.html and exposes the catalogue
  // through custom shop pages instead.
  sideservice: [{name: "ALL", cateNo: 1, url: "/shop/all.html"}],
  // Current official navigation's complete catalogue. The prior 9/13 and
  // lookbook 273/237 detections are non-product Cafe24 system categories.
  wellmadecom: [{name: "ALL", cateNo: 24}],
  thepaze: [{name: "All", cateNo: 23}],
}

interface CandidateRow {
  brand_node_id: number
  brand_name: string
  homepage_url: string
  platform_key: string | null
  platform_type: string
  category_discovery: "manual" | "auto"
  categories: Array<{cateNo: number}>
  status: string
  config_status: string
  detection: Record<string, unknown>
  kr_eligibility_status: string
  kr_price_currency: string | null
  kr_storefront_url: string | null
  wiki: Record<string, unknown> | null
}

interface GeneratedCandidate extends Omit<CandidateRow, "platform_key" | "platform_type"> {
  platform_key: string
  platform_type: Extract<PlatformType, "shopify" | "cafe24" | "imweb">
}

export function normalizeHost(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h.startsWith("www.") ? h.slice(4) : h
  } catch {
    return ""
  }
}

const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "KRW"])

/**
 * Detect a Shopify store's actual presentment currency via `/cart.js`'s
 * `currency` field — Shopify's own authoritative signal for what currency
 * a fresh session's prices (and by extension /products.json) are
 * denominated in. Far more reliable than assuming "KR brand ⇒ KRW store":
 * many KR-origin brands price internationally in USD/EUR/GBP (2026-07-17
 * incident: adsb/nokwol/halfboy were hardcoded KRW, causing ~1000x-too-low
 * prices to import into production — see PR description).
 *
 * `ok: false` (undetected, network error, or a currency outside the FX
 * table in src/lib/fx.ts) means the caller MUST NOT guess — the site is
 * marked `disabled` instead of silently defaulting to a currency that could
 * be wrong.
 */
async function detectShopifyCurrency(
  baseUrl: string,
): Promise<{currency: SiteConfig["sourceCurrency"]; ok: boolean; raw?: string}> {
  try {
    const res = await fetch(`${baseUrl}/cart.js`, {signal: AbortSignal.timeout(10000)})
    if (!res.ok) return {currency: "KRW", ok: false}
    const json = (await res.json()) as {currency?: string}
    const currency = json.currency
    if (!currency) return {currency: "KRW", ok: false}
    if (!SUPPORTED_CURRENCIES.has(currency)) return {currency: "KRW", ok: false, raw: currency}
    return {currency: currency as SiteConfig["sourceCurrency"], ok: true}
  } catch {
    return {currency: "KRW", ok: false}
  }
}

async function loadPreviousGenerated(): Promise<SiteConfig[]> {
  const outPath = path.join(__dirname, "../src/configs/platforms.generated.ts")
  if (!fs.existsSync(outPath)) return []
  try {
    const mod = await import("../src/configs/platforms.generated")
    return mod.GENERATED_PLATFORMS as SiteConfig[]
  } catch {
    return []
  }
}

async function fetchCandidates(): Promise<GeneratedCandidate[]> {
  const db = createProductCollectionClient()
  const {data, error} = await db
    .from("product_crawl_brands")
    .select(
      "brand_node_id,brand_name,homepage_url,platform_key,platform_type,category_discovery,categories,status,config_status,detection,kr_eligibility_status,kr_price_currency,kr_storefront_url,wiki",
    )
    .not("homepage_url", "is", null)
    .not("platform_key", "is", null)
    // qc_failed 포함: select-onboard-batch.ts는 tech_detected뿐 아니라
    // qc_failed(재시도 대상, MAX_IMPORT_RETRIES 캡 안)도 선정 후보로 삼는다.
    // tech_detected/qc_failed는 shouldGeneratePlatformConfig()에서 KR-origin 또는
    // 검증된 KR storefront로 스코프되고, crawled~active/blocked는 recrawl-by-source(#47) 인벤토리
    // 유지를 위해 포함된다. status를 좁히면 qc_failed 브랜드의 config가
    // 재생성마다 빠져 "missing" 스킵으로 재발하던 버그가 되살아난다
    // (2026-07-23 실측: dadakarada/noscouleurs/temporahaus).
    .in("status", [
      "tech_detected",
      "qc_failed",
      "crawled",
      "imported",
      "embedded",
      "active",
      "blocked",
    ])
    .order("brand_node_id")
  if (error) throw new Error(`candidate query failed: ${error.message}`)
  const candidates: GeneratedCandidate[] = []
  for (const raw of (data ?? []) as CandidateRow[]) {
    const lifecycle: PlatformConfigLifecycleRow = {
      status: raw.status,
      config_status: raw.config_status,
      origin_country:
        typeof raw.wiki?.origin_country === "string" ? raw.wiki.origin_country : null,
      kr_eligibility_status: raw.kr_eligibility_status,
      platform_type: raw.platform_type,
      detection: raw.detection,
    }
    const type = generatedPlatformType(lifecycle)
    if (
      !raw.platform_key ||
      !shouldGeneratePlatformConfig(lifecycle) ||
      (type !== "cafe24" && type !== "shopify" && type !== "imweb")
    ) {
      continue
    }
    candidates.push({...raw, platform_key: raw.platform_key, platform_type: type})
  }
  return candidates
}

function buildEntrySource(
  row: GeneratedCandidate,
  shopifyCurrencyResult?: {currency: SiteConfig["sourceCurrency"]; ok: boolean; raw?: string},
): string {
  const host = normalizeHost(row.homepage_url)
  const verifiedKrStorefront =
    row.kr_eligibility_status === "eligible_storefront" && row.kr_storefront_url
      ? row.kr_storefront_url.replace(/\/$/, "")
      : null
  const baseUrl = CAFE24_BASE_URL_BY_KEY[row.platform_key] ?? verifiedKrStorefront ?? `https://${host}`
  const currencyUndetected = row.platform_type === "shopify" && shopifyCurrencyResult && !shopifyCurrencyResult.ok
  const disabled =
    DISABLED_KEYS.has(row.platform_key) ||
    currencyUndetected ||
    shouldDisableGeneratedConfig({
      status: row.status,
      config_status: row.config_status,
      origin_country: typeof row.wiki?.origin_country === "string" ? row.wiki.origin_country : null,
      kr_eligibility_status: row.kr_eligibility_status,
      platform_type: row.platform_type,
      detection: row.detection,
    })
  const cafe24SourceCurrency = row.platform_type === "cafe24"
    ? CAFE24_SOURCE_CURRENCY_BY_KEY[row.platform_key]
    : undefined
  const cafe24Categories = row.platform_type === "cafe24"
    ? CAFE24_CATEGORIES_BY_KEY[row.platform_key]
    : undefined
  const lines: string[] = []
  lines.push("  {")
  lines.push(`    key: ${JSON.stringify(row.platform_key)},`)
  lines.push(`    name: ${JSON.stringify(row.brand_name)},`)
  lines.push(`    type: ${JSON.stringify(row.platform_type)},`)
  lines.push(`    baseUrl: ${JSON.stringify(baseUrl)},`)
  // product_crawl_brands는 brand_nodes(브랜드-노드 매핑, 1행=1브랜드) 기반이라
  // 이 generator가 만드는 항목은 전부 단일 하우스 브랜드몰이다. brand를
  // 채우지 않으면 cafe24/shopify 엔진이 DOM에서 브랜드를 추측하게 되는데,
  // 이는 멀티브랜드 편집샵 전용 폴백이라 단일브랜드몰에서는 spec 라벨
  // 텍스트("판매가 : X, 상품명 : Y")를 브랜드로 잘못 주워오는 사고로 이어진다
  // (실측: etce 1,604건 — brand 필드 미설정 상태로 생성된 게 원인).
  lines.push(`    brand: ${JSON.stringify(row.brand_name)},`)
  if (row.platform_type === "cafe24") {
    if (CAFE24_MULTI_BRAND_KEYS.has(row.platform_key)) lines.push("    multiBrand: true,")
    if (cafe24SourceCurrency) lines.push(`    sourceCurrency: ${JSON.stringify(cafe24SourceCurrency)},`)
    lines.push("    paginate: true,")
    lines.push("    maxPages: 300,")
    lines.push("    crawlDetails: true,")
    if (cafe24Categories?.length || (row.category_discovery === "manual" && row.categories.length > 0)) {
      lines.push("    category: {")
      lines.push('      discovery: "manual",')
      lines.push("      categories: [")
      const categories: NonNullable<NonNullable<SiteConfig["category"]>["categories"]> =
        cafe24Categories ?? row.categories.map((c) => ({
          name: `Cat${c.cateNo}`,
          cateNo: c.cateNo,
        }))
      for (const c of categories) {
        const url = c.url ? `, url: ${JSON.stringify(c.url)}` : ""
        const gender = c.gender?.length ? `, gender: ${JSON.stringify(c.gender)}` : ""
        lines.push(
          `        {name: ${JSON.stringify(c.name)}, cateNo: ${c.cateNo}${gender}${url}},`,
        )
      }
      lines.push("      ],")
      lines.push("    },")
    } else {
      lines.push('    category: {discovery: "auto"},')
    }
  } else if (row.platform_type === "shopify") {
    lines.push(`    sourceCurrency: ${JSON.stringify(row.kr_price_currency === "KRW" ? "KRW" : (shopifyCurrencyResult?.currency ?? "KRW"))},`)
    lines.push("    maxPages: 300,")
    lines.push("    crawlDelay: 1500,")
  }
  if (disabled) lines.push("    disabled: true,")
  const noteSuffix = currencyUndetected
    ? ` — currency undetected via /cart.js${shopifyCurrencyResult?.raw ? ` (raw="${shopifyCurrencyResult.raw}", unsupported by FX table)` : ""}, disabled to avoid mispricing`
    : ""
  const cafe24CurrencyNote = cafe24SourceCurrency
    ? ` — sourceCurrency=${cafe24SourceCurrency} verified from rendered Cafe24 list price`
    : ""
  lines.push(
    `    notes: ${JSON.stringify(`generate-platform-configs.ts — brand_node_id=${row.brand_node_id}, status=${row.status}, auto-generated${noteSuffix}${cafe24CurrencyNote}`)},`,
  )
  lines.push("  },")
  return lines.join("\n")
}

async function main() {
  const previousGenerated = await loadPreviousGenerated()
  const previousByKey = new Map(previousGenerated.map((config) => [config.key, config]))
  const existingHosts = new Set(MANUAL_PLATFORMS.map((p) => normalizeHost(p.baseUrl)))
  const existingKeys = new Set(MANUAL_PLATFORMS.map((p) => p.key))

  const candidates = await fetchCandidates()

  const seenHosts = new Set<string>()
  const kept: GeneratedCandidate[] = []
  let skipManualHost = 0
  let skipManualKey = 0
  let skipDupHost = 0
  let skipNoKey = 0

  for (const row of candidates) {
    if (!row.platform_key) {
      skipNoKey++
      continue
    }
    const host = normalizeHost(row.homepage_url)
    if (!host) continue
    if (existingKeys.has(row.platform_key)) {
      skipManualKey++
      continue
    }
    if (existingHosts.has(host)) {
      skipManualHost++
      continue
    }
    if (seenHosts.has(host)) {
      skipDupHost++
      continue
    }
    seenHosts.add(host)
    kept.push(row)
  }

  // Shopify: probe each store's actual presentment currency (see
  // detectShopifyCurrency doc comment) instead of assuming KRW — KR-origin
  // brands frequently sell internationally in USD/EUR/GBP, and mislabeling
  // caused a real production data bug (2026-07-17: adsb/nokwol/halfboy
  // prices imported ~1000x too low). Sites where currency can't be safely
  // determined are disabled rather than guessed.
  const shopifyCurrencyByKey = new Map<string, {currency: SiteConfig["sourceCurrency"]; ok: boolean; raw?: string}>()
  const shopifyRows = kept.filter((r) => r.platform_type === "shopify")
  const CONCURRENCY = 8
  let cursor = 0
  let currencyDetectedCount = 0
  async function currencyWorker() {
    while (cursor < shopifyRows.length) {
      const row = shopifyRows[cursor++]!
      let result = row.kr_eligibility_status === "eligible_storefront" && row.kr_price_currency === "KRW"
        ? {currency: "KRW" as const, ok: true}
        : await detectShopifyCurrency(`https://${normalizeHost(row.homepage_url)}`)
      const previousCurrency = previousByKey.get(row.platform_key)?.sourceCurrency
      if (!result.ok && previousCurrency) {
        result = {currency: previousCurrency, ok: true}
      }
      shopifyCurrencyByKey.set(row.platform_key, result)
      if (result.ok) currencyDetectedCount++
      else console.warn(`   ⚠️  currency undetected for ${row.platform_key} — disabling (raw="${result.raw ?? "n/a"}")`)
    }
  }
  await Promise.all(Array.from({length: CONCURRENCY}, () => currencyWorker()))

  const activeCount = kept.filter((r) => {
    if (DISABLED_KEYS.has(r.platform_key)) return false
    if (r.status === "blocked" || r.config_status === "blocked") return false
    if (r.platform_type === "shopify" && !shopifyCurrencyByKey.get(r.platform_key)?.ok) return false
    return true
  }).length
  const disabledCount = kept.length - activeCount

  const header = `/**
 * AUTO-GENERATED by tools/generate-platform-configs.ts — DO NOT EDIT BY HAND.
 * Regenerate: npx dotenv -e .env.local -- tsx tools/generate-platform-configs.ts
 *
 * Auto-generated shopify/cafe24/imweb sources without a manual config.
 * New onboarding requires KR origin or verified KR-market eligibility; collected sources survive workflow status
 * transitions. Generated ${new Date().toISOString()}.
 * Total: ${kept.length} (active ${activeCount} / disabled ${disabledCount})
 */

import type {SiteConfig} from "../lib/types"

export const GENERATED_PLATFORMS: SiteConfig[] = [
`

  const body = kept.map((row) => buildEntrySource(row, shopifyCurrencyByKey.get(row.platform_key))).join("\n")
  const footer = "\n]\n"
  const outPath = path.join(__dirname, "../src/configs/platforms.generated.ts")
  fs.writeFileSync(outPath, header + body + footer)

  console.log(`candidates fetched: ${candidates.length}`)
  console.log(`skip (missing platform_key): ${skipNoKey}`)
  console.log(`skip (manual key match): ${skipManualKey}`)
  console.log(`skip (manual host match): ${skipManualHost}`)
  console.log(`skip (duplicate host among candidates): ${skipDupHost}`)
  console.log(`generated: ${kept.length} (active ${activeCount} / disabled ${disabledCount})`)
  console.log(`shopify currency detected: ${currencyDetectedCount}/${shopifyRows.length}`)
  console.log(`written: ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
