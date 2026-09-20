import {toRefreshPriceFields, type RefreshableRow, type RefreshPatch} from "./listing-refresh"
import type {StructuredProductData} from "./parsers/structured-data"
import type {Product} from "./types"

export type DetailFetchKind = "confirmed" | "removed" | "blocked" | "transient" | "unreadable"
export type DetailFallbackType = "cafe24" | "shopify" | "zara" | "imweb" | "sixshop"

export function resolveDetailFallbackType(
  snapshotType: string,
  currentType: string | null | undefined,
): DetailFallbackType | null {
  const supported = (value: string | null | undefined): value is DetailFallbackType =>
    value !== null && value !== undefined && ["cafe24", "shopify", "zara", "imweb", "sixshop"].includes(value)
  if (supported(currentType)) return currentType
  return supported(snapshotType) ? snapshotType : null
}

export function detailTransientRetryDelayMs(attempt: number): number | null {
  if (attempt === 0) return 1_000
  if (attempt === 1) return 3_000
  return null
}

export function detailFallbackPacingMs(
  type: DetailFallbackType,
  configuredDelay: number | null | undefined,
): number {
  return Math.max(250, configuredDelay ?? (type === "imweb" ? 1_200 : 500))
}

export interface DetailObservation {
  kind: DetailFetchKind
  status: number | null
  inStock: boolean | null
  price: number | null
  originalPrice: number | null
  salePrice: number | null
  sourceCurrency: string | null
  /** Canonical live PDP discovered while recovering a stale category URL. */
  productUrl?: string | null
  retryAt?: string | null
  /** `unknown` keeps the stored regular-price baseline when only a current price is visible. */
  pricingState?: "regular" | "sale" | "unknown"
}

type ZaraJsonLdOffer = {
  price?: string | number
  priceCurrency?: string
  availability?: string
}

type ZaraJsonLdVariant = {offers?: ZaraJsonLdOffer | ZaraJsonLdOffer[]}

/** Parse Zara's server-rendered schema.org Product/ProductGroup evidence. */
export function parseZaraDetailPayload(payloads: unknown[], sourceCurrency: string): DetailObservation | null {
  const product = payloads.find((value) => {
    if (!value || typeof value !== "object") return false
    const type = (value as Record<string, unknown>)["@type"]
    return type === "Product" || type === "ProductGroup"
  }) as Record<string, unknown> | undefined
  if (!product || typeof product.name !== "string" || !product.name.trim()) return null

  const offers: ZaraJsonLdOffer[] = []
  const append = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const offer of value) append(offer)
    } else if (value && typeof value === "object") {
      offers.push(value as ZaraJsonLdOffer)
    }
  }
  append(product.offers)
  if (Array.isArray(product.hasVariant)) {
    for (const variant of product.hasVariant as ZaraJsonLdVariant[]) append(variant?.offers)
  }
  if (offers.length === 0) return null

  const available = offers.some((offer) => /\/InStock$/i.test(String(offer.availability ?? "")))
  const unavailable = offers.every((offer) => /\/(?:OutOfStock|SoldOut|Discontinued)$/i.test(String(offer.availability ?? "")))
  const priced = offers.find((offer) => Number(offer.price) > 0)
  let price = priced ? Number(priced.price) : null
  const currency = priced?.priceCurrency || sourceCurrency
  // Zara KR schema.org prices omit the final two zeroes: 599 means ₩59,900.
  if (price !== null && currency === "KRW") price *= 100
  return {
    kind: "confirmed",
    status: 200,
    inStock: available ? true : unavailable ? false : null,
    price,
    originalPrice: null,
    salePrice: null,
    sourceCurrency: currency,
    pricingState: "unknown",
  }
}

export interface ZaraDomDetailInput {
  currentPrice: string | number | null
  currency: string | null
  hasAddToCart: boolean
  productText: string
}

/**
 * Zara does not emit schema.org data for every live PDP. Its rendered product
 * panel still exposes a machine-readable price plus explicit cart/stock text,
 * which is enough to refresh sold-out products without treating ambiguity as
 * availability.
 */
