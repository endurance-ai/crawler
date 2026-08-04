import type {Cafe24Page} from "./cafe24-page"
import type {Product, SiteConfig} from "./types"

/**
 * A generic unisex bucket is a site-wide fallback, not product evidence.
 * Keeping it below URL/text inference prevents edit-shop categories from
 * forcing every product (including verified men- or women-only brands) to
 * unisex. Explicit men/women categories remain trusted engine evidence.
 */
export function cafe24CategoryGenderSource(gender: readonly string[]): "engine" | "config_default" {
  return gender.length === 1 && (gender[0] === "men" || gender[0] === "women")
    ? "engine"
    : "config_default"
}

export interface Cafe24ChainStep<TContext, TValue> {
  name: string
  run: (context: TContext) => Promise<TValue[]> | TValue[]
}

export interface Cafe24ChainResult<TValue> {
  value: TValue[]
  strategy: string
  attempted: Array<{name: string; count: number}>
}

export async function runFirstUsefulCafe24Step<TContext, TValue>(
  context: TContext,
  steps: Array<Cafe24ChainStep<TContext, TValue>>,
  isUseful: (value: TValue[]) => boolean = (value) => value.length > 0,
): Promise<Cafe24ChainResult<TValue>> {
  const attempted: Array<{name: string; count: number}> = []
  let fallback: Cafe24ChainResult<TValue> = {value: [], strategy: "none", attempted}

  for (const step of steps) {
    const value = await step.run(context)
    attempted.push({name: step.name, count: value.length})
    fallback = {value, strategy: step.name, attempted}
    if (isUseful(value)) return fallback
  }

  return fallback
}

export interface Cafe24CategoryCandidate {
  name: string
  cateNo: number
  url: string
}

export function parseCafe24CategoryHref(
  href: string,
  baseUrl: string,
  text = "",
): Cafe24CategoryCandidate | null {
  if (!href || /^javascript:/i.test(href) || href.startsWith("#")) return null

  let url: URL
  try {
    url = new URL(href, baseUrl)
  } catch {
    return null
  }

  const pathname = url.pathname
  const isProductDetail =
    /\/product\//i.test(pathname) && !/\/product\/list\.html$/i.test(pathname)
  if (isProductDetail) return null
  if (/\/(?:board|member|order|myshop|article)\//i.test(pathname)) return null

  const queryCateNo = url.searchParams.get("cate_no")
  const prettyMatch = pathname.match(/\/category\/[^/]+\/(\d+)(?:\/|$)/i)
  const cateNoRaw = queryCateNo ?? prettyMatch?.[1] ?? null
  if (!cateNoRaw) return null

  const cateNo = Number(cateNoRaw)
  if (!Number.isInteger(cateNo) || cateNo <= 0) return null

  const name = cleanCategoryName(text) || nameFromPrettyCategoryPath(pathname) || `cate_no=${cateNo}`
  return {name, cateNo, url: url.href}
}

function cleanCategoryName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^\s*[-|/]+\s*/, "")
    .replace(/\s*[-|/]+\s*$/, "")
    .trim()
    .slice(0, 80)
}

