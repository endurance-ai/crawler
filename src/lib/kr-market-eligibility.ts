export type KrEligibilityStatus =
  | "unchecked"
  | "eligible_origin"
  | "eligible_storefront"
  | "price_only"
  | "unsupported"
  | "inconclusive"
  | "retryable_error"

export type KrSupportStatus = "unchecked" | "supported" | "unsupported" | "unknown"

export interface KrPriceProbe {
  context: "default" | "shopify_market" | "localized_url"
  storefrontUrl: string
  productsUrl: string
  currency: string | null
  variantPriceCount: number
  countryCodes: string[]
  status: "ok" | "http_error" | "network_error" | "invalid_response"
  detail?: string
}

export interface KrEligibilityAssessment {
  status: KrEligibilityStatus
  localizationStatus: KrSupportStatus
  shippingStatus: KrSupportStatus
  priceCurrency: string | null
  storefrontUrl: string | null
  checkedAt: string
  nextCheckAt: string | null
  evidence: Record<string, unknown>
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

const KR_LOCALE_PATH = /\/(?:en|ko)[-_]kr(?:\/|$)|\/kr(?:[-_](?:en|ko))?(?:\/|$)/i
const KR_QUERY = /(?:country|market|region|locale)=(?:ko[-_])?kr\b/i
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function withTrailingSlash(url: URL): URL {
  const copy = new URL(url)
  if (!copy.pathname.endsWith("/")) copy.pathname += "/"
  return copy
}

export function isKrLocalizedUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return KR_LOCALE_PATH.test(url.pathname) || KR_QUERY.test(url.search.slice(1))
  } catch {
    return false
  }
}

/** Extract only explicit KR locale/market links, never generic navigation URLs. */
export function discoverKrStorefrontUrls(homepageUrl: string, html: string): string[] {
  const found: string[] = []
  const homepageHost = new URL(homepageUrl).hostname.toLowerCase()
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1]!, homepageUrl)
      if (
        url.protocol.startsWith("http") &&
        url.hostname.toLowerCase() === homepageHost &&
        isKrLocalizedUrl(url.toString())
      ) {
        const localeMatch = url.pathname.match(KR_LOCALE_PATH)
        if (localeMatch?.index !== undefined) {
          url.pathname = url.pathname.slice(0, localeMatch.index + localeMatch[0].replace(/\/$/, "").length)
          url.search = ""
          url.hash = ""
        }
        found.push(url.toString())
      }
    } catch {
      // Ignore malformed third-party hrefs.
    }
  }
  return unique(found).slice(0, 5)
}

/**
 * Country selectors are stronger than a currency symbol: they are emitted by
 * Shopify localization forms from the market countries the storefront exposes.
 */
