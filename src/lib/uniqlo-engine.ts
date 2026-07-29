/**
 * Uniqlo (KR + US) crawl engine — region-parameterized.
 *
 * Fetch-pagination over `/<region>/api/commerce/v5/<locale>/products`
 * using the `path` query parameter to scope each iteration to a
 * category. Pure `fetch` — no Playwright. Mirrors the structural
 * pattern of `shopify-engine.ts` (image-host whitelist, abort-on-error,
 * no FX at engine time — caller converts at upsert time when needed).
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-001 (KR baseline),
 *       SPEC-PLATFORM-EXPANSION-002 (US extension via region parameter)
 */

import type {CrawlResult, Product, SiteConfig} from "./types"
import {checkRobots} from "./robots-check"

type UniqloRegion = "KR" | "US"

// API host is the bare uniqlo.com origin — note the API lives at the host
// root, NOT under the SPA locale prefix. We derive the API base from
// `config.baseUrl`'s origin and append the region-specific API path.
//
// SPEC-PLATFORM-EXPANSION-002 REQ-002: API path/locale/currency become
// functions of `config.region` instead of hardcoded constants.
function buildApiPath(region: UniqloRegion): string {
  return region === "US"
    ? "/us/api/commerce/v5/en/products"
    : "/kr/api/commerce/v5/ko/products"
}

function localeForRegion(region: UniqloRegion): string {
  return region === "US" ? "en-US" : "ko-KR"
}

function defaultCurrencyForRegion(region: UniqloRegion): "USD" | "KRW" {
  return region === "US" ? "USD" : "KRW"
}

function defaultSymbolForRegion(region: UniqloRegion): string {
  return region === "US" ? "$" : "₩"
}

const PAGE_LIMIT = 100

// Five realistic Mozilla User-Agents covering Chrome / Safari / Firefox.
// Round-robin per-request via `pickUserAgent`.
const UNIQLO_USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
] as const

export function pickUserAgent(index: number): string {
  return UNIQLO_USER_AGENTS[index % UNIQLO_USER_AGENTS.length]!
}

/**
 * Image URL whitelist for Uniqlo CDN. Only `image.uniqlo.com` and
 * `asset.uniqlo.com` are accepted. Unknown hosts return false.
 * Mirrors the pattern at `shopify-engine.ts:47-60`.
 */
export function isSafeUniqloImageUrl(src: string): boolean {
  if (typeof src !== "string" || !src.startsWith("https://")) return false
  try {
    const host = new URL(src).hostname
    return host === "image.uniqlo.com" || host === "asset.uniqlo.com"
  } catch {
    return false
  }
}

// ─── Uniqlo API response shape (derived from research.md §1 [^u2]) ───

interface UniqloPriceLeg {
  currency?: {code?: string; symbol?: string}
  value?: number
}

interface UniqloItem {
  productId?: string
  l1Id?: string
  name?: string
  genderName?: string
  genderCategory?: string
  prices?: {
    base?: UniqloPriceLeg | null
    promo?: UniqloPriceLeg | null
    isDualPrice?: boolean
  }
  colors?: Array<{code?: string; displayCode?: string; name?: string}>
  sizes?: Array<{code?: string; displayCode?: string; name?: string}>
  images?: {
    main?: Record<string, {image?: string} | undefined>
    chip?: Record<string, string | undefined>
    sub?: Array<{image?: string}>
  }
  representative?: {
    sales?: boolean
    color?: {displayCode?: string}
  }
  representativeColorDisplayCode?: string
}

interface UniqloPagination {
  total?: number
  offset?: number
  count?: number
}

interface UniqloApiResponse {
  status?: string
  result?: {
    items?: UniqloItem[]
    pagination?: UniqloPagination
  }
}

// ─── Field mapping ─────────────────────────────────────


function mapImages(item: UniqloItem): {primary: string; all: string[]} {
  const collected: string[] = []
  const main = item.images?.main
  const repColor = item.representative?.color?.displayCode || item.representativeColorDisplayCode

  if (main && repColor && main[repColor]?.image) {
    const img = main[repColor]!.image!
    if (isSafeUniqloImageUrl(img)) collected.push(img)
  }
  if (main) {
    for (const key of Object.keys(main)) {
      const img = main[key]?.image
      if (img && isSafeUniqloImageUrl(img) && !collected.includes(img)) collected.push(img)
    }
  }
  for (const sub of item.images?.sub ?? []) {
    if (sub.image && isSafeUniqloImageUrl(sub.image) && !collected.includes(sub.image)) {
      collected.push(sub.image)
    }
  }

  const limited = collected.slice(0, 10)
  return {primary: limited[0] ?? "", all: limited}
}

