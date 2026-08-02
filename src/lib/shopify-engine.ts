/**
 * Shopify 크롤 엔진
 *
 * Shopify 사이트의 /products.json 엔드포인트 활용
 * 페이지네이션: ?page=N (기본 250개/페이지, 빈 배열 올 때까지)
 */

import type {CrawlResult, Product, SiteConfig} from "./types"
import {CURRENCY_SYMBOL, CURRENCY_TO_COUNTRY} from "./fx"
import {classifyShopifyCategory} from "./shopify-category-classifier"
// SPEC-PLATFORM-EXPANSION-002 REQ-005: FX table lifted to ./fx for shared
// use by import-products.ts.
//
// SPEC-005 amendment 2026-05-06: Shopify engine no longer applies
// engine-time KRW conversion. Cache stores native source-currency
// values (e.g. USD 99.90, GBP 100.00). FX conversion is performed
// at import time by import-products.ts (see SPEC-002 REQ-004 hook),
// matching the ZARA / Uniqlo region-engine pattern. This eliminates
// double-conversion when import-products.ts converts a value that
// was already converted by the engine.

// Shopify handle은 kebab-case 영숫자로만 구성 (spec) — path injection 방지
const SAFE_HANDLE = /^[a-z0-9][a-z0-9-]*$/

/**
 * Fetch with exponential backoff on HTTP 429 (rate-limited) and 503.
 * Honors Retry-After header when present (seconds OR HTTP-date).
 * Max 3 retries, then returns the last response so caller can record error.
 *
 * SPEC-PLATFORM-EXPANSION-007 v0.2.2 (2026-05-07): added after empirical
 * observation that parallel Shopify dispatch triggered 429 across 8 sites.
 */
async function fetchWithBackoff(url: string, init: RequestInit): Promise<Response> {
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 429 && res.status !== 503) return res
    if (attempt === MAX_RETRIES - 1) return res
    const retryAfter = res.headers.get("Retry-After")
    let waitMs = (attempt + 1) * 5000  // 5s → 10s → 15s default
    if (retryAfter) {
      const asInt = parseInt(retryAfter, 10)
      if (!isNaN(asInt)) waitMs = Math.max(waitMs, asInt * 1000)
    }
    await new Promise((r) => setTimeout(r, waitMs))
  }
  return await fetch(url, init)
}

// 이미지 URL 화이트리스트 — Shopify CDN 또는 스토어 자체 도메인만 허용
function isSafeImageUrl(src: string, baseHost: string): boolean {
  if (!src.startsWith("https://")) return false
  try {
    const host = new URL(src).hostname
    return (
      host === baseHost ||
      host === "cdn.shopify.com" ||
      host.endsWith(".myshopify.com") ||
      host.endsWith(".shopifycdn.com")
    )
  } catch {
    return false
  }
}

function pickOption(v: ShopifyProduct["variants"][0], pos?: number): string | null {
  if (!pos) return null
  if (pos === 1) return v.option1 ?? null
  if (pos === 2) return v.option2 ?? null
  if (pos === 3) return v.option3 ?? null
  return null
}

interface ShopifyProduct {
  id: number
  title: string
  handle: string
  vendor: string
  product_type: string
  body_html: string
  tags: string[]
  options?: {name: string; position: number; values?: string[]}[]
  variants: {
    id: number
    title: string
    price: string
    available: boolean
    sku: string
    option1?: string | null
    option2?: string | null
    option3?: string | null
  }[]
  images: {
    src: string
  }[]
}

interface ShopifyResponse {
  products: ShopifyProduct[]
}

/**
 * Shopify-specific per-call dials extracted verbatim from `crawlShopify`'s
 * config reads. The mapping consumes ONLY these from `SiteConfig`:
 *   - sourceCurrency  → `config.sourceCurrency`  (price symbol + format)
 *   - brandFallback   → `config.brand`           (house brand when vendor empty)
 * `region` is intentionally absent — Shopify has no region concept (unlike
 * the uniqlo engine). The fetch-only dials (`country` /
 * `localizationCookie`) stay in `crawlShopify` because they shape request
 * headers, not the parse output.
 */
export interface ShopifyParseOptions {
  /** Native source currency. Undefined → "KRW" (preserves original `config.sourceCurrency || "KRW"`). */
  sourceCurrency?: SiteConfig["sourceCurrency"]
  /**
   * House brand used when `product.vendor` is empty. Set from `config.brand`
   * (single-brand mall). Multi-brand editshops leave this undefined so the
   * brand stays "" rather than leaking the platform name. */
  brandFallback?: string
  /**
   * 품절 상품을 결과에 남긴다 (갱신 전용). 기본 false — 일반 크롤 출력은 종전과
   * 바이트 동일하다(골든 마스터 불변식). 갱신 경로만 true 로 켜서 "재고→품절"
   * 전이를 관측한다.
   */
  keepOutOfStock?: boolean
}