export function parseZaraDomDetailPayload(
  input: ZaraDomDetailInput,
  sourceCurrency: string,
): DetailObservation | null {
  const numericPrice = typeof input.currentPrice === "number"
    ? input.currentPrice
    : Number(input.currentPrice)
  const price = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : null
  const soldOut = /(?:out\s+of\s+stock|sold\s+out|품절)/i.test(input.productText)
  const inStock = input.hasAddToCart ? true : soldOut ? false : null
  if (price === null && inStock === null) return null
  return {
    kind: "confirmed",
    status: 200,
    inStock,
    price,
    originalPrice: null,
    salePrice: null,
    sourceCurrency: input.currency || sourceCurrency,
    pricingState: "unknown",
  }
}

export function isZaraRemovedRedirect(requestedUrl: string, finalUrl: string): boolean {
  try {
    const requested = new URL(requestedUrl)
    const final = new URL(finalUrl)
    return requested.hostname === final.hostname && /-p[^/]+\.html$/i.test(requested.pathname) && /\/search\/?$/i.test(final.pathname)
  } catch {
    return false
  }
}

/** Cafe24 themes commonly turn a deleted PDP into a same-host HTTP 200 redirect. */
export function isCafe24RemovedRedirect(requestedUrl: string, finalUrl: string): boolean {
  try {
    const requested = new URL(requestedUrl)
    const final = new URL(finalUrl)
    const hostname = (value: string) => value.toLowerCase().replace(/^www\./, "")
    if (hostname(requested.hostname) !== hostname(final.hostname)) return false
    if (!/^\/product(?:\/|$)/i.test(requested.pathname)) return false
    const finalPath = final.pathname.replace(/\/+$/, "") || "/"
    return /^\/404(?:\.html)?$/i.test(finalPath) || /^\/(?:index\.html)?$/i.test(finalPath)
  } catch {
    return false
  }
}

export interface DetailPriorityRow {
  id: string | number
  in_stock: boolean | null
  last_seen_at: string | null
}

export interface DetailFallbackTimestampRow {
  last_seen_at: string | null
  crawled_at: string | null
}

/**
 * Keep PostgREST `in.(...)` platform filters below the proxy request-line
 * budget. This also prevents a fallback lane from scanning the entire products
 * table when hundreds of batch sources are eligible.
 */
export function chunkDetailFallbackPlatforms(
  platforms: string[],
  budgetBytes = 1_500,
): string[][] {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
    throw new Error("detail fallback platform budget must be a positive safe integer")
  }
  const chunks: string[][] = []
  let current: string[] = []
  let currentBytes = 0
  for (const platform of platforms) {
    const encodedBytes = Buffer.byteLength(encodeURIComponent(platform), "utf8")
    if (encodedBytes > budgetBytes) {
      throw new Error(`detail fallback platform key exceeds URL budget: ${platform}`)
    }
    const separatorBytes = current.length === 0 ? 0 : 1
    if (current.length > 0 && currentBytes + separatorBytes + encodedBytes > budgetBytes) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(platform)
    currentBytes += (current.length === 1 ? 0 : 1) + encodedBytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Coverage after listing and detail observations have both been persisted. */
export function combinedRefreshCoverage(total: number, unconfirmed: number): number {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(unconfirmed) || unconfirmed < 0) {
    throw new Error("refresh coverage counts must be non-negative safe integers")
  }
  if (total === 0) return 1
  return Math.max(0, total - Math.min(total, unconfirmed)) / total
}

export function detailFallbackRecovered(
  total: number,
  unconfirmed: number,
  minimumCoverage: number,
): boolean {
  if (!Number.isFinite(minimumCoverage) || minimumCoverage < 0 || minimumCoverage > 1) {
    throw new Error("detail fallback minimum coverage must be between 0 and 1")
  }
  return combinedRefreshCoverage(total, unconfirmed) >= minimumCoverage
}

export function needsDetailFallback(row: DetailFallbackTimestampRow, since: string): boolean {
  const threshold = Date.parse(since)
  const seenAt = row.last_seen_at ? Date.parse(row.last_seen_at) : 0
  const checkedAt = row.crawled_at ? Date.parse(row.crawled_at) : 0
  return seenAt < threshold && checkedAt < threshold
}

/** Spend a bounded fallback window on URLs most likely to still be live. */
export function compareLikelyLiveDetailRows(a: DetailPriorityRow, b: DetailPriorityRow): number {
  const stockRank = (value: boolean | null) => value === true ? 0 : value === false ? 1 : 2
  const rankDiff = stockRank(a.in_stock) - stockRank(b.in_stock)
  if (rankDiff !== 0) return rankDiff
  const aSeen = a.last_seen_at ? Date.parse(a.last_seen_at) : 0
  const bSeen = b.last_seen_at ? Date.parse(b.last_seen_at) : 0
  if (aSeen !== bSeen) return bSeen - aSeen
  return String(a.id).localeCompare(String(b.id))
}