function nameFromPrettyCategoryPath(pathname: string): string {
  const match = pathname.match(/\/category\/([^/]+)\/\d+(?:\/|$)/i)
  if (!match) return ""
  try {
    return decodeURIComponent(match[1] ?? "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  } catch {
    return ""
  }
}


export function isNoisyCafe24CategoryName(name: string, ignorePatterns: string[] = []): boolean {
  const lower = cleanCategoryName(name).toLowerCase()
  if (!lower) return true

  const exact = new Set([
    "home",
    "shop home",
    "login",
    "member",
    "cart",
    "order",
    "mypage",
    "my page",
    "cs",
    "faq",
    "q&a",
    "notice",
    "stockist",
    "brand story",
    "about",
    "about us",
    "journal",
    "magazine",
    "event",
    "events",
    "lookbook",
    "look book",
    "styling",
    "campaign",
    "view more",
    "detail",
    "all",
    "전체",
    "홈",
    "로그인",
    "장바구니",
  ])
  if (exact.has(lower)) return true

  const contains = [
    "brand story",
    "stockist",
    "lookbook",
    "look book",
    "editorial",
    "journal",
    "notice",
    "faq",
    "q&a",
    "membership",
    "view more",
  ]
  if (contains.some((needle) => lower.includes(needle))) return true

  return ignorePatterns.some((pattern) => lower === pattern.toLowerCase())
}

export function dedupeAndFilterCafe24Categories(
  categories: Cafe24CategoryCandidate[],
  ignorePatterns: string[] = [],
): Cafe24CategoryCandidate[] {
  const seen = new Set<number>()
  const out: Cafe24CategoryCandidate[] = []
  for (const category of categories) {
    if (seen.has(category.cateNo)) continue
    seen.add(category.cateNo)
    if (isNoisyCafe24CategoryName(category.name, ignorePatterns)) continue
    out.push(category)
  }
  return out
}

export function cleanCafe24ProductName(raw: string | null | undefined): string {
  let text = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim()
  for (let i = 0; i < 3; i++) {
    const next = text.replace(
      /^(?:상품명|제품명|product\s*name|name|제조사|판매가|브랜드|소비자가|적립금)\s*[:：]\s*/i,
      "",
    ).trim()
    if (next === text) break
    text = next
  }
  return text
}

export function isGenericCafe24ProductName(name: string | null | undefined): boolean {
  const cleaned = cleanCafe24ProductName(name)
  const folded = cleaned.toLowerCase().replace(/[\s:：_-]+/g, "")
  return folded === "" || folded === "상품명" || folded === "productname" || folded === "name"
}

export interface Cafe24DetailFallbacks {
  name: string | null
  price: number | null
  originalPrice: number | null
  salePrice: number | null
  priceFormatted: string | null
  sourceCurrency: Product["sourceCurrency"] | null
  sourcePrice: number | null
  descriptionFirstLine: string | null
}

export async function extractCafe24DetailFallbacks(page: Cafe24Page): Promise<Cafe24DetailFallbacks> {
  const raw = await page
    .evaluate(() => {
      /* eslint-disable no-var */
      var nameParts: string[] = []
      var nameSelectors = [
        ".xans-product-detail .heading h2",
        ".xans-product-detail .name",
        ".infoArea h2",
        ".prdName",
        ".product-name",
        "#titleArea h2",
        "h1",
        "meta[property='og:title']",
      ]
      for (var n = 0; n < nameSelectors.length; n++) {
        var nameEls = document.querySelectorAll(nameSelectors[n])
        for (var ni = 0; ni < nameEls.length; ni++) {
          var nameEl = nameEls[ni]
          var nameText = nameEl.tagName === "META"
            ? (nameEl.getAttribute("content") || "")
            : ((nameEl as HTMLElement).innerText || nameEl.textContent || "")
          nameText = nameText.replace(/\s+/g, " ").trim()
          if (nameText) nameParts.push(nameText)
        }
      }

      var priceText = ""
      var rowEls = document.querySelectorAll("tr, li, .xans-product-detaildesign, .infoArea, .price, [class*=price], [class*=Price]")
      for (var r = 0; r < rowEls.length; r++) {
        var rowText = (rowEls[r].textContent || "").replace(/\s+/g, " ").trim()
        if (!rowText) continue
        if (/할인판매가|판매가|price|KRW|₩|￦/i.test(rowText)) {
          priceText += " " + rowText
        }
      }

      var descFirstLine = ""
      var detailPriceText = ""
      var descEls = document.querySelectorAll(".cont_detail, #prdDetail, .product-detail, .xans-product-detaildesign, .detail_cont, #productDetail")
      for (var d = 0; d < descEls.length; d++) {
        var desc = ((descEls[d] as HTMLElement).innerText || descEls[d].textContent || "").trim()
        if (!desc) continue
        var lines = desc.split(/\n+/)
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].replace(/\s+/g, " ").trim()
          if (/할인판매가|판매가|price|KRW|₩|￦/i.test(line)) {
            detailPriceText += " " + line
          }
          if (line.length >= 4 && !/^KRW\b|^₩|^\d[\d,]+/.test(line)) {
            descFirstLine = line
            break
          }
        }
        if (descFirstLine) break
      }

      var metaPrice = ""
      var metaSalePrice = ""
      var metaCurrency = ""
      var priceMetaEl = document.querySelector("meta[property='product:price:amount'], meta[property='og:price:amount']")
      if (priceMetaEl) metaPrice = priceMetaEl.getAttribute("content") || ""
      var saleMetaEl = document.querySelector("meta[property='product:sale_price:amount'], meta[property='og:sale_price:amount']")
      if (saleMetaEl) metaSalePrice = saleMetaEl.getAttribute("content") || ""
      var currencyMetaEl = document.querySelector("meta[property='product:price:currency'], meta[property='og:price:currency']")
      if (currencyMetaEl) metaCurrency = currencyMetaEl.getAttribute("content") || ""

      var jsonLdPrice = ""
      var jsonLdCurrency = ""
      var jsonLdEls = document.querySelectorAll("script[type='application/ld+json']")
      for (var js = 0; js < jsonLdEls.length; js++) {
        try {
          var payload = JSON.parse(jsonLdEls[js].textContent || "null")
          var records = Array.isArray(payload) ? payload : [payload]
          for (var pr = 0; pr < records.length; pr++) {
            var record = records[pr]
            if (!record || typeof record !== "object") continue
            var offers = record.offers
            if (!offers) continue
            var offerList = Array.isArray(offers) ? offers : [offers]
            for (var ofi = 0; ofi < offerList.length; ofi++) {
              var offer = offerList[ofi]
              if (!offer || typeof offer !== "object") continue
              if (!jsonLdPrice && offer.price != null) jsonLdPrice = String(offer.price)
              if (!jsonLdCurrency && offer.priceCurrency != null) jsonLdCurrency = String(offer.priceCurrency)
              if (jsonLdPrice && jsonLdCurrency) break
            }
            if (jsonLdPrice && jsonLdCurrency) break
          }
          if (jsonLdPrice && jsonLdCurrency) break
        } catch {
          // ignore malformed JSON-LD blocks
        }
      }

      var html = document.documentElement.innerHTML
      var scriptProductPrice = ""
      var scriptSalePrice = ""
      var productPriceMatch = html.match(/var\s+product_price\s*=\s*['"]([^'"]+)['"]/)
      if (productPriceMatch && productPriceMatch[1]) scriptProductPrice = productPriceMatch[1]
      var salePriceMatch = html.match(/var\s+product_sale_price\s*=\s*['"]?(\d+(?:\.\d+)?)['"]?/)
      if (salePriceMatch && salePriceMatch[1]) scriptSalePrice = salePriceMatch[1]

      return {
        names: nameParts.slice(0, 10),
        priceText,
        metaPrice,
        metaSalePrice,
        metaCurrency,
        jsonLdPrice,
        jsonLdCurrency,
        scriptProductPrice,
        scriptSalePrice,
        detailPriceText,
        descFirstLine,
      }
      /* eslint-enable no-var */
    })
    .catch(() => ({
      names: [] as string[],
      priceText: "",
      metaPrice: "",
      metaSalePrice: "",
      metaCurrency: "",
      jsonLdPrice: "",
      jsonLdCurrency: "",
      scriptProductPrice: "",
      scriptSalePrice: "",
      detailPriceText: "",
      descFirstLine: "",
    }))

  const name = firstUsefulName([...raw.names, raw.descFirstLine])
  const sourceCurrency =
    normalizeCafe24Currency(raw.metaCurrency) ??
    normalizeCafe24Currency(raw.jsonLdCurrency) ??
    inferCafe24Currency(raw.priceText)
  const basePrice =
    parseCafe24PriceCandidate(raw.metaPrice, sourceCurrency) ??
    parseCafe24PriceCandidate(raw.jsonLdPrice, sourceCurrency) ??
    parseCafe24PriceCandidate(raw.scriptProductPrice, sourceCurrency) ??
    parseCafe24PriceCandidate(raw.priceText, sourceCurrency) ??
    parseCafe24PriceCandidate(raw.detailPriceText, sourceCurrency)
  const detailPriceValues = parseCafe24PriceCandidates(raw.detailPriceText, sourceCurrency)
  const detailSaleCandidate = detailPriceValues.length >= 2 ? Math.min(...detailPriceValues) : null
  const saleCandidate =
    parseCafe24PriceCandidate(raw.metaSalePrice, sourceCurrency) ??
    parseCafe24PriceCandidate(raw.scriptSalePrice, sourceCurrency) ??
    detailSaleCandidate
  const salePrice = saleCandidate !== null && basePrice !== null && saleCandidate > 0 && saleCandidate < basePrice
    ? saleCandidate
    : null
  const price = salePrice ?? basePrice
  const originalPrice = basePrice
  const formatted = price === null ? null : formatCafe24Price(price, sourceCurrency ?? "KRW")

  return {
    name,
    price,
    originalPrice,
    salePrice,
    priceFormatted: formatted,
    sourceCurrency,
    sourcePrice: price,
    descriptionFirstLine: firstUsefulName([raw.descFirstLine]),
  }
}

function firstUsefulName(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const name = cleanCafe24ProductName(candidate)
    if (name.length >= 3 && name.length <= 180 && !isGenericCafe24ProductName(name)) {
      return name
    }
  }
  return null
}