/**
 * @MX:ANCHOR: [AUTO] Pure Shopify `/products.json` → `Product[]` mapping.
 * Behavior-preserving extraction of the formerly-private per-product loop
 * inside `crawlShopify()`. Output is byte-identical to what `crawlShopify`
 * produced from the same payload (golden master:
 * tests/fixtures/shopify-parse.golden.json).
 * @MX:REASON: fan_in >= 3 (crawlShopify delegates here; characterization
 * golden + invariant tests assert against it). This is the sole
 * non-pure→pure seam in SPEC-ARCH-CRAWLER-001 — the contract MUST stay
 * byte-stable so the future parser-strategy DI can prove zero drift.
 * @MX:SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-004 (PRESERVE phase, Stage 0)
 */
export function parseShopifyProducts(
  productsJson: ShopifyResponse,
  baseUrl: string,
  platformKey: string,
  options: ShopifyParseOptions = {},
): Product[] {
  const allProducts: Product[] = []
  const currency = options.sourceCurrency || "KRW"
  const symbol = CURRENCY_SYMBOL[currency] ?? currency
  const baseHost = (() => {
    try { return new URL(baseUrl).hostname } catch { return "" }
  })()

  // options.name에서 사이즈 포지션 식별 (Shopify는 옵션명이 store마다 다름).
  // 색상 포지션 식별은 2026-07-29 제거 — 색상 출처가 VLM(product_features)로 이관됐다.
  const SIZE_NAMES = [
    "size", "length", "shoe size", "us size", "eu size", "uk size", "taille", "größe", "taglia", "talla",
    "사이즈", "치수",
  ]

  const data: ShopifyResponse = productsJson

  if (!data.products || data.products.length === 0) return allProducts

  for (const sp of data.products) {
    // 룩북/기프트카드/통합 상품 제외 (실상품 아님, sentinel 가격값 들어감)
    const titleLower = sp.title.toLowerCase()
    const typeLower = (sp.product_type || "").toLowerCase()
    if (
      titleLower.startsWith("lookbook") ||
      typeLower === "lookbook" ||
      typeLower === "gift card" ||
      typeLower === "gift-card" ||
      sp.vendor === "Rise.ai"
    ) {
      continue
    }

    // handle 검증 — path injection 방지 (외부 Shopify JSON 신뢰 X)
    if (!sp.handle || !SAFE_HANDLE.test(sp.handle)) {
      continue
    }

    const optionPositions: {size?: number} = {}
    for (const opt of sp.options ?? []) {
      const n = opt.name.toLowerCase()
      if (SIZE_NAMES.some((s) => n.includes(s))) optionPositions.size = opt.position
    }

    const firstVariant = sp.variants[0]
    const srcPrice = firstVariant ? parseFloat(firstVariant.price) : null
    const inStock = sp.variants.some((v) => v.available)
    if (!inStock && !options.keepOutOfStock) continue  // 품절 상품 제외

    // sizeInfo: options 메타데이터로 정확한 포지션 사용
    let sizeInfo: string | undefined
    if (optionPositions.size) {
      const sizes = [...new Set(
        sp.variants.map((v) => pickOption(v, optionPositions.size)).filter((x): x is string => !!x && x !== "Default Title")
      )]
      if (sizes.length > 0) sizeInfo = sizes.join(", ").slice(0, 200)
    }

    // 다중 이미지 — 외부 JSON 신뢰 X, host 화이트리스트 검증
    const images = sp.images
      .map((img) => img.src)
      .filter((src): src is string => typeof src === "string" && isSafeImageUrl(src, baseHost))
    const imageUrl = images[0] || ""

    const tags = sp.tags.length > 0 ? sp.tags.slice(0, 50).map((t) => t.slice(0, 100)) : undefined

    // SPEC-005 amendment 2026-05-06: store native source-currency
    // value as `price`; import-products.ts handles FX conversion.
    // priceFormatted preserves the symbol + decimal precision
    // (USD/EUR/GBP: 2 decimals; KRW: integer with locale grouping).
    const priceFormatted = srcPrice !== null
      ? (currency === "KRW"
          ? `${symbol}${srcPrice.toLocaleString("ko-KR")}`
          : `${symbol}${srcPrice.toFixed(2)}`)
      : ""
    if (!inStock && !options.keepOutOfStock) continue  // 품절 상품 제외

    allProducts.push({
      brand: sp.vendor || options.brandFallback || "",
      name: sp.title,
      ...classifyShopifyCategory(sp.product_type || "", sp.title, sp.tags),
      price: srcPrice,
      originalPrice: srcPrice,
      salePrice: null,
      priceFormatted,
      imageUrl,
      productUrl: `${baseUrl}/products/${sp.handle}`,
      inStock,
      platform: platformKey,
      crawledAt: new Date().toISOString(),
      sizeInfo,
      images: images.length > 0 ? images : undefined,
      tags,
      sourceCurrency: currency,
      sourcePrice: srcPrice !== null ? srcPrice : undefined,
    })
  }

  return allProducts
}