/**
 * Pure parse function — converts a Uniqlo API JSON payload into a
 * `Product[]`. Exposed for unit testing against the frozen fixtures
 * (one per region).
 *
 * `baseUrl` is used to build the productUrl (`<baseUrl>/products/<productId>`).
 * `platformKey` maps to `Product.platform`.
 * `region` drives source currency code, default symbol, and locale for
 *   `priceFormatted`. Defaults to "KR" for backward compat.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-002 — region parameter replaces
 *   the previously hardcoded "KRW" / "ko-KR" / "₩" assumptions.
 */
export function parseProducts(
  json: UniqloApiResponse,
  baseUrl: string,
  platformKey: string,
  region: UniqloRegion = "KR",
): Product[] {
  const items = json.result?.items ?? []
  const products: Product[] = []
  const crawledAt = new Date().toISOString()
  const locale = localeForRegion(region)
  const sourceCurrency = defaultCurrencyForRegion(region)
  const fallbackSymbol = defaultSymbolForRegion(region)

  for (const item of items) {
    if (!item.productId) continue

    const baseValue = item.prices?.base?.value
    const promoValue = item.prices?.promo?.value
    const price = typeof baseValue === "number" ? baseValue : null
    const symbol = item.prices?.base?.currency?.symbol ?? fallbackSymbol
    const promoPrice =
      typeof promoValue === "number" && typeof baseValue === "number" && promoValue < baseValue
        ? promoValue
        : null

    const {primary, all} = mapImages(item)

    const sizeNames = (item.sizes ?? [])
      .map((s) => s.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0)

    products.push({
      brand: "Uniqlo",
      name: item.name ?? "",
      category: item.genderCategory ?? "",
      price,
      originalPrice: price,
      salePrice: promoPrice,
      priceFormatted: price !== null ? `${symbol}${price.toLocaleString(locale)}` : "",
      imageUrl: primary,
      productUrl: `${baseUrl}/products/${item.productId}`,
      inStock: item.representative?.sales ?? true,
      platform: platformKey,
      crawledAt,
      productCode: item.productId,
      sizeInfo: sizeNames.length > 0 ? sizeNames.join(", ").slice(0, 200) : undefined,
      images: all.length > 0 ? all : undefined,
      sourceCurrency,
      sourcePrice: price ?? undefined,
    })
  }

  return products
}

// ─── Engine entry ──────────────────────────────────────

/**
 * @MX:ANCHOR: [AUTO] Uniqlo crawler entry point. Invariant: ALWAYS returns
 * a CrawlResult, never throws. Errors are surfaced via result.errors[].
 * @MX:REASON: fan_in >= 3 (runCrawl, probeSite, characterization tests).
 * Behavior change here ripples through dispatch wiring and test fixtures;
 * keep the contract stable. Region parameter (KR vs US) is the only
 * region-specific dial — narrow surface for region-specific bugs.
 * @MX:SPEC: SPEC-PLATFORM-EXPANSION-001 REQ-002, REQ-005; SPEC-PLATFORM-EXPANSION-002 REQ-002, REQ-003
 */