export function classifyDetailHttpStatus(status: number | null): DetailFetchKind {
  if (status === 404 || status === 410) return "removed"
  if (status === 401 || status === 403) return "blocked"
  if (status === 429 || (status !== null && status >= 500)) return "transient"
  return status !== null && status >= 200 && status < 400 ? "confirmed" : "unreadable"
}

/**
 * Imweb keeps returning HTTP 200 after a store's hosting subscription expires.
 * Treat the provider tombstone as a confirmed removal instead of leaving every
 * historical product permanently unreadable. A later live listing/detail
 * observation can still reactivate products when the store comes back.
 */
export function isImwebExpiredStorePage(html: string): boolean {
  return html.includes("사이트 기간 만료") &&
    html.includes("호스팅 기간이 만료되었습니다")
}

/** Imweb redirects deleted `?idx=` product pages to the same store homepage with HTTP 200. */
export function isImwebRemovedRedirect(requestedUrl: string, finalUrl: string): boolean {
  try {
    const requested = new URL(requestedUrl)
    const final = new URL(finalUrl)
    const hostname = (value: string) => value.toLowerCase().replace(/^www\./, "")
    if (hostname(requested.hostname) !== hostname(final.hostname)) return false
    if (!requested.searchParams.has("idx")) return false
    return (final.pathname.replace(/\/+$/, "") || "/") === "/" && !final.searchParams.has("idx")
  } catch {
    return false
  }
}

/** Rebuild an Imweb PDP with the same stable idx under current public category paths. */
export function imwebDetailFallbackUrls(productUrl: string, categoryUrls: string[]): string[] {
  try {
    const product = new URL(productUrl)
    const idx = product.searchParams.get("idx")
    if (!idx) return []
    const hostname = (value: string) => value.toLowerCase().replace(/^www\./, "")
    const urls = new Set<string>()
    for (const rawCategoryUrl of categoryUrls) {
      const candidate = new URL(rawCategoryUrl, product.origin)
      if (hostname(candidate.hostname) !== hostname(product.hostname)) continue
      candidate.search = ""
      candidate.searchParams.set("idx", idx)
      candidate.hash = ""
      if (candidate.toString() !== product.toString()) urls.add(candidate.toString())
    }
    return [...urls]
  } catch {
    return []
  }
}

export function shopifyProductJsonUrl(productUrl: string): string | null {
  try {
    const url = new URL(productUrl)
    const segments = url.pathname.split("/").filter(Boolean)
    const productIndex = segments.lastIndexOf("products")
    if (productIndex < 0 || productIndex + 1 !== segments.length - 1) return null
    const handle = segments[productIndex + 1].replace(/\.(?:js|json)$/i, "")
    // Shopify handles are usually hyphenated, but valid imported/catalog
    // handles can retain underscores (for example Rodo's SKU-prefixed URLs).
    if (!/^[a-z0-9_][a-z0-9_-]*$/i.test(handle)) return null
    const locale = productIndex > 0 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0]) ? `/${segments[0]}` : ""
    url.pathname = `${locale}/products/${handle}.js`
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

export function parseShopifyDetailPayload(
  payload: unknown,
  sourceCurrency: string,
): DetailObservation | null {
  if (!payload || typeof payload !== "object") return null
  const row = payload as Record<string, unknown>
  if (typeof row.title !== "string" || !row.title.trim()) return null
  const rawPrice = typeof row.price === "number" ? row.price : null
  const rawCompare = typeof row.compare_at_price === "number" ? row.compare_at_price : null
  const price = rawPrice !== null && rawPrice > 0 ? rawPrice / 100 : null
  const compare = rawCompare !== null && rawCompare > 0 ? rawCompare / 100 : null
  const sale = price !== null && compare !== null && compare > price ? price : null
  return {
    kind: "confirmed",
    status: 200,
    inStock: typeof row.available === "boolean" ? row.available : null,
    price,
    originalPrice: sale === null ? price : compare,
    salePrice: sale,
    sourceCurrency,
  }
}

