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
import {CAFE24_CATEGORY_NAME_BACKFILL} from "./cafe24-category-name-overrides.generated"
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
  // misekiseoul.com serves a Japan-market storefront only: product JSON-LD
  // declares priceCurrency=JPY and the list labels render as 商品名/販売価格.
  // There is no KR shop to switch to — `?shop_no=1..4` all return the same JPY
  // page — so the prices are converted at import instead. Left unset, ¥1,650
  // socks were stored as ₩1,650 (302 rows, 2026-08-26).
  misekiseoul: "JPY",
}

/**
 * Per-key baseUrl override, applied ahead of `kr_storefront_url` and the
 * brand's `homepage_url`. Use when the recorded homepage is not the storefront
 * we should actually crawl — a dead host, or a foreign-market twin of a
 * Korean shop.
 */
const BASE_URL_BY_KEY: Partial<Record<string, string>> = {
  // The former .shop host no longer has DNS; the KR storefront is live here.
  sideservice: "https://sideservice.store",
  // The m. subdomain serves no TLS at all, so the crawl has been failing since
  // 2026-07-13. The desktop host serves the same catalog and product paths.
  "draw-attention": "https://drawattention.cafe24.com",
  // The brand runs two imweb shops off one theme: `-global.com` prices in USD,
  // `.co.kr` in KRW. We were crawling the global one and storing $55 tees as
  // ₩55 (53 rows, 2026-08-26). Prefer the KR shop — a real won price beats a
  // converted one. Key keeps its `-global` name so brand_node 2470's existing
  // product_crawl_status history stays attached.
  "emostanceclub-global": "https://www.emostanceclub.co.kr",
}

const CAFE24_MULTI_BRAND_KEYS = new Set(["kamadeva"])

const CAFE24_SELECTORS_BY_KEY: Partial<Record<string, SiteConfig["selectors"]>> = {
  // The theme's generic heading selector resolves to a navigation label.
  openyy: {productName: ".title a"},
}

