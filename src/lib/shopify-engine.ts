/**
 * Shopify 크롤 엔진
 *
 * Shopify 사이트의 /products.json 엔드포인트 활용
 * 페이지네이션: ?page=N (기본 250개/페이지, 빈 배열 올 때까지)
 */

import type {CrawlResult, Product, SiteConfig} from "./types"
import {CURRENCY_SYMBOL, CURRENCY_TO_COUNTRY} from "./fx"
import {
  inferGenderFromDepartmentTagPrefixes,
  inferGenderFromModelDescription,
  inferGenderFromText,
  type ProductGender,
} from "./product-gender"
import {normalizeObservedPricing} from "./product-pricing"
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
    // 일부 Shopify/Cloudflare endpoint는 연결만 잡고 응답 body를 끝내지 않아
    // 사이트 하나가 전체 다중 브랜드 배치를 영구 정지시킨다. 개별 요청을
    // 30초로 제한하고 호출자가 해당 사이트 오류를 기록한 뒤 다음으로 간다.
    const timeoutSignal = AbortSignal.timeout(30_000)
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal
    const res = await fetch(url, {...init, signal})
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
    compare_at_price?: string | null
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
 *   - brandOverride   → `config.brand`           (single-brand house brand)
 *   - brandFallback   → legacy caller fallback   (when vendor empty)
 * `region` is intentionally absent — Shopify has no region concept (unlike
 * the uniqlo engine). The fetch-only dials (`country` /
 * `localizationCookie`) stay in `crawlShopify` because they shape request
 * headers, not the parse output.
 */
export interface ShopifyParseOptions {
  /** Native source currency. Undefined → "KRW" (preserves original `config.sourceCurrency || "KRW"`). */
  sourceCurrency?: SiteConfig["sourceCurrency"]
  /**
   * Single-brand house brand. When set, this is used verbatim instead of
   * Shopify's per-product vendor value.
   */
  brandOverride?: string
  /**
   * House brand used when `product.vendor` is empty. Set from `config.brand`
   * (single-brand mall). Multi-brand editshops leave this undefined so the
   * brand stays "" rather than leaking the platform name. */
  brandFallback?: string
  /** Site-wide default gender seed (`config.defaultGender`). */
  defaultGender?: string[]
  /** 사이트별 구조화 성별 부서 태그 prefix. */
  genderDepartmentTagPrefixes?: SiteConfig["genderDepartmentTagPrefixes"]
  /** 공식 Shopify 성별 컬렉션에서 확인한 product handle별 성별. */
  genderByHandle?: Record<string, ProductGender>
  /** 상품 설명의 명시적 Male:/Female: 모델 라벨을 사용한다. */
  genderFromModelDescription?: boolean
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
      titleLower.endsWith("gift card") ||
      titleLower === "return protection" ||
      titleLower === "shipping protection" ||
      titleLower === "package protection" ||
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

    const inStock = sp.variants.some((v) => v.available)
    if (!inStock && !options.keepOutOfStock) continue  // 품절 상품 제외
    const eligibleVariants = inStock ? sp.variants.filter((v) => v.available) : sp.variants
    const validVariants = eligibleVariants
      .map((variant) => ({
        variant,
        price: Number.parseFloat(variant.price),
        compareAt: variant.compare_at_price == null
          ? null
          : Number.parseFloat(variant.compare_at_price),
      }))
      .filter((entry) => Number.isFinite(entry.price) && entry.price > 0)
    const saleVariants = validVariants.filter(
      (entry) => entry.compareAt !== null && Number.isFinite(entry.compareAt) && entry.compareAt > entry.price,
    )
    const chosen = (saleVariants.length > 0 ? saleVariants : validVariants)
      .sort((a, b) => a.price - b.price)[0]
    // 가격이 없는 engraving/consultation 같은 서비스 add-on은 판매 상품이
    // 아니다. unknown 관측으로 남기면 import의 플랫폼 단위 가격 안전장치가
    // 정상 상품 전체를 막으므로 크롤 단계에서 제외한다.
    if (!chosen) continue
    const pricing = chosen
      ? normalizeObservedPricing({
          currentPrice: chosen.price,
          originalPrice: chosen.compareAt,
          salePrice: saleVariants.length > 0 ? chosen.price : null,
          state: saleVariants.length > 0 ? "sale" : "regular",
          source: "variant",
        })
      : normalizeObservedPricing({currentPrice: null, state: "unknown", source: "variant"})

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
    const priceFormatted = pricing.price !== null
      ? (currency === "KRW"
          ? `${symbol}${pricing.price.toLocaleString("ko-KR")}`
          : `${symbol}${pricing.price.toFixed(2)}`)
      : ""
    if (!inStock && !options.keepOutOfStock) continue  // 품절 상품 제외