/** Convert schema.org/OG product evidence from Imweb/Sixshop detail pages. */
export function parseStructuredDetailPayload(
  structured: StructuredProductData | null,
  sourceCurrency: string,
): DetailObservation | null {
  if (!structured?.name || (structured.price === null && structured.inStock === null)) return null
  const currency = /^[A-Z]{3}$/.test(structured.currency ?? "")
    ? structured.currency!
    : sourceCurrency
  return {
    kind: "confirmed",
    status: 200,
    inStock: structured.inStock,
    price: structured.price,
    originalPrice: null,
    salePrice: null,
    sourceCurrency: currency,
    // A single structured current price does not prove regular-vs-sale.
    pricingState: "unknown",
  }
}

export function sixshopProductApiUrl(productUrl: string): string | null {
  try {
    const url = new URL(productUrl)
    const segments = url.pathname.split("/").filter(Boolean)
    const marker = segments.findIndex((segment) => segment === "product" || segment === "products")
    if (marker < 0 || marker + 1 !== segments.length - 1) return null
    const slug = segments[marker + 1]
    if (!/^[a-z0-9_-]+$/i.test(slug)) return null
    return `https://sf-gateway.sixshop.io/website/guest/products/${encodeURIComponent(slug)}`
  } catch {
    return null
  }
}

export function parseSixshopDetailPayload(
  payload: unknown,
  sourceCurrency: string,
): DetailObservation | null {
  if (!payload || typeof payload !== "object") return null
  const row = payload as Record<string, unknown>
  if (typeof row.name !== "string" || !row.name.trim()) return null
  const price = row.price && typeof row.price === "object"
    ? row.price as Record<string, unknown>
    : {}
  const original = typeof price.original === "number" && price.original > 0 ? price.original : null
  const current = typeof price.sale === "number" && price.sale > 0 ? price.sale : original
  const sale = current !== null && original !== null && current < original ? current : null
  const explicitlyInactive = row.status === "inactive" || row.displayStatus === "inactive"
  const inStock = typeof row.isOutOfStock === "boolean"
    ? !row.isOutOfStock && !explicitlyInactive
    : explicitlyInactive ? false : null
  if (current === null && inStock === null) return null
  return {
    kind: "confirmed",
    status: 200,
    inStock,
    price: current,
    originalPrice: sale === null ? current : original,
    salePrice: sale,
    sourceCurrency,
    pricingState: sale === null ? "regular" : "sale",
  }
}

export function buildDetailRefreshPatch(
  row: RefreshableRow,
  observation: DetailObservation,
  observedAt: string,
): RefreshPatch {
  const patch: RefreshPatch = {}
  if (observation.productUrl && observation.productUrl !== row.product_url) {
    patch.product_url = observation.productUrl
  }
  if (observation.inStock !== null) {
    patch.in_stock = row.unverified_unisex_quarantined && observation.inStock
      ? false
      : observation.inStock
  }
  if (observation.price !== null && observation.sourceCurrency) {
    const product = {
      price: observation.price,
      originalPrice: observation.originalPrice,
      salePrice: observation.salePrice,
      sourcePrice: observation.price,
      sourceCurrency: observation.sourceCurrency,
      pricingObservation: {
        state: observation.pricingState ?? (observation.salePrice !== null ? "sale" : "regular"),
        source: "detail",
        version: 2,
      },
      crawledAt: observedAt,
    } as Product
    const prices = toRefreshPriceFields(product, row, observation.sourceCurrency)
    if (prices) Object.assign(patch, prices)
  }
  return patch
}

export function buildRemovedProductPatch(checkedAt: string): {
  in_stock: false
  crawled_at: string
  updated_at: string
} {
  return {in_stock: false, crawled_at: checkedAt, updated_at: checkedAt}
}

export function roundRobinByPlatform<T extends {platform: string; last_seen_at: string | null}>(rows: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const row of [...rows].sort((a, b) => (a.last_seen_at ?? "").localeCompare(b.last_seen_at ?? ""))) {
    const group = groups.get(row.platform) ?? []
    group.push(row)
    groups.set(row.platform, group)
  }
  const result: T[] = []
  while (groups.size > 0) {
    for (const [key, group] of groups) {
      const row = group.shift()
      if (row) result.push(row)
      if (group.length === 0) groups.delete(key)
    }
  }
  return result
}