// Hand-curated overrides. Always wins over CAFE24_CATEGORY_NAME_BACKFILL
// (tools/backfill-cafe24-category-names.ts's auto-discovered names) below —
// see buildEntrySource's `cafe24Categories` line.
const CAFE24_CATEGORIES_BY_KEY: Partial<Record<string, NonNullable<SiteConfig["category"]>["categories"]>> = {
  // Official navigation exposes separate WOMEN and MEN departments. Use leaf
  // categories so aggregate/new/sale pages cannot erase the gender evidence.
  dunststudio: [
    {name: "Women Outerwear", cateNo: 29, gender: ["women"]},
    {name: "Women Jumpers & Leather", cateNo: 755, gender: ["women"]},
    {name: "Women Knitwear", cateNo: 30, gender: ["women"]},
    {name: "Women Shirts & Blouses", cateNo: 32, gender: ["women"]},
    {name: "Women Sweatshirts", cateNo: 447, gender: ["women"]},
    {name: "Women T-shirts", cateNo: 31, gender: ["women"]},
    {name: "Women Dresses & Skirts", cateNo: 33, gender: ["women"]},
    {name: "Women Pants", cateNo: 34, gender: ["women"]},
    {name: "Women Bags", cateNo: 618, gender: ["women"]},
    {name: "Women Accessories", cateNo: 36, gender: ["women"]},
    {name: "Men Outerwear", cateNo: 38, gender: ["men"]},
    {name: "Men Jumpers & Leather", cateNo: 759, gender: ["men"]},
    {name: "Men Knitwear", cateNo: 303, gender: ["men"]},
    {name: "Men Shirts", cateNo: 157, gender: ["men"]},
    {name: "Men Sweatshirts", cateNo: 448, gender: ["men"]},
    {name: "Men T-shirts", cateNo: 40, gender: ["men"]},
    {name: "Men Pants", cateNo: 41, gender: ["men"]},
    {name: "Men Bags", cateNo: 619, gender: ["men"]},
    {name: "Men Accessories", cateNo: 43, gender: ["men"]},
  ],
  // The official shop labels this complete apparel branch "SHOP WOMEN".
  // Homeware/editorial branches (OBJECT/CERAMIC/FURNITURE/etc.) are excluded.
  archthe: [
    {name: "Women Coats & Jackets", cateNo: 89, gender: ["women"]},
    {name: "Women Knitwear & Jersey", cateNo: 90, gender: ["women"]},
    {name: "Women Shirts & Blouses", cateNo: 107, gender: ["women"]},
    {name: "Women Tops", cateNo: 92, gender: ["women"]},
    {name: "Women Dresses", cateNo: 91, gender: ["women"]},
    {name: "Women Trousers", cateNo: 93, gender: ["women"]},
    {name: "Women Skirts", cateNo: 94, gender: ["women"]},
    {name: "Women Accessories", cateNo: 95, gender: ["women"]},
  ],
  // Verified storefront departments. Keep only the two gender-bearing source
  // categories instead of the many Cafe24 system/editorial category IDs.
  openyy: [
    {name: "UNISEX", cateNo: 215, gender: ["unisex"]},
    {name: "WOMENS", cateNo: 214, gender: ["women"]},
  ],
  "opening-project": [
    {name: "Man", cateNo: 137, gender: ["men"]},
    {name: "Woman", cateNo: 138, gender: ["women"]},
    {name: "EASTPAK X OPENING PROJECT", cateNo: 157},
    {name: "Best", cateNo: 205},
    {name: "New", cateNo: 59},
    {name: "All", cateNo: 23},
  ],
  "intl-5332": [
    {name: "BODY PARTS", cateNo: 24},
    {name: "OBJECT", cateNo: 25},
    {name: "SALE", cateNo: 56},
    {name: "HYOVASMI", cateNo: 62},
    {name: "HYOVASMI MINI", cateNo: 63},
  ],
  orogee: [
    {name: "Let's Swim", cateNo: 24, gender: ["women"]},
    {name: "Sea Wear", cateNo: 44, gender: ["women"]},
    {name: "Beach Acc", cateNo: 25, gender: ["women"]},
    {name: "All", cateNo: 42, gender: ["women"]},
  ],
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
  // Official NEW catalogue contains the complete current range. The prior
  // 9/13/1 detections are Cafe24 system/navigation categories, not products.
  mosxe: [{name: "NEW", cateNo: 52}],
  // Official Shop navigation. Exclude Cafe24 system categories and the
  // aggregate All/Best views so code-only product names retain their family.
  "butter-ring": [
    {name: "Ring", cateNo: 30, gender: ["women"]},
    {name: "Necklace", cateNo: 31, gender: ["women"]},
    {name: "Bracelet", cateNo: 42, gender: ["women"]},
    {name: "Earring", cateNo: 43, gender: ["women"]},
    {name: "Goods", cateNo: 63, gender: ["women"]},
  ],
  // Official Shop navigation. The homepage detector only sees Cafe24 system
  // categories 29/42; the real product families are nested under Shop.
  oscitare: [
    {name: "outer", cateNo: 44},
    {name: "top", cateNo: 45},
    {name: "bottom", cateNo: 46},
    {name: "acc", cateNo: 47},
  ],
  // Current official Shop navigation. Use the five product-family leaves;
  // All/New/Season Off are aggregate views and would duplicate products.
  churchillromper: [
    {name: "아우터", cateNo: 54},
    {name: "니트", cateNo: 77},
    {name: "상의", cateNo: 55},
    {name: "하의", cateNo: 56},
    {name: "악세서리", cateNo: 57},
  ],
  // The official store separates the main menswear catalogue from Women.
  // Aggregate Sale is omitted because it mixes and duplicates both ranges.
  wouldbe: [
    {name: "Shop", cateNo: 42, gender: ["men"]},
    {name: "Women", cateNo: 83, gender: ["women"]},
  ],
  // bants.co.kr is also a multi-brand retailer. Only the BANTS brand
  // department is in scope; ITEM categories contain HOUSTON/WHEELROBE/etc.
  bants: [{name: "BANTS", cateNo: 54, gender: ["men"]}],
  // Official Products navigation. Use leaf collections so every item retains
  // its product family; the final ALL category catches non-shoe accessories.
  iyso: [
    {name: "Shoes", cateNo: 289, gender: ["unisex"]},
    {name: "Shoes", cateNo: 62, gender: ["unisex"]},
    {name: "Shoes", cateNo: 317, gender: ["unisex"]},
    {name: "Shoes", cateNo: 312, gender: ["unisex"]},
    {name: "Shoes", cateNo: 248, gender: ["unisex"]},
    {name: "Shoes", cateNo: 249, gender: ["unisex"]},
    {name: "Shoes", cateNo: 91, gender: ["unisex"]},
    {name: "Socks", cateNo: 292, gender: ["unisex"]},
    {name: "Shoes", cateNo: 246, gender: ["unisex"]},
  ],
}

