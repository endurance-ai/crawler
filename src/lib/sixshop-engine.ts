/**
 * Sixshop listing engine.
 *
 * Sixshop pages render skeleton cards first, then call either the legacy
 * `/apis/mall/shop/products-catalog` endpoint or the Storefront v2 gateway.
 * We discover catalog widgets from storefront navigation and paginate their
 * JSON responses. Legacy requests reuse only the in-memory session token that
 * the page issued; it is never logged or persisted. This preserves exact
 * regular/sale prices and stock without scraping rendered text.
 */

import {chromium, type Page, type Response} from "playwright"

import {CURRENCY_SYMBOL} from "./fx"
import {normalizeObservedPricing} from "./product-pricing"
import {checkRobots} from "./robots-check"
import type {CrawlResult, CurrencyCode, Product, SiteConfig} from "./types"

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const NAV_TIMEOUT_MS = 30_000
const DISCOVERY_SETTLE_MS = 1_800
const DISCOVERY_MAX_PAGES = 40

export interface SixshopCatalogProduct {
  id?: number
  name?: string
  address?: string
  soldOut?: boolean
  thumbnails?: string[]
  price?: {
    regularPrice?: number
    currency?: string
    groupByGradeId?: Record<string, {salesPrice?: number; alternativeMsg?: string | null}>
  }
}

interface SixshopCatalogResponse {
  content?: SixshopCatalogProduct[]
  totalPages?: number
  totalElements?: number
  number?: number
}

export interface SixshopV2CatalogProduct {
  name?: string
  slug?: string
  images?: Array<{url?: string}>
  price?: {original?: number; sale?: number}
  availability?: string
  isOutOfStock?: boolean
  managementCode?: string
}

