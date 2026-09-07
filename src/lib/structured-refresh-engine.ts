/** Refresh existing product URLs for sources without a stable listing API. */

import {runAsyncPool} from "./async-pool"
import {CURRENCY_SYMBOL} from "./fx"
import {extractStructuredProduct} from "./parsers/structured-data"
import {checkRobots} from "./robots-check"
import type {CrawlResult, CurrencyCode, Product, SiteConfig} from "./types"

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

function configuredCurrency(value: string | null, fallback: CurrencyCode): CurrencyCode {
  return /^[A-Z]{3}$/.test(value ?? "") ? (value as CurrencyCode) : fallback
}

export async function crawlStructuredExisting(
  config: SiteConfig,
  productUrls: string[],
  concurrency = 8,
): Promise<CrawlResult> {
  const startedAt = Date.now()
  const products: Product[] = []
  const errors: string[] = []
  const unreachable: string[] = []
  const robots = await checkRobots(config.baseUrl)
  if (!robots.allowed) {
    return {
      platform: config.key,
      products,
      stats: {totalProducts: 0, inStock: 0, outOfStock: 0, uniqueBrands: 0, avgPrice: 0, duration: Date.now() - startedAt},
      errors: [`[robots-block] ${robots.blockingLine ?? "robots.txt"}`],
    }
  }

  await runAsyncPool(productUrls, concurrency, async (productUrl) => {
    try {
      const response = await fetch(productUrl, {
        headers: {"User-Agent": USER_AGENT, Accept: "text/html,*/*"},
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const structured = extractStructuredProduct(await response.text())
      if (!structured?.name || structured.price === null) throw new Error("product structured data missing")
      const sourceCurrency = configuredCurrency(structured.currency, config.sourceCurrency ?? "KRW")
      const imageUrl = structured.images[0] ?? ""
      products.push({
        brand: config.brand ?? structured.brand ?? config.name,
        name: structured.name,
        gender: [...(config.defaultGender ?? [])],
        genderSource: "config_default",
        category: config.defaultCategory ?? "",
        price: structured.price,
        originalPrice: null,
        salePrice: null,
        // A detail page's single current price does not prove regular-vs-sale.
        // Keep price writes disabled while still refreshing stock/last_seen.
        pricingObservation: {version: 2, state: "unknown", source: "detail"},
        priceFormatted: sourceCurrency === "KRW"
          ? `₩${structured.price.toLocaleString("ko-KR")}`
          : `${CURRENCY_SYMBOL[sourceCurrency] ?? sourceCurrency}${structured.price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        imageUrl,
        images: structured.images,
        productUrl,
        inStock: structured.inStock !== false,
        platform: config.key,
        crawledAt: new Date().toISOString(),
        productCode: structured.sku ?? undefined,
        sourceCurrency,
        sourcePrice: structured.price,
      })
    } catch (error) {
      unreachable.push(`${productUrl}: ${error instanceof Error ? error.message : error}`)
    }
  })

  const inStock = products.filter((product) => product.inStock).length
  return {
    platform: config.key,
    products,
    stats: {
      totalProducts: products.length,
      inStock,
      outOfStock: products.length - inStock,
      uniqueBrands: new Set(products.map((product) => product.brand)).size,
      avgPrice: products.length
        ? Math.round(products.reduce((sum, product) => sum + (product.price ?? 0), 0) / products.length)
        : 0,
      duration: Date.now() - startedAt,
    },
    errors,
    unreachable,
    qualityWarnings: ["existing_url_only", "price_state_unknown"],
  }
}