const IMWEB_CATEGORY_URLS_BY_KEY: Partial<Record<string, string[]>> = {
  // The Home page navigation is script-rendered too late for generic discovery,
  // while the official store page exposes the complete current catalogue.
  kibata: ["https://www.kibata.kr/Online-Store/"],
  publicfigure: ["https://publicfigure.kr/shop"],
}

const IMWEB_DEFAULT_CATEGORY_BY_KEY: Partial<Record<string, string>> = {
  // The current official catalogue is exclusively adult denim/sashiko pants.
  kibata: "bottoms",
  // The shop is a mixed apparel catalogue without category labels in its
  // Imweb item JSON. Product-name inference refines known families; truly
  // ambiguous items remain in the canonical catch-all instead of dropping.
  publicfigure: "other",
}

const IMWEB_DEFAULT_SUBCATEGORY_BY_KEY: Partial<Record<string, string>> = {
  // Official detail pages identify the collection as 5-pocket denim jeans.
  kibata: "jeans",
}

interface CandidateRow {
  brand_node_id: number
  brand_name: string
  /** Null when the brand row lost its homepage upstream — see `resolveHomepageUrl`. */
  homepage_url: string | null
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

/** Returns "" for anything unusable, including a null/absent homepage_url. */
export function normalizeHost(url: string | null | undefined): string {
  try {
    const h = new URL(url!).hostname.toLowerCase()
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
    // homepage_url NULL 인 행도 가져온다. 예전에는 쿼리에서 걸렀는데, 브랜드
    // 행의 homepage 가 상류에서 지워지면 이미 잘 돌던 config 가 재생성 때
    // 조용히 사라졌다 (2026-08-26 실측: innir/fragola/uune 등 6건. innir 는
    // 사람이 검증한 defaultGender 를 갖고 있어 테스트가 잡아냈지만, 나머지는
    // 아무 신호 없이 크롤 대상에서 빠진다). 직전 생성물의 baseUrl 로 폴백한다.
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
  const baseUrl = BASE_URL_BY_KEY[row.platform_key] ?? verifiedKrStorefront ?? `https://${host}`
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
    ? CAFE24_CATEGORIES_BY_KEY[row.platform_key] ?? CAFE24_CATEGORY_NAME_BACKFILL[row.platform_key]
    : undefined
  const cafe24Selectors = row.platform_type === "cafe24"
    ? CAFE24_SELECTORS_BY_KEY[row.platform_key]
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
    if (cafe24Selectors) lines.push(`    selectors: ${JSON.stringify(cafe24Selectors)},`)
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
  } else if (row.platform_type === "imweb") {
    const categoryUrls = IMWEB_CATEGORY_URLS_BY_KEY[row.platform_key]
    if (categoryUrls?.length) lines.push(`    categoryUrls: ${JSON.stringify(categoryUrls)},`)
    const defaultCategory = IMWEB_DEFAULT_CATEGORY_BY_KEY[row.platform_key]
    if (defaultCategory) lines.push(`    defaultCategory: ${JSON.stringify(defaultCategory)},`)
    const defaultSubcategory = IMWEB_DEFAULT_SUBCATEGORY_BY_KEY[row.platform_key]
    if (defaultSubcategory) lines.push(`    defaultSubcategory: ${JSON.stringify(defaultSubcategory)},`)
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
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("usage: tsx tools/generate-platform-configs.ts")
    console.log("Generates src/configs/platforms.generated.ts from eligible DB crawl rows.")
    return
  }
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
  const carriedHomepages: string[] = []

  for (const row of candidates) {
    if (!row.platform_key) {
      skipNoKey++
      continue
    }
    // homepage 가 비어도 직전 생성물에 baseUrl 이 있으면 그것으로 이어간다 —
    // config 가 사라지면 그 사이트는 아무 경고 없이 크롤 대상에서 빠진다.
    if (!row.homepage_url) {
      const carried = previousByKey.get(row.platform_key)?.baseUrl
      if (!carried) continue
      row.homepage_url = carried
      carriedHomepages.push(row.platform_key)
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
  if (carriedHomepages.length > 0) {
    console.log(
      `carried baseUrl from previous generation (homepage_url is NULL upstream): ` +
        `${carriedHomepages.length} — ${carriedHomepages.join(", ")}`,
    )
  }
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