export function normalizeCafe24Currency(value: string | null | undefined): Product["sourceCurrency"] | null {
  const raw = (value ?? "").trim().toUpperCase()
  if (raw === "USD" || raw === "$" || raw === "&#36;") return "USD"
  if (raw === "EUR" || raw === "€" || raw === "&EURO;") return "EUR"
  if (raw === "GBP" || raw === "£" || raw === "&POUND;") return "GBP"
  if (raw === "KRW" || raw === "₩" || raw === "￦" || raw === "&#8361;" || raw === "\\UFFE6") return "KRW"
  return null
}

export function inferCafe24Currency(text: string): Product["sourceCurrency"] | null {
  const raw = text.replace(/&(?:#36|dollar);/gi, "$")
  if (/\bUSD\b|\$/i.test(raw)) return "USD"
  if (/\bEUR\b|€/i.test(raw)) return "EUR"
  if (/\bGBP\b|£/i.test(raw)) return "GBP"
  if (/\bKRW\b|₩|￦|\uFFE6/i.test(raw)) return "KRW"
  return null
}

export function parseCafe24PriceCandidate(
  text: string | number | null | undefined,
  currencyHint: Product["sourceCurrency"] | null = "KRW",
): number | null {
  if (!text) return null

  const clean = String(text)
    .replace(/,/g, "")
    .replace(/&#36;/gi, "$")
    .replace(/&pound;/gi, "£")
    .replace(/&euro;/gi, "€")
  const currency = currencyHint ?? inferCafe24Currency(clean) ?? "KRW"
  if (currency !== "KRW") {
    const codePattern = currency === "USD" ? /(?:USD|\$)\s*(\d+(?:\.\d+)?)/i
      : currency === "EUR" ? /(?:EUR|€)\s*(\d+(?:\.\d+)?)/i
        : /(?:GBP|£)\s*(\d+(?:\.\d+)?)/i
    const preferred =
      clean.match(codePattern) ??
      (currencyHint ? clean.match(/(\d+(?:\.\d+)?)/) : null)
    if (!preferred?.[1]) return null
    const price = Number(preferred[1])
    return Number.isFinite(price) && price > 0 ? price : null
  }

  const preferred =
    clean.match(/할인판매가\s*[:：]?\s*[₩￦]?\s*(\d{4,})/) ??
    clean.match(/판매가\s*[:：]?\s*[₩￦]?\s*(\d{4,})/) ??
    clean.match(/price\s*[:：]?\s*(?:KRW)?\s*[₩￦]?\s*(\d{4,})/i) ??
    clean.match(/[₩￦]\s*(\d{4,})/) ??
    clean.match(/KRW\s*(\d{4,})/i) ??
    (currencyHint ? clean.match(/^(\d{4,})(?:\.00)?$/) : null)

  if (!preferred?.[1]) return null
  const price = Number(preferred[1])
  return Number.isFinite(price) && price >= 1000 ? price : null
}

export function parseCafe24PriceCandidates(
  text: string | number | null | undefined,
  currencyHint: Product["sourceCurrency"] | null = "KRW",
): number[] {
  if (!text) return []

  const clean = String(text)
    .replace(/,/g, "")
    .replace(/&#36;/gi, "$")
    .replace(/&pound;/gi, "£")
    .replace(/&euro;/gi, "€")
  const currency = currencyHint ?? inferCafe24Currency(clean) ?? "KRW"
  const pattern = currency === "USD" ? /(?:USD|\$)\s*(\d+(?:\.\d+)?)/gi
    : currency === "EUR" ? /(?:EUR|€)\s*(\d+(?:\.\d+)?)/gi
      : currency === "GBP" ? /(?:GBP|£)\s*(\d+(?:\.\d+)?)/gi
        : /(?:할인판매가|판매가|price)?\s*[:：]?\s*(?:KRW)?\s*[₩￦]\s*(\d{4,})|(?:할인판매가|판매가|price)\s*[:：]?\s*(?:KRW)?\s*(\d{4,})/gi
  const values: number[] = []
  for (const match of clean.matchAll(pattern)) {
    const raw = match[1] ?? match[2]
    if (!raw) continue
    const price = Number(raw)
    if (Number.isFinite(price) && (currency === "KRW" ? price >= 1000 : price > 0)) {
      values.push(price)
    }
  }
  return values
}

function formatCafe24Price(price: number, currency: Product["sourceCurrency"]): string {
  if (currency === "USD") return `$${price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
  if (currency === "EUR") return `€${price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
  if (currency === "GBP") return `£${price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
  return `₩${price.toLocaleString("ko-KR")}`
}

export function applyCafe24DetailFallbacks(
  product: Product,
  detailFallbacks: Cafe24DetailFallbacks,
): void {
  if (isGenericCafe24ProductName(product.name) && detailFallbacks.name) {
    product.name = detailFallbacks.name
  }

  if (product.price === null && detailFallbacks.price !== null) {
    product.price = detailFallbacks.price
    product.originalPrice = product.originalPrice ?? detailFallbacks.originalPrice ?? detailFallbacks.price
    product.salePrice = detailFallbacks.salePrice
    product.priceFormatted = detailFallbacks.priceFormatted ?? product.priceFormatted
  }
  if (detailFallbacks.sourceCurrency) {
    product.sourceCurrency = detailFallbacks.sourceCurrency
    product.sourcePrice = detailFallbacks.sourcePrice ?? detailFallbacks.price ?? undefined
  }

}

export interface Cafe24QualityAssessment {
  passed: boolean
  reasons: string[]
  metrics: {
    total: number
    generic_name_count: number
    generic_name_rate: number
    price_missing_count: number
    price_missing_rate: number
    image_missing_count: number
    image_missing_rate: number
    brand_contamination_count: number
    brand_contamination_rate: number
  }
}

export interface Cafe24UsablePriceFilter {
  products: Product[]
  dropped: Product[]
}

const KNOWN_EXTERNAL_BRAND_PREFIXES = [
  "adidas",
  "asics",
  "birkenstock",
  "keen",
  "hoka",
  "merrell",
  "new balance",
  "nike",
  "norda",
  "on",
  "reebok",
  "roa",
  "salomon",
  "teva",
  "vans",
]

export function assessCafe24ProductQuality(
  products: Product[],
  config: Pick<SiteConfig, "brand" | "name" | "type">,
): Cafe24QualityAssessment {
  const total = products.length
  const genericNameCount = products.filter((p) => isGenericCafe24ProductName(p.name)).length
  const priceMissingCount = products.filter((p) => typeof p.price !== "number").length
  const imageMissingCount = products.filter((p) => typeof p.imageUrl !== "string" || !p.imageUrl.trim()).length
  const brandContaminationCount = products.filter((p) => looksLikeExternalBrandProduct(p, config)).length
  const pct = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 10000) / 100)

  const metrics = {
    total,
    generic_name_count: genericNameCount,
    generic_name_rate: pct(genericNameCount),
    price_missing_count: priceMissingCount,
    price_missing_rate: pct(priceMissingCount),
    image_missing_count: imageMissingCount,
    image_missing_rate: pct(imageMissingCount),
    brand_contamination_count: brandContaminationCount,
    brand_contamination_rate: pct(brandContaminationCount),
  }

  const reasons: string[] = []
  if (total === 0) reasons.push("no_products")
  if (metrics.generic_name_rate > 5) reasons.push(`generic_name_rate=${metrics.generic_name_rate}`)
  if (metrics.price_missing_rate > 50) reasons.push(`price_missing_rate=${metrics.price_missing_rate}`)
  if (metrics.image_missing_rate > 20) reasons.push(`image_missing_rate=${metrics.image_missing_rate}`)
  if (metrics.brand_contamination_rate > 20) {
    reasons.push(`brand_contamination_rate=${metrics.brand_contamination_rate}`)
  }

  return {passed: reasons.length === 0, reasons, metrics}
}

export function filterCafe24ProductsWithUsablePrice(products: Product[]): Cafe24UsablePriceFilter {
  const kept: Product[] = []
  const dropped: Product[] = []

  for (const product of products) {
    if (typeof product.price === "number" && Number.isFinite(product.price) && product.price > 0) {
      kept.push(product)
    } else {
      dropped.push(product)
    }
  }

  return {products: kept, dropped}
}

function looksLikeExternalBrandProduct(
  product: Product,
  config: Pick<SiteConfig, "brand" | "name" | "type">,
): boolean {
  if (!config.brand) return false
  const brand = config.brand.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const name = (typeof product.name === "string" ? product.name : "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (!brand || !name) return false
  if (name.startsWith(`${brand} `)) return false
  return KNOWN_EXTERNAL_BRAND_PREFIXES.some((prefix) => name.startsWith(`${prefix} `))
}