export async function crawlUniqlo(config: SiteConfig): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []
  const allProducts: Product[] = []
  const crawlDelay = config.crawlDelay ?? 1000
  const region: UniqloRegion = config.region ?? "KR"
  const apiPath = buildApiPath(region)
  const apiOrigin = (() => {
    try {
      return new URL(config.baseUrl).origin
    } catch {
      return "https://www.uniqlo.com"
    }
  })()
  const paths = config.apiCategoryPaths ?? []

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl}) [Uniqlo]`)
  console.log(`${"─".repeat(50)}`)

  // REQ-004 pre-flight: robots.txt check before any product fetch.
  const robots = await checkRobots(config.baseUrl)
  if (!robots.allowed) {
    const msg =
      `[robots-block] ${config.key} blocked by robots.txt — ` +
      `${robots.blockingLine ?? "unknown"}. Project HARD rule #1: sites that ` +
      `explicitly forbid crawling MUST be deferred.`
    errors.push(msg)
    console.error(`   ❌ ${msg}`)
    return buildResult(config.key, allProducts, errors, startTime)
  }

  let reqCounter = 0

  for (const path of paths) {
    let offset = 0
    let consecutiveErrors = 0

    while (true) {
      const url =
        `${apiOrigin}${apiPath}` +
        `?path=${encodeURIComponent(path)}&limit=${PAGE_LIMIT}&offset=${offset}`

      // @MX:WARN: [AUTO] Pacing window — each request waits `crawlDelay`
      // before the next fetch. Reducing this below 200ms (i.e. --rate>5)
      // is rejected at the CLI parse level.
      // @MX:REASON: Akamai Bot Manager rate-limit escalation observed on
      // sibling Inditex / H&M deployments. 1 req/sec is the agreed
      // baseline (REQ-002). Lower delay raises the risk that Akamai
      // promotes from passive cookies to active 4xx blocks for the API
      // path, which would invalidate every subsequent request in the run.
      // Pace BEFORE every request after the first one across the whole run,
      // not just within a single category. Otherwise N single-page categories
      // would fire N rapid-fire requests with no inter-request delay,
      // violating REQ-002's per-request 1 req/sec contract.
      if (reqCounter > 0) {
        await new Promise((r) => setTimeout(r, crawlDelay))
      }

      let res: Response
      try {
        res = await fetch(url, {
          headers: {
            "User-Agent": pickUserAgent(reqCounter++),
            Accept: "application/json",
          },
        })
      } catch (err) {
        consecutiveErrors += 1
        const status = "NETWORK_ERROR"
        if (consecutiveErrors >= 3) {
          errors.push(
            JSON.stringify({
              category: path,
              status,
              url,
              timestamp: new Date().toISOString(),
              detail: String(err),
            }),
          )
          console.error(`   ❌ ${path}: aborting after 3 consecutive errors`)
          break
        }
        continue
      }

      if (!res.ok) {
        consecutiveErrors += 1
        if (consecutiveErrors >= 3) {
          errors.push(
            JSON.stringify({
              category: path,
              status: res.status,
              url,
              timestamp: new Date().toISOString(),
            }),
          )
          console.error(`   ❌ ${path}: aborting after 3 consecutive HTTP ${res.status}`)
          break
        }
        continue
      }

      consecutiveErrors = 0

      let json: UniqloApiResponse
      try {
        json = (await res.json()) as UniqloApiResponse
      } catch (err) {
        consecutiveErrors += 1
        if (consecutiveErrors >= 3) {
          errors.push(
            JSON.stringify({
              category: path,
              status: "JSON_PARSE_ERROR",
              url,
              timestamp: new Date().toISOString(),
              detail: String(err),
            }),
          )
          break
        }
        continue
      }

      const pagination = json.result?.pagination ?? {}
      const total = pagination.total ?? 0
      const count = pagination.count ?? json.result?.items?.length ?? 0

      // AC-7 / empty category: terminate gracefully without an error entry.
      if (total === 0 && count === 0 && offset === 0) {
        console.log(`   ℹ️  category=${path} returned 0 products`)
        break
      }

      const pageProducts = parseProducts(json, config.baseUrl, config.key, region)
      allProducts.push(...pageProducts)
      console.log(`   ${path} offset=${offset}: ${pageProducts.length} products`)

      offset += PAGE_LIMIT
      if (count === 0 || offset >= total) break
    }
  }

  return buildResult(config.key, allProducts, errors, startTime)
}

function buildResult(
  platformKey: string,
  products: Product[],
  errors: string[],
  startTime: number,
): CrawlResult {
  const uniqueBrands = new Set(products.map((p) => p.brand))
  const withPrice = products.filter((p) => p.price !== null)
  const avgPrice =
    withPrice.length > 0
      ? Math.round(withPrice.reduce((s, p) => s + (p.price ?? 0), 0) / withPrice.length)
      : 0

  return {
    platform: platformKey,
    products,
    stats: {
      totalProducts: products.length,
      inStock: products.filter((p) => p.inStock).length,
      outOfStock: products.filter((p) => !p.inStock).length,
      uniqueBrands: uniqueBrands.size,
      avgPrice,
      duration: Date.now() - startTime,
    },
    errors,
  }
}

// ─── --rate=N flag helpers (REQ-007) ──────────────────────

export interface RateOverride {
  /** Effective per-request delay in ms. */
  delayMs: number
  /** Requests-per-second value parsed from the flag. */
  ratePerSecond: number
}

/**
 * Parse a `--rate=N` argument value. Validates the rate-cap policy at
 * parse time per REQ-007: integer in [1, 5]. Returns Error on rejection.
 */
export function parseRateFlag(raw: string): RateOverride | Error {
  if (typeof raw !== "string" || raw === "") {
    return new Error("--rate=N requires a value (positive integer 1..5)")
  }
  // Reject non-integer numerics (e.g. "2.5") explicitly — Number() would
  // accept them silently.
  if (!/^-?\d+$/.test(raw)) {
    return new Error(
      `--rate=${raw} rejected: must be an integer. Rate-cap policy: 1..5 requests/second.`,
    )
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    return new Error(
      `--rate=${raw} rejected: must be a positive integer. Rate-cap policy: 1..5 requests/second.`,
    )
  }
  if (n > 5) {
    return new Error(
      `--rate=${raw} rejected: exceeds rate-cap of 5 requests/second per site (REQ-007). ` +
        `This cap is policy and cannot be overridden at the CLI.`,
    )
  }
  return {
    delayMs: Math.floor(1000 / n),
    ratePerSecond: n,
  }
}