interface SixshopV2CatalogResponse {
  data?: SixshopV2CatalogProduct[]
  pageable?: {totalPages?: number; hasNextPage?: boolean; nextPage?: number | null}
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function currency(value: string | undefined, fallback: CurrencyCode): CurrencyCode {
  return /^[A-Z]{3}$/.test(value ?? "") ? (value as CurrencyCode) : fallback
}

export function parseSixshopCatalogProduct(
  row: SixshopCatalogProduct,
  config: Pick<
    SiteConfig,
    "key" | "name" | "brand" | "defaultGender" | "defaultCategory" | "sourceCurrency" | "baseUrl" | "sixshopProductPath"
  >,
): Product | null {
  const name = row.name?.trim() ?? ""
  const address = row.address?.trim() ?? ""
  const regularPrice = positive(row.price?.regularPrice)
  if (!name || !address || regularPrice === null) return null

  const gradePrice = positive(
    row.price?.groupByGradeId?.["-2"]?.salesPrice ??
      row.price?.groupByGradeId?.["-1"]?.salesPrice,
  )
  const salePrice = gradePrice !== null && gradePrice < regularPrice ? gradePrice : null
  const observedCurrency = currency(row.price?.currency, config.sourceCurrency ?? "KRW")
  const pricing = normalizeObservedPricing({
    currentPrice: salePrice ?? regularPrice,
    originalPrice: regularPrice,
    salePrice,
    state: salePrice === null ? "regular" : "sale",
    source: "api",
  })
  const thumbnail = row.thumbnails?.find((value) => typeof value === "string" && value.trim()) ?? ""
  const imageUrl = thumbnail
    ? new URL(thumbnail, thumbnail.startsWith("/uploadedFiles/") ? "https://contents.sixshop.com" : config.baseUrl).toString()
    : ""
  const productPath = config.sixshopProductPath ?? "product"

  return {
    brand: config.brand ?? config.name,
    name,
    gender: [...(config.defaultGender ?? [])],
    genderSource: "config_default",
    category: config.defaultCategory ?? "",
    ...pricing,
    priceFormatted: observedCurrency === "KRW"
      ? `₩${pricing.price!.toLocaleString("ko-KR")}`
      : `${CURRENCY_SYMBOL[observedCurrency] ?? observedCurrency}${pricing.price!.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
    imageUrl,
    images: imageUrl ? [imageUrl] : undefined,
    productUrl: new URL(`/${productPath}/${address}`, config.baseUrl).toString(),
    inStock: row.soldOut !== true,
    platform: config.key,
    crawledAt: new Date().toISOString(),
    productCode: row.id === undefined ? undefined : String(row.id),
    sourceCurrency: observedCurrency,
    sourcePrice: pricing.price ?? undefined,
  }
}

export function parseSixshopV2CatalogProduct(
  row: SixshopV2CatalogProduct,
  config: Pick<
    SiteConfig,
    "key" | "name" | "brand" | "defaultGender" | "defaultCategory" | "sourceCurrency" | "baseUrl"
  >,
): Product | null {
  const name = row.name?.trim() ?? ""
  const slug = row.slug?.trim() ?? ""
  const regularPrice = positive(row.price?.original)
  const currentPrice = positive(row.price?.sale) ?? regularPrice
  if (!name || !slug || regularPrice === null || currentPrice === null) return null
  const salePrice = currentPrice < regularPrice ? currentPrice : null
  const sourceCurrency = config.sourceCurrency ?? "KRW"
  const pricing = normalizeObservedPricing({
    currentPrice,
    originalPrice: regularPrice,
    salePrice,
    state: salePrice === null ? "regular" : "sale",
    source: "api",
  })
  const images = (row.images ?? []).map((image) => image.url?.trim() ?? "").filter(Boolean)
  return {
    brand: config.brand ?? config.name,
    name,
    gender: [...(config.defaultGender ?? [])],
    genderSource: "config_default",
    category: config.defaultCategory ?? "",
    ...pricing,
    priceFormatted: sourceCurrency === "KRW"
      ? `₩${pricing.price!.toLocaleString("ko-KR")}`
      : `${CURRENCY_SYMBOL[sourceCurrency] ?? sourceCurrency}${pricing.price!.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
    imageUrl: images[0] ?? "",
    images,
    productUrl: new URL(`/products/${slug}`, config.baseUrl).toString(),
    inStock: row.isOutOfStock !== true && row.availability !== "out-of-stock",
    platform: config.key,
    crawledAt: new Date().toISOString(),
    productCode: row.managementCode,
    sourceCurrency,
    sourcePrice: pricing.price ?? undefined,
  }
}

function shouldVisit(rawUrl: string, origin: string): boolean {
  try {
    const url = new URL(rawUrl, origin)
    if (url.origin !== origin || url.search || url.hash) return false
    const path = url.pathname.replace(/\/$/, "")
    if (!path || /^\/(?:products?|login|logout|join|member|cart|mypage|board|review|notice|qna|privacy|policy|terms)(?:\/|$)/i.test(path)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function navigationCandidates(page: Page, config: SiteConfig): Promise<string[]> {
  if (config.categoryUrls?.length) return config.categoryUrls
  await page.goto(config.baseUrl, {waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS})
  const origin = new URL(config.baseUrl).origin
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
  )
  return [...new Set(hrefs.filter((href) => shouldVisit(href, origin)))].slice(0, DISCOVERY_MAX_PAGES)
}

interface DiscoveredCatalog {
  url: string
  referer: string
  authorization?: string
}

async function discoverCatalogUrls(page: Page, config: SiteConfig): Promise<DiscoveredCatalog[]> {
  const found = new Map<string, Omit<DiscoveredCatalog, "url">>()
  const listener = async (response: Response): Promise<void> => {
    const url = response.url()
    if (!url.includes("/apis/mall/shop/products-catalog") && !url.includes("/website/guest/catalogs")) return
    const request = response.request()
    const metadata = {
      referer: request.headers().referer ?? page.url(),
      authorization: await request.headerValue("authorization") ?? undefined,
    }
    if (url.includes("/website/guest/catalogs")) {
      const normalized = new URL(url)
      normalized.searchParams.set("page", "1")
      normalized.searchParams.set("limit", "50")
      found.set(normalized.toString(), metadata)
    } else {
      found.set(url, metadata)
    }
  }
  page.on("response", listener)
  try {
    const candidates = await navigationCandidates(page, config)
    for (const url of [config.baseUrl, ...candidates]) {
      try {
        await page.goto(url, {waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS})
        await page.waitForTimeout(DISCOVERY_SETTLE_MS)
      } catch {
        continue
      }
    }
  } finally {
    page.off("response", listener)
  }
  return [...found].map(([url, metadata]) => ({url, ...metadata}))
}

async function loadCatalog(
  page: Page,
  catalogUrl: string,
  maxPages: number,
  storefrontUrl: string,
  referer: string,
  authorization?: string,
): Promise<SixshopCatalogProduct[]> {
  const products: SixshopCatalogProduct[] = []
  const v2 = catalogUrl.includes("/website/guest/catalogs")
  if (!v2) await page.goto(referer, {waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS})
  for (let pageNo = 0; pageNo < maxPages; pageNo++) {
    const requestUrl = v2
      ? (() => {
          const url = new URL(catalogUrl)
          url.searchParams.set("page", String(pageNo + 1))
          return url.toString()
        })()
      : /([?&]page=)\d+/.test(catalogUrl)
        ? catalogUrl.replace(/([?&]page=)\d+/, `$1${pageNo}`)
        : `${catalogUrl}${catalogUrl.includes("?") ? "&" : "?"}page=${pageNo}`
    const storefront = new URL(storefrontUrl)
    const result = v2
      ? await (async () => {
          const response = await page.context().request.get(requestUrl, {
            timeout: NAV_TIMEOUT_MS,
            headers: {Origin: storefront.origin, Referer: `${storefront.origin}/`, originurl: storefront.hostname},
          })
          return {ok: response.ok(), status: response.status(), body: await response.json() as unknown}
        })()
      : await page.evaluate(async ({requestUrl, authorization}) => {
          const response = await fetch(requestUrl, {
            credentials: "same-origin",
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              ...(authorization ? {Authorization: authorization} : {}),
            },
          })
          const text = await response.text()
          return {
            ok: response.ok,
            status: response.status,
            body: text ? JSON.parse(text) as unknown : {content: []},
          }
        }, {requestUrl, authorization})
    if (!result.ok) throw new Error(`catalog HTTP ${result.status}: ${requestUrl}`)
    if (v2) {
      const body = result.body as SixshopV2CatalogResponse
      products.push(...((body.data ?? []) as unknown as SixshopCatalogProduct[]))
      const totalPages = Math.max(1, Number(body.pageable?.totalPages ?? 1))
      if (pageNo + 1 >= totalPages || (body.data ?? []).length === 0) break
    } else {
      const body = result.body as SixshopCatalogResponse
      products.push(...(body.content ?? []))
      const totalPages = Math.max(1, Number(body.totalPages ?? 1))
      if (pageNo + 1 >= totalPages || (body.content ?? []).length === 0) break
    }
  }
  return products
}

export async function crawlSixshop(config: SiteConfig): Promise<CrawlResult> {
  const startedAt = Date.now()
  const errors: string[] = []
  const products: Product[] = []
  const robots = await checkRobots(config.baseUrl)
  if (!robots.allowed) {
    return {
      platform: config.key,
      products: [],
      stats: {totalProducts: 0, inStock: 0, outOfStock: 0, uniqueBrands: 0, avgPrice: 0, duration: Date.now() - startedAt},
      errors: [`[robots-block] ${robots.blockingLine ?? "robots.txt"}`],
    }
  }

  const browser = await chromium.launch({headless: true})
  try {
    const context = await browser.newContext({userAgent: USER_AGENT})
    const page = await context.newPage()
    const catalogUrls = await discoverCatalogUrls(page, config)
    if (catalogUrls.length === 0) errors.push("no Sixshop catalogs discovered")
    const seen = new Set<string>()
    for (const catalog of catalogUrls) {
      try {
        for (const row of await loadCatalog(
          page,
          catalog.url,
          config.maxPages ?? 100,
          config.baseUrl,
          catalog.referer,
          catalog.authorization,
        )) {
          const v2 = catalog.url.includes("/website/guest/catalogs")
          const v2Row = row as unknown as SixshopV2CatalogProduct
          const key = v2 ? v2Row.slug ?? "" : row.address ?? String(row.id ?? "")
          if (!key || seen.has(key)) continue
          seen.add(key)
          const product = v2
            ? parseSixshopV2CatalogProduct(v2Row, config)
            : parseSixshopCatalogProduct(row, config)
          if (product) products.push(product)
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    await context.close()
  } finally {
    await browser.close()
  }

  const inStock = products.filter((product) => product.inStock).length
  const priced = products.filter((product) => product.price !== null)
  return {
    platform: config.key,
    products,
    stats: {
      totalProducts: products.length,
      inStock,
      outOfStock: products.length - inStock,
      uniqueBrands: new Set(products.map((product) => product.brand)).size,
      avgPrice: priced.length
        ? Math.round(priced.reduce((sum, product) => sum + (product.price ?? 0), 0) / priced.length)
        : 0,
      duration: Date.now() - startedAt,
    },
    errors,
  }
}