    // gender 추론 (태그에서). 태그가 실제로 성별을 말해주면 engine 근거이고,
    // 아무 말도 안 해서 사이트 기본값만 남으면 config_default 다.
    //
    // 삭제 전 코드는 골든 마스터(tests/shopify-parse.characterization.test.ts,
    // "do NOT regenerate")를 깨지 않으려고 genderSource 를 아예 stamp 하지
    // 않았고, 그 결과 defaultGender 로만 정해진 shopify 상품이 engine 으로
    // 기록돼 실제보다 신뢰도가 높게 표시됐다. import-products 의 dedup rank 가
    // 이 구분에 의존하므로 여기서는 제대로 stamp 하고 골든을 갱신한다.
    // 태그 성별 추론은 공용 규칙(GENDER_RULES)에 위임한다.
    //
    // 삭제 전 코드는 `t.includes("men")` 으로 직접 판정했는데 **"womens" 가
    // "men" 을 포함한다** — w-o-[m-e-n]-s. 그래서 여성 태그 상품이 전부
    // ["women","men"] 이 됐고, 검색 RPC 의 `p.gender && ARRAY[p_gender,'unisex']`
    // 에서 남녀 양쪽에 노출됐다. 실측: 적재 예정분의 41.7% 가 다중값이었고
    // `(WOMEN) DENIM PRINTED BRA-TOP` 이 남성 검색에 뜨는 상태였다.
    //
    // inferGenderFromText 는 `\b(men|mens|...)\b` 워드 바운더리를 쓰므로
    // "womens" 를 men 으로 읽지 않고, 남녀가 진짜로 함께 잡히면 null(모호)을
    // 돌려준다 — 추측 대신 미확인이 이 프로젝트의 규율이다.
    const inferredGender = options.genderByHandle?.[sp.handle] ?? inferGenderFromDepartmentTagPrefixes(
      sp.tags,
      options.genderDepartmentTagPrefixes,
    ) ?? (options.genderFromModelDescription
      ? inferGenderFromModelDescription(sp.body_html)
      : null) ?? inferGenderFromText(sp.tags.join(" "))
    const genderFromEvidence = inferredGender !== null
    const gender: string[] = genderFromEvidence ? [inferredGender] : [...(options.defaultGender || [])]

    allProducts.push({
      brand: options.brandOverride || sp.vendor || options.brandFallback || "",
      gender,
      genderSource: genderFromEvidence ? ("engine" as const) : ("config_default" as const),
      name: sp.title,
      ...classifyShopifyCategory(sp.product_type || "", sp.title, sp.tags),
      ...pricing,
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

/**
 * 공식 성별 컬렉션 소속 상품 handle을 읽는다. 같은 상품이 men/women 양쪽
 * 공식 부서에 있으면 양쪽에서 판다는 적극적 근거이므로 unisex로 결의한다.
 * 명시적 unisex 컬렉션은 가장 직접적인 근거로 우선한다.
 */
export async function fetchShopifyGenderByHandle(
  config: SiteConfig,
  country: string,
  localizationCookie: string,
  errors: string[] = [],
): Promise<Record<string, ProductGender>> {
  const configured = config.shopifyGenderCollections
  if (!configured) return {}

  const memberships = new Map<string, Set<ProductGender>>()
  const entries = (Object.entries(configured) as Array<[ProductGender, string[] | undefined]>)
    .flatMap(([gender, handles]) => (handles ?? []).map((handle) => ({gender, handle})))

  for (const {gender, handle} of entries) {
    if (!SAFE_HANDLE.test(handle)) {
      errors.push(`gender collection ${handle}: unsafe handle`)
      continue
    }
    for (let page = 1; page <= (config.maxPages || 20); page++) {
      try {
        const url = `${config.baseUrl}/collections/${handle}/products.json?page=${page}&limit=250&country=${encodeURIComponent(country)}`
        const res = await fetchWithBackoff(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
            Referer: config.baseUrl + "/",
            Cookie: localizationCookie,
          },
        })
        if (!res.ok) {
          errors.push(`gender collection ${handle}: HTTP ${res.status} on page ${page}`)
          break
        }
        const data = await res.json() as ShopifyResponse
        if (!data.products || data.products.length === 0) break
        for (const product of data.products) {
          if (!product.handle || !SAFE_HANDLE.test(product.handle)) continue
          const set = memberships.get(product.handle) ?? new Set<ProductGender>()
          set.add(gender)
          memberships.set(product.handle, set)
        }
        if (data.products.length < 250) break
      } catch (err) {
        errors.push(`gender collection ${handle} page ${page}: ${err}`)
        break
      }
    }
  }

  const result: Record<string, ProductGender> = {}
  for (const [handle, genders] of memberships) {
    if (genders.has("unisex") || (genders.has("men") && genders.has("women"))) {
      result[handle] = "unisex"
    } else if (genders.has("men")) {
      result[handle] = "men"
    } else if (genders.has("women")) {
      result[handle] = "women"
    }
  }
  return result
}

/**
 * Shopify Markets localization must be explicit in the feed URL. Some stores
 * ignore the localization cookie for `/products.json`, which can make a KRW
 * config ingest the default-market JPY/USD amount as if it were KRW.
 */
export function buildShopifyProductsUrl(baseUrl: string, page: number, country: string): string {
  const separator = baseUrl.includes("?") ? "&" : "?"
  return `${baseUrl}/products.json${separator}page=${page}&limit=250&country=${encodeURIComponent(country)}`
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
  const genderByHandle = await fetchShopifyGenderByHandle(config, country, localizationCookie, errors)

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl}) [Shopify]`)
  console.log(`${"─".repeat(50)}`)

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = buildShopifyProductsUrl(config.baseUrl, page, country)
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
          // 단일브랜드몰은 Shopify vendor를 신뢰하지 않고 큐레이션된
          // config.brand를 그대로 쓴다. 멀티브랜드몰은 vendor를 그대로
          // 유지하며, 빈 vendor를 플랫폼명으로 채우지 않는다.
          brandOverride: config.multiBrand ? undefined : config.brand,
          defaultGender: config.defaultGender,
          genderDepartmentTagPrefixes: config.genderDepartmentTagPrefixes,
          genderByHandle,
          genderFromModelDescription: config.genderFromModelDescription,
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