export function extractLocalizationCountryCodes(html: string): string[] {
  if (!/localization|country[_-]?selector|country[_-]?code/i.test(html)) return []
  const codes = [
    ...[...html.matchAll(/<option[^>]+value=["']([A-Z]{2})["']/g)].map((m) => m[1]!),
    ...[...html.matchAll(/<input[^>]+name=["']country_code["'][^>]+value=["']([A-Z]{2})["']/gi)].map((m) => m[1]!),
    ...[...html.matchAll(/<input[^>]+value=["']([A-Z]{2})["'][^>]+name=["']country_code["']/gi)].map((m) => m[1]!),
    ...[...html.matchAll(/["'](?:iso_code|country_code)["']\s*:\s*["']([A-Z]{2})["']/g)].map((m) => m[1]!),
  ]
  return unique(codes.map((code) => code.toUpperCase()))
}

function positiveVariantPriceCount(json: unknown): number {
  const products = (json as {products?: unknown[]})?.products
  if (!Array.isArray(products)) return 0
  let count = 0
  for (const product of products) {
    const variants = (product as {variants?: unknown[]})?.variants
    if (!Array.isArray(variants)) continue
    for (const variant of variants) {
      const raw = (variant as {price?: unknown})?.price
      const price = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""))
      if (Number.isFinite(price) && price > 0) count++
    }
  }
  return count
}

export function extractActualOfferCurrencies(html: string): string[] {
  const currencies: string[] = []
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root = JSON.parse(match[1]!) as unknown
      const visit = (value: unknown, insideProduct = false): void => {
        if (Array.isArray(value)) {
          for (const item of value) visit(item, insideProduct)
          return
        }
        if (!value || typeof value !== "object") return
        const object = value as Record<string, unknown>
        const type = String(object["@type"] ?? "").toLowerCase()
        const isProduct = insideProduct || type === "product"
        if (isProduct && type === "offer") {
          const currency = typeof object.priceCurrency === "string" ? object.priceCurrency.toUpperCase() : ""
          const price = Number.parseFloat(String(object.price ?? object.lowPrice ?? ""))
          if (/^[A-Z]{3}$/.test(currency) && Number.isFinite(price) && price > 0) currencies.push(currency)
        }
        for (const child of Object.values(object)) visit(child, isProduct)
      }
      visit(root)
    } catch {
      // Invalid merchant JSON-LD is not evidence.
    }
  }
  return unique(currencies)
}

function discoverProductUrls(baseUrl: string, html: string): string[] {
  const found: string[] = []
  const baseHost = new URL(baseUrl).hostname.toLowerCase()
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1]!, baseUrl)
      if (
        url.hostname.toLowerCase() === baseHost &&
        /\/(?:products?|goods?)\//i.test(url.pathname)
      ) found.push(url.toString())
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return unique(found).slice(0, 3)
}

async function probeProductPageContext(
  fetchImpl: FetchLike,
  storefrontUrl: string,
): Promise<KrPriceProbe> {
  try {
    const storefrontResponse = await request(fetchImpl, new URL(storefrontUrl), {
      headers: {
        "User-Agent": "Mozilla/5.0 kiko.ai KR market eligibility detector",
        Accept: "text/html,*/*;q=0.8",
      },
    })
    if (!storefrontResponse.ok) {
      return {
        context: "localized_url",
        storefrontUrl,
        productsUrl: storefrontUrl,
        currency: null,
        variantPriceCount: 0,
        countryCodes: [],
        status: "http_error",
        detail: `storefront=${storefrontResponse.status}`,
      }
    }
    const storefrontHtml = await storefrontResponse.text()
    const countryCodes = extractLocalizationCountryCodes(storefrontHtml)
    const productUrl = discoverProductUrls(storefrontResponse.url || storefrontUrl, storefrontHtml)[0]
    if (!productUrl) {
      return {
        context: "localized_url",
        storefrontUrl: storefrontResponse.url || storefrontUrl,
        productsUrl: storefrontResponse.url || storefrontUrl,
        currency: null,
        variantPriceCount: 0,
        countryCodes,
        status: "invalid_response",
        detail: "localized storefront exposed no product link",
      }
    }
    const productResponse = await request(fetchImpl, new URL(productUrl), {
      headers: {
        "User-Agent": "Mozilla/5.0 kiko.ai KR market eligibility detector",
        Accept: "text/html,*/*;q=0.8",
        Referer: storefrontResponse.url || storefrontUrl,
      },
    })
    if (!productResponse.ok) {
      return {
        context: "localized_url",
        storefrontUrl: storefrontResponse.url || storefrontUrl,
        productsUrl: productUrl,
        currency: null,
        variantPriceCount: 0,
        countryCodes,
        status: "http_error",
        detail: `product=${productResponse.status}`,
      }
    }
    const currencies = extractActualOfferCurrencies(await productResponse.text())
    return {
      context: "localized_url",
      storefrontUrl: storefrontResponse.url || storefrontUrl,
      productsUrl: productResponse.url || productUrl,
      currency: currencies.length === 1 ? currencies[0]! : null,
      variantPriceCount: currencies.length === 1 ? 1 : 0,
      countryCodes,
      status: currencies.length === 1 ? "ok" : "invalid_response",
      detail: currencies.length > 1 ? `conflicting offer currencies: ${currencies.join(",")}` : undefined,
    }
  } catch (error) {
    return {
      context: "localized_url",
      storefrontUrl,
      productsUrl: storefrontUrl,
      currency: null,
      variantPriceCount: 0,
      countryCodes: [],
      status: "network_error",
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function request(fetchImpl: FetchLike, url: URL, init: RequestInit): Promise<Response> {
  return fetchImpl(url, {...init, signal: AbortSignal.timeout(12_000)})
}

async function probeShopifyContext(
  fetchImpl: FetchLike,
  storefrontUrl: string,
  context: KrPriceProbe["context"],
  cookie?: string,
): Promise<KrPriceProbe> {
  const base = withTrailingSlash(new URL(storefrontUrl))
  const cartUrl = new URL("cart.js", base)
  const productsUrl = new URL("products.json?limit=2", base)
  const headers = {
    "User-Agent": "Mozilla/5.0 kiko.ai KR market eligibility detector",
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    ...(cookie ? {Cookie: cookie} : {}),
  }
  try {
    const [cartResponse, productsResponse, pageResponse] = await Promise.all([
      request(fetchImpl, cartUrl, {headers}),
      request(fetchImpl, productsUrl, {headers}),
      request(fetchImpl, base, {headers: {...headers, Accept: "text/html,*/*;q=0.8"}}),
    ])
    if (!cartResponse.ok || !productsResponse.ok) {
      return {
        context,
        storefrontUrl: base.toString(),
        productsUrl: productsUrl.toString(),
        currency: null,
        variantPriceCount: 0,
        countryCodes: pageResponse.ok ? extractLocalizationCountryCodes(await pageResponse.text()) : [],
        status: "http_error",
        detail: `cart=${cartResponse.status},products=${productsResponse.status}`,
      }
    }
    const [cart, products, html] = await Promise.all([
      cartResponse.json() as Promise<{currency?: unknown}>,
      productsResponse.json() as Promise<unknown>,
      pageResponse.ok ? pageResponse.text() : Promise.resolve(""),
    ])
    const currency = typeof cart.currency === "string" ? cart.currency.toUpperCase() : null
    const variantPriceCount = positiveVariantPriceCount(products)
    return {
      context,
      storefrontUrl: base.toString(),
      productsUrl: productsUrl.toString(),
      currency,
      variantPriceCount,
      countryCodes: extractLocalizationCountryCodes(html),
      status: currency && variantPriceCount > 0 ? "ok" : "invalid_response",
      detail: currency ? undefined : "cart.js did not provide ISO currency",
    }
  } catch (error) {
    return {
      context,
      storefrontUrl: base.toString(),
      productsUrl: productsUrl.toString(),
      currency: null,
      variantPriceCount: 0,
      countryCodes: [],
      status: "network_error",
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export function assessKrMarketProbes(
  probes: KrPriceProbe[],
  originCountry: string | null,
  checkedAt = new Date().toISOString(),
): KrEligibilityAssessment {
  if (originCountry?.toUpperCase() === "KR") {
    return {
      status: "eligible_origin",
      localizationStatus: "supported",
      shippingStatus: "unknown",
      priceCurrency: null,
      storefrontUrl: null,
      checkedAt,
      nextCheckAt: null,
      evidence: {rule: "origin_country=KR", probes},
    }
  }

  const defaultProbe = probes.find((probe) => probe.context === "default" && probe.status === "ok")
  const krwProbes = probes.filter(
    (probe) => probe.status === "ok" && probe.currency === "KRW" && probe.variantPriceCount > 0,
  )
  const krw = krwProbes.find((probe) => probe.context === "localized_url") ?? krwProbes[0]
  const allCountryCodes = unique(probes.flatMap((probe) => probe.countryCodes))
  // A single hidden country_code often means only "current country", not the
  // complete supported-country list. It can prove KR support, but cannot prove
  // KR exclusion. Require multiple options before declaring unsupported.
  const explicitCountryList = allCountryCodes.length >= 2
  const urlLocalized = Boolean(krw && isKrLocalizedUrl(krw.storefrontUrl))
  const cookieLocalized = Boolean(
    krw?.context === "shopify_market" && defaultProbe?.currency && defaultProbe.currency !== "KRW",
  )
  const localizationSupported = urlLocalized || cookieLocalized || allCountryCodes.includes("KR")
  const shippingStatus: KrSupportStatus = allCountryCodes.includes("KR")
    ? "supported"
    : explicitCountryList
      ? "unsupported"
      : "unknown"

  let status: KrEligibilityStatus
  if (krw && localizationSupported && shippingStatus !== "unsupported") status = "eligible_storefront"
  else if (krw) status = "price_only"
  else if (explicitCountryList && !allCountryCodes.includes("KR")) status = "unsupported"
  else if (probes.length > 0 && probes.every((probe) => probe.status === "network_error")) status = "retryable_error"
  else status = "inconclusive"

  return {
    status,
    localizationStatus: localizationSupported ? "supported" : shippingStatus === "unsupported" ? "unsupported" : "unknown",
    shippingStatus,
    priceCurrency: krw?.currency ?? defaultProbe?.currency ?? null,
    storefrontUrl: krw?.storefrontUrl ?? null,
    checkedAt,
    nextCheckAt:
      status === "retryable_error" || status === "inconclusive"
        ? new Date(new Date(checkedAt).getTime() + RETRY_AFTER_MS).toISOString()
        : null,
    evidence: {
      rule: "actual_variant_price_and_iso_currency",
      localized_url: urlLocalized,
      shopify_market_currency_changed: cookieLocalized,
      country_codes: allCountryCodes,
      probes,
    },
  }
}

export async function probeKrMarketEligibility(input: {
  homepageUrl: string
  homepageHtml: string
  platformType: string
  originCountry: string | null
  fetchImpl?: FetchLike
  checkedAt?: string
}): Promise<KrEligibilityAssessment> {
  const checkedAt = input.checkedAt ?? new Date().toISOString()
  if (input.originCountry?.toUpperCase() === "KR") {
    return assessKrMarketProbes([], input.originCountry, checkedAt)
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const discovered = discoverKrStorefrontUrls(input.homepageUrl, input.homepageHtml)
  const probes: KrPriceProbe[] = []
  if (input.platformType === "shopify") {
    probes.push(await probeShopifyContext(fetchImpl, input.homepageUrl, "default"))
    probes.push(
      await probeShopifyContext(
        fetchImpl,
        input.homepageUrl,
        "shopify_market",
        "localization=KR; country=KR",
      ),
    )
    for (const url of discovered) {
      probes.push(await probeShopifyContext(fetchImpl, url, "localized_url"))
    }
  } else {
    for (const url of discovered) probes.push(await probeProductPageContext(fetchImpl, url))
  }
  return assessKrMarketProbes(probes, input.originCountry, checkedAt)
}

export function krEligibilityPatch(assessment: KrEligibilityAssessment): Record<string, unknown> {
  return {
    kr_eligibility_status: assessment.status,
    kr_localization_status: assessment.localizationStatus,
    kr_shipping_status: assessment.shippingStatus,
    kr_price_currency: assessment.priceCurrency,
    kr_storefront_url: assessment.storefrontUrl,
    kr_eligibility_evidence: assessment.evidence,
    kr_eligibility_checked_at: assessment.checkedAt,
    kr_eligibility_next_check_at: assessment.nextCheckAt,
  }
}

export function isRetryableEligibilityError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /timeout|timed out|fetch failed|enotfound|eai_again|econnreset|econnrefused|socket|network/i.test(message)
}

export function retryableKrEligibilityAssessment(
  error: unknown,
  checkedAt = new Date().toISOString(),
): KrEligibilityAssessment {
  const message = error instanceof Error ? error.message : String(error)
  return {
    status: "retryable_error",
    localizationStatus: "unknown",
    shippingStatus: "unknown",
    priceCurrency: null,
    storefrontUrl: null,
    checkedAt,
    nextCheckAt: new Date(new Date(checkedAt).getTime() + RETRY_AFTER_MS).toISOString(),
    evidence: {rule: "transient_detection_failure", error: message},
  }
}