export interface CrawlShopifyOptions {
  /** 갱신 전용 — 품절 상품도 결과에 남긴다 (parseShopifyProducts.keepOutOfStock). */
  listingOnly?: boolean
  /**
   * 재수집 전용 — 품절 상품도 결과에 남긴다. `listingOnly` 와 결과는 같지만
   * 의도가 다르다: `listingOnly` 는 "가격/재고만 갱신" 모드라 cafe24 쪽에서는
   * 상세 크롤 자체를 끄는 스위치로도 쓰인다. 재수집은 상세까지 다 받아야 하므로
   * 별도 플래그가 필요하다 (src/crawl.ts --include-out-of-stock).
   *
   * 왜 필요한가: 품절 상품은 import 플래그가 아니라 이 크롤 레이어에서 버려진다.
   * 2026-06 코호트 재수집 시점 실측으로 대상 60,634행 중 14,971행(24.7%)이
   * 품절이었고, 이걸 남기지 않으면 그 행들은 옛 추출 로직 산물을 영구히 유지한다.
   */
  includeOutOfStock?: boolean
}

export async function crawlShopify(
  config: SiteConfig,
  options: CrawlShopifyOptions = {},
): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []
  const allProducts: Product[] = []
  const maxPages = config.maxPages || 20
  const delay = config.crawlDelay || 1000
  const currency = config.sourceCurrency || "KRW"
  const country = CURRENCY_TO_COUNTRY[currency]
  const localizationCookie = `localization=${country}`

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl}) [Shopify]`)
  console.log(`${"─".repeat(50)}`)

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `${config.baseUrl}/products.json?page=${page}&limit=250`
      // Full Chrome-131 header set — node fetch's default header set
      // (UA + Accept only) was being fingerprinted as bot by Cloudflare
      // even though curl with same UA + Cookie returned 200. Adding the
      // sec-ch-ua client hint family + standard browser Accept-Encoding
      // mimics a real Chrome request and avoids the 429 fingerprint trap.
      // SPEC-PLATFORM-EXPANSION-007 v0.2.2 (2026-05-07).
      const res = await fetchWithBackoff(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          Referer: config.baseUrl + "/",
          Cookie: localizationCookie,
        },
      })

      if (!res.ok) {
        errors.push(`HTTP ${res.status} on page ${page}`)
        break
      }

      const data: ShopifyResponse = await res.json()

      if (!data.products || data.products.length === 0) break

      // Stage-0 PRESERVE seam: per-product mapping (variant pick, price,
      // option positions, image-host whitelist, tags)
      // was extracted VERBATIM into `parseShopifyProducts`. The crawl
      // path delegates ALL mapping to it; output is byte-identical to the
      // pre-extraction inline loop (golden:
      // tests/fixtures/shopify-parse.golden.json).
      // SPEC: SPEC-ARCH-CRAWLER-001 (REQ-CRAWLER-004 PRESERVE).
      allProducts.push(
        ...parseShopifyProducts(data, config.baseUrl, config.key, {
          sourceCurrency: currency,
          // vendor 가 빈 경우의 폴백. 멀티브랜드 편집샵에서는 **플랫폼명으로
          // 폴백하지 않는다** — 스토어명이 브랜드로 적재되는 platform-as-brand
          // 오염의 원인이다 (`tools/cleanup-platform-as-brand.ts` 가 치우는 그것).
          // 그 경우 brand="" 로 남겨 import 의 provenance 가드가 격리하게 한다
          // (`lib/brand-provenance.ts`).
          // ⚠️ 현재 `multiBrand: true` 로 표시된 config 는 visualaid 하나뿐이다.
          // kith/browns/bodega/slam-jam/antonioli/union-la/concepts/
          // the-broken-arm/mohawk-general 은 실제로 편집샵인데 표시가 없어 여전히
          // config.name 으로 폴백한다 — config 쪽 데이터 갭이다.
          brandFallback: config.brand ?? (config.multiBrand ? undefined : config.name),
          keepOutOfStock: options.listingOnly || options.includeOutOfStock,
        }),
      )

      console.log(`   페이지 ${page}: ${data.products.length}개 상품`)

      if (data.products.length < 250) break // 마지막 페이지

      await new Promise((r) => setTimeout(r, delay))
    } catch (err) {
      errors.push(`페이지 ${page} 실패: ${err}`)
      break
    }
  }

  // 통계
  const uniqueBrands = new Set(allProducts.map((p) => p.brand))
  const withPrice = allProducts.filter((p) => p.price !== null)
  const avgPrice =
    withPrice.length > 0
      ? Math.round(withPrice.reduce((s, p) => s + (p.price || 0), 0) / withPrice.length)
      : 0

  const result: CrawlResult = {
    platform: config.key,
    products: allProducts,
    stats: {
      totalProducts: allProducts.length,
      inStock: allProducts.filter((p) => p.inStock).length,
      outOfStock: allProducts.filter((p) => !p.inStock).length,
      uniqueBrands: uniqueBrands.size,
      avgPrice,
      duration: Date.now() - startTime,
    },
    errors,
  }

  console.log(`\n   ✅ ${config.name} 완료: ${result.stats.totalProducts}개 상품, ${result.stats.uniqueBrands}개 브랜드 (${(result.stats.duration / 1000).toFixed(1)}s)`)

  return result
}
