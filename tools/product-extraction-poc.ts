#!/usr/bin/env npx tsx

import {createHash} from "crypto"
import {promises as fs} from "fs"
import * as path from "path"
import {fileURLToPath} from "url"
import OpenAI from "openai"
import {chromium, type Page} from "playwright"
import {z} from "zod"
import {getSiteConfig} from "../src/configs/platforms"
import {crawlCafe24} from "../src/lib/cafe24-engine"
import {crawlShopify} from "../src/lib/shopify-engine"
import {getDetailParser} from "../src/lib/parsers/detail"
import type {CrawlResult, Product, SiteConfig} from "../src/lib/types"

type Variant = "existing" | "firecrawl" | "llm-scraper"

const DEFAULT_BRANDS = ["shopamomento", "pottery", "hamsaseyo", "rollingstudios", "becay"]
const DEFAULT_VARIANTS: Variant[] = ["existing", "firecrawl", "llm-scraper"]
const CRAWLER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REQUIRED_FIELDS = ["product_key", "name", "price", "currency", "image_url", "product_url", "in_stock"] as const
const LOW_CONFIDENCE_THRESHOLD = 0.7

const HARD_LIMITS = {
  maxBrands: 5,
  maxProductsPerBrand: 10,
  maxDetailPages: 50,
  maxFirecrawlPages: 150,
  maxLlmCalls: 50,
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

interface CliOptions {
  brands: string[]
  variants: Variant[]
  limit: number
  outRoot: string
  runId: string
  strictFirecrawlUrls: boolean
  allowExistingUrlFallback: boolean
  help: boolean
}

interface TokenUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

interface PocProduct {
  product_key: string
  name: string | null
  price: number | null
  currency: string | null
  image_url: string | null
  product_url: string | null
  in_stock: boolean | null
  raw_category: string | null
  category: string | null
  subcategory: string | null
  gender: string[] | null
  raw_color: string | null
  color: string | null
  description: string | null
  variant: Variant
  brand_key: string
  source_url: string
  confidence: number | null
  elapsed_ms: number
  estimated_cost: number | null
  error: string | null
  audit?: Record<string, unknown>
}

interface SelectedUrl {
  url: string
  source: "firecrawl_map" | "existing_fallback" | "existing_seed"
}

interface RuntimeStats {
  discoveredProductUrls: number
  selectedProductUrls: number
  requests: number
  blockedPages: number
  elapsedMs: number
  estimatedCost: number | null
  tokenUsage: TokenUsage
  firecrawlCreditsBefore: number | null
  firecrawlCreditsAfter: number | null
  firecrawlCreditsUsed: number | null
  llmAdapter: string | null
  jsonValidationFailures: number
  errors: string[]
}

type RuntimeStatsByBrand = Record<string, Record<Variant, RuntimeStats>>

const ExtractedProductSchema = z.object({
  name: z.string().nullable().optional(),
  price: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  product_url: z.string().nullable().optional(),
  in_stock: z.boolean().nullable().optional(),
  raw_category: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  gender: z.union([z.array(z.string()), z.string()]).nullable().optional(),
  raw_color: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
}).passthrough()

type ExtractedProduct = z.infer<typeof ExtractedProductSchema>

const NativeLlmProductSchema = z.object({
  name: z.string().nullable().describe("Product name only, without boilerplate"),
  price: z.union([z.number(), z.string()]).nullable().describe("Current product price"),
  currency: z.string().nullable().describe("ISO currency code, such as KRW, EUR, USD, GBP"),
  image_url: z.string().nullable().describe("Primary product image URL"),
  product_url: z.string().nullable().describe("Canonical product detail page URL"),
  in_stock: z.boolean().nullable().describe("Whether the product is purchasable now"),
  raw_category: z.string().nullable().describe("Category text as shown on the page"),
  category: z.string().nullable().describe("Canonical category: Outer, Top, Knitwear, Shirts, Bottom, Dress, Shoes, Bag, Accessories"),
  subcategory: z.string().nullable().describe("More specific product type when available"),
  gender: z.array(z.string()).nullable().describe("Audience labels, for example men, women, unisex"),
  raw_color: z.string().nullable().describe("Raw color option text as shown on the page"),
  color: z.string().nullable().describe("Normalized color name when available"),
  description: z.string().nullable().describe("Concise product description"),
  confidence: z.number().min(0).max(1).nullable().describe("Extraction confidence from 0 to 1"),
})

const PRODUCT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "price",
    "currency",
    "image_url",
    "product_url",
    "in_stock",
    "raw_category",
    "category",
    "subcategory",
    "gender",
    "raw_color",
    "color",
    "description",
    "confidence",
  ],
  properties: {
    name: {type: ["string", "null"]},
    price: {type: ["number", "string", "null"]},
    currency: {type: ["string", "null"], description: "ISO currency code such as KRW, EUR, USD, GBP"},
    image_url: {type: ["string", "null"]},
    product_url: {type: ["string", "null"]},
    in_stock: {type: ["boolean", "null"]},
    raw_category: {type: ["string", "null"]},
    category: {
      type: ["string", "null"],
      description: "Canonical category: Outer, Top, Knitwear, Shirts, Bottom, Dress, Shoes, Bag, Accessories",
    },
    subcategory: {type: ["string", "null"]},
    gender: {type: ["array", "null"], items: {type: "string"}},
    raw_color: {type: ["string", "null"]},
    color: {type: ["string", "null"]},
    description: {type: ["string", "null"]},
    confidence: {type: ["number", "null"], minimum: 0, maximum: 1},
  },
} as const

const EXTRACTION_SYSTEM = [
  "Extract exactly one fashion e-commerce product from the page.",
  "Return only JSON that matches the schema.",
  "Do not invent unavailable values; use null when the page does not show a field.",
  "Use ISO currency codes. Use canonical category names when possible.",
].join(" ")

function usage(): string {
  return `
3-way product extraction POC

Usage:
  pnpm poc:product-extraction
  pnpm poc:product-extraction -- --brands=shopamomento,becay --limit=5
  pnpm poc:product-extraction -- --variants=existing,firecrawl

Options:
  --brands=...                 Comma-separated brand keys. Default: ${DEFAULT_BRANDS.join(",")}
  --variants=...               existing,firecrawl,llm-scraper. Default: ${DEFAULT_VARIANTS.join(",")}
  --limit=N                    Products per brand. Hard-capped at ${HARD_LIMITS.maxProductsPerBrand}
  --out-root=DIR               Artifact root. Relative paths resolve under crawler/. Default: poc-runs
  --run-id=ID                  Run folder name. Default: timestamp
  --strict-firecrawl-urls      Do not top up Firecrawl URL samples from existing baseline URLs
  --no-existing-url-fallback   Same as --strict-firecrawl-urls
  --help                       Print this message

Required env for full default run:
  FIRECRAWL_API_KEY
  LLM_SCRAPER_MODEL
  OPENAI_API_KEY or ANTHROPIC_API_KEY

Optional cost env:
  FIRECRAWL_USD_PER_CREDIT
  LLM_SCRAPER_INPUT_USD_PER_1M
  LLM_SCRAPER_OUTPUT_USD_PER_1M

Native llm-scraper:
  If llm-scraper, ai, and the matching @ai-sdk provider are installed, the
  llm-scraper variant uses them. Otherwise it falls back to direct
  OpenAI/Anthropic structured extraction over the same Playwright page snapshot.
  Set LLM_SCRAPER_REQUIRE_NATIVE=true to fail instead of falling back.
`
}

function parseArgs(argv = process.argv.slice(2)): CliOptions {
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) continue
    const raw = arg.slice(2)
    const eq = raw.indexOf("=")
    if (eq >= 0) {
      flags[raw.slice(0, eq)] = raw.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      flags[raw] = next
      i++
    } else {
      flags[raw] = true
    }
  }

  const brands = splitList(stringFlag(flags, "brands") ?? DEFAULT_BRANDS.join(","))
  const variants = splitList(stringFlag(flags, "variants") ?? DEFAULT_VARIANTS.join(",")).map((v) => {
    if (!isVariant(v)) throw new Error(`Unknown variant: ${v}`)
    return v
  })
  const limit = Math.min(numberFlag(flags, "limit") ?? HARD_LIMITS.maxProductsPerBrand, HARD_LIMITS.maxProductsPerBrand)
  const strict = Boolean(flags["strict-firecrawl-urls"]) || Boolean(flags["no-existing-url-fallback"])

  return {
    brands,
    variants,
    limit,
    outRoot: stringFlag(flags, "out-root") ?? "poc-runs",
    runId: stringFlag(flags, "run-id") ?? timestampId(),
    strictFirecrawlUrls: strict,
    allowExistingUrlFallback: !strict,
    help: Boolean(flags.help),
  }
}

function stringFlag(flags: Record<string, string | boolean>, key: string): string | null {
  const value = flags[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberFlag(flags: Record<string, string | boolean>, key: string): number | null {
  const raw = stringFlag(flags, key)
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --${key}: ${raw}`)
  return Math.floor(n)
}

function splitList(value: string): string[] {
  return value.split(",").map((x) => x.trim()).filter(Boolean)
}

function isVariant(value: string): value is Variant {
  return value === "existing" || value === "firecrawl" || value === "llm-scraper"
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function assertHardLimits(options: CliOptions): void {
  if (options.brands.length > HARD_LIMITS.maxBrands) {
    throw new Error(`Brand count ${options.brands.length} exceeds hard limit ${HARD_LIMITS.maxBrands}`)
  }
  if (options.limit > HARD_LIMITS.maxProductsPerBrand) {
    throw new Error(`Limit ${options.limit} exceeds hard limit ${HARD_LIMITS.maxProductsPerBrand}`)
  }
  const detailPages = options.brands.length * options.limit
  if (detailPages > HARD_LIMITS.maxDetailPages) {
    throw new Error(`Detail extraction plan ${detailPages} exceeds hard limit ${HARD_LIMITS.maxDetailPages}`)
  }
  if (options.variants.includes("firecrawl")) {
    const firecrawlPages = options.brands.length * (1 + options.limit)
    if (firecrawlPages > HARD_LIMITS.maxFirecrawlPages) {
      throw new Error(`Firecrawl request plan ${firecrawlPages} exceeds hard limit ${HARD_LIMITS.maxFirecrawlPages}`)
    }
  }
  if (options.variants.includes("llm-scraper") && detailPages > HARD_LIMITS.maxLlmCalls) {
    throw new Error(`LLM call plan ${detailPages} exceeds hard limit ${HARD_LIMITS.maxLlmCalls}`)
  }
}

function resolveRunDir(options: CliOptions): string {
  const outRoot = path.isAbsolute(options.outRoot)
    ? options.outRoot
    : path.join(CRAWLER_ROOT, options.outRoot)
  return path.resolve(outRoot, options.runId)
}

function initialRuntimeStats(): RuntimeStats {
  return {
    discoveredProductUrls: 0,
    selectedProductUrls: 0,
    requests: 0,
    blockedPages: 0,
    elapsedMs: 0,
    estimatedCost: null,
    tokenUsage: {input_tokens: 0, output_tokens: 0, total_tokens: 0},
    firecrawlCreditsBefore: null,
    firecrawlCreditsAfter: null,
    firecrawlCreditsUsed: null,
    llmAdapter: null,
    jsonValidationFailures: 0,
    errors: [],
  }
}

function getRuntime(stats: RuntimeStatsByBrand, brandKey: string, variant: Variant): RuntimeStats {
  stats[brandKey] ??= {} as Record<Variant, RuntimeStats>
  stats[brandKey][variant] ??= initialRuntimeStats()
  return stats[brandKey][variant]
}

function clonePocConfig(config: SiteConfig, limit: number): SiteConfig {
  return {
    ...config,
    disabled: false,
    maxPages: Math.min(config.maxPages ?? 1, 1),
    crawlDelay: Math.min(config.crawlDelay ?? 300, 300),
    crawlReviews: false,
    crawlDetails: Boolean(config.crawlDetails),
    category: config.category ? {...config.category} : config.category,
  }
}

async function runExistingVariant(config: SiteConfig, limit: number, stats: RuntimeStats): Promise<Product[]> {
  const started = Date.now()
  let result: CrawlResult

  if (config.type === "shopify") {
    result = await crawlShopify(clonePocConfig(config, limit))
  } else if (config.type === "cafe24") {
    const browser = await chromium.launch({headless: true})
    try {
      const context = await browser.newContext({userAgent: USER_AGENT, locale: "ko-KR"})
      const page = await context.newPage()
      page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}))
      const detailParser = config.crawlDetails ? getDetailParser(config.key) : undefined
      result = await crawlCafe24(page, clonePocConfig(config, limit), detailParser, undefined, undefined, undefined, {
        sampleLimit: limit,
      })
      await context.close().catch(() => {})
    } finally {
      await browser.close().catch(() => {})
    }
  } else {
    throw new Error(`Existing POC only supports cafe24/shopify, got ${config.type}`)
  }

  const products = result.products.slice(0, limit)
  stats.discoveredProductUrls = result.stats.totalProducts
  stats.selectedProductUrls = products.length
  stats.requests += 1
  stats.elapsedMs += Date.now() - started
  stats.errors.push(...result.errors)
  stats.estimatedCost = 0
  return products
}

function existingProductToPoc(product: Product, config: SiteConfig, elapsedMs: number): PocProduct {
  const productUrl = absolutizeUrl(product.productUrl, config.baseUrl) ?? product.productUrl
  const currency = product.sourceCurrency ?? config.sourceCurrency ?? "KRW"
  const row: PocProduct = {
    product_key: stableProductKey(config.key, productUrl || product.productUrl || product.name),
    name: cleanString(product.name),
    price: product.price,
    currency,
    image_url: absolutizeUrl(product.imageUrl, productUrl || config.baseUrl),
    product_url: productUrl,
    in_stock: product.inStock,
    raw_category: cleanString(product.category),
    category: cleanString(product.category),
    subcategory: cleanString(product.subcategory),
    gender: product.gender.length > 0 ? product.gender : null,
    raw_color: cleanString(product.color),
    color: cleanString(product.color),
    description: cleanString(product.description),
    variant: "existing",
    brand_key: config.key,
    source_url: productUrl || product.productUrl || config.baseUrl,
    confidence: null,
    elapsed_ms: elapsedMs,
    estimated_cost: 0,
    error: null,
    audit: {
      platform: product.platform,
      productCode: product.productCode ?? null,
      sourceCurrency: product.sourceCurrency ?? null,
    },
  }
  row.confidence = fieldConfidence(row)
  return row
}

async function runFirecrawlVariant(
  config: SiteConfig,
  baselineProducts: Product[],
  options: CliOptions,
  stats: RuntimeStats,
): Promise<{rows: PocProduct[]; selectedUrls: SelectedUrl[]}> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    stats.errors.push("FIRECRAWL_API_KEY is not set")
    return {rows: [], selectedUrls: []}
  }

  const started = Date.now()
  const before = await getFirecrawlRemainingCredits(apiKey).catch((err: unknown) => {
    stats.errors.push(`credit_usage_before_failed: ${messageOf(err)}`)
    return null
  })
  stats.firecrawlCreditsBefore = before

  let mappedUrls: string[] = []
  try {
    mappedUrls = await firecrawlMapProductUrls(config, apiKey, options.limit)
    stats.requests += 1
  } catch (err) {
    stats.errors.push(`map_failed: ${messageOf(err)}`)
  }
  stats.discoveredProductUrls = mappedUrls.length

  const selected = selectFirecrawlUrls(config, mappedUrls, baselineProducts, options)
  stats.selectedProductUrls = selected.length

  const rows: PocProduct[] = []
  for (const selectedUrl of selected) {
    const scrapeStarted = Date.now()
    const elapsed = () => Date.now() - scrapeStarted
    try {
      const extracted = await firecrawlScrapeProduct(selectedUrl.url, apiKey)
      stats.requests += 1
      const row = extractionToPocProduct({
        variant: "firecrawl",
        brandKey: config.key,
        config,
        sourceUrl: selectedUrl.url,
        extracted,
        elapsedMs: elapsed(),
        estimatedCost: firecrawlRowCost(),
        error: null,
        audit: {urlSource: selectedUrl.source},
      })
      if (row.error?.includes("schema_validation_failed")) stats.jsonValidationFailures += 1
      rows.push(row)
    } catch (err) {
      stats.requests += 1
      stats.blockedPages += 1
      const row = errorPocProduct("firecrawl", config, selectedUrl.url, elapsed(), messageOf(err), {
        urlSource: selectedUrl.source,
      })
      rows.push(row)
    }
  }

  const after = await getFirecrawlRemainingCredits(apiKey).catch((err: unknown) => {
    stats.errors.push(`credit_usage_after_failed: ${messageOf(err)}`)
    return null
  })
  stats.firecrawlCreditsAfter = after
  stats.firecrawlCreditsUsed = before !== null && after !== null ? Math.max(0, before - after) : null
  stats.elapsedMs += Date.now() - started
  stats.estimatedCost = sumNullable(rows.map((r) => r.estimated_cost))
  return {rows, selectedUrls: selected}
}

function selectFirecrawlUrls(
  config: SiteConfig,
  mappedUrls: string[],
  baselineProducts: Product[],
  options: CliOptions,
): SelectedUrl[] {
  const selected: SelectedUrl[] = []
  const seen = new Set<string>()

  if (options.allowExistingUrlFallback && baselineProducts.length > 0) {
    for (const product of baselineProducts) {
      const canonical = canonicalProductUrl(product.productUrl)
      if (!canonical || seen.has(canonical)) continue
      if (!looksLikeProductUrl(canonical, config)) continue
      seen.add(canonical)
      selected.push({url: canonical, source: "existing_seed"})
      if (selected.length >= options.limit) return selected
    }
  }

  for (const url of mappedUrls) {
    const canonical = canonicalProductUrl(url)
    if (!canonical || seen.has(canonical)) continue
    seen.add(canonical)
    selected.push({url: canonical, source: "firecrawl_map"})
    if (selected.length >= options.limit) return selected
  }

  return selected
}

function firecrawlBaseUrl(): string {
  return (process.env.FIRECRAWL_API_BASE || "https://api.firecrawl.dev/v2").replace(/\/+$/, "")
}

async function firecrawlRequest<T>(apiKey: string, endpoint: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${firecrawlBaseUrl()}/${endpoint.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = {error: text}
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${extractError(body)}`)
  }
  return body as T
}

async function firecrawlMapProductUrls(config: SiteConfig, apiKey: string, limit: number): Promise<string[]> {
  const body = await firecrawlRequest<unknown>(apiKey, "map", {
    method: "POST",
    body: JSON.stringify({
      url: config.baseUrl,
      sitemap: "include",
      includeSubdomains: false,
      ignoreQueryParameters: false,
      ignoreCache: false,
      limit: Math.min(100, Math.max(40, limit * 8)),
      timeout: 60000,
    }),
  })
  const links = extractFirecrawlLinks(body)
  return links.filter((url) => looksLikeProductUrl(url, config)).map((url) => canonicalProductUrl(url)).filter(isString)
}

async function firecrawlScrapeProduct(url: string, apiKey: string): Promise<unknown> {
  const body = await firecrawlRequest<unknown>(apiKey, "scrape", {
    method: "POST",
    body: JSON.stringify({
      url,
      formats: [{type: "json", schema: PRODUCT_JSON_SCHEMA, prompt: EXTRACTION_SYSTEM}],
      onlyMainContent: true,
      waitFor: 1000,
      timeout: 60000,
      removeBase64Images: true,
      blockAds: true,
    }),
  })
  const json = extractFirecrawlJson(body)
  if (!json) throw new Error(`No JSON extraction in Firecrawl response: ${extractError(body)}`)
  return json
}

async function getFirecrawlRemainingCredits(apiKey: string): Promise<number | null> {
  const body = await firecrawlRequest<unknown>(apiKey, "team/credit-usage", {method: "GET"})
  const value = getPath(body, ["data", "remainingCredits"])
  return typeof value === "number" ? value : null
}

function extractFirecrawlLinks(body: unknown): string[] {
  const candidates = [
    getPath(body, ["links"]),
    getPath(body, ["data", "links"]),
  ]
  const links: string[] = []
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      if (typeof item === "string") links.push(item)
      else if (item && typeof item === "object" && typeof (item as {url?: unknown}).url === "string") {
        links.push((item as {url: string}).url)
      }
    }
  }
  return [...new Set(links)]
}

function extractFirecrawlJson(body: unknown): unknown {
  const candidates = [
    getPath(body, ["data", "json"]),
    getPath(body, ["data", "extract"]),
    getPath(body, ["data", "llm_extraction"]),
    getPath(body, ["data", "product"]),
    getPath(body, ["json"]),
    getPath(body, ["extract"]),
  ]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    if (typeof candidate === "string") {
      try {
        return parseJsonLoose(candidate)
      } catch {
        continue
      }
    }
    return candidate
  }
  return null
}

async function runLlmScraperVariant(
  config: SiteConfig,
  selectedUrls: SelectedUrl[],
  stats: RuntimeStats,
): Promise<PocProduct[]> {
  const model = process.env.LLM_SCRAPER_MODEL
  if (!model) {
    stats.errors.push("LLM_SCRAPER_MODEL is not set")
    return []
  }
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    stats.errors.push("OPENAI_API_KEY or ANTHROPIC_API_KEY is required")
    return []
  }

  const browser = await chromium.launch({headless: true})
  const rows: PocProduct[] = []
  try {
    const context = await browser.newContext({userAgent: USER_AGENT, locale: "ko-KR"})
    await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2}", (route) => route.abort())
    const page = await context.newPage()
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}))

    for (const selected of selectedUrls) {
      const started = Date.now()
      try {
        await page.goto(selected.url, {waitUntil: "domcontentloaded", timeout: 60000})
        await page.waitForTimeout(1200)
        const result = await extractWithLlmScraper(page, model)
        stats.requests += 1
        stats.llmAdapter ??= result.adapter
        addTokenUsage(stats.tokenUsage, result.usage)
        const row = extractionToPocProduct({
          variant: "llm-scraper",
          brandKey: config.key,
          config,
          sourceUrl: selected.url,
          extracted: result.data,
          elapsedMs: Date.now() - started,
          estimatedCost: estimateLlmCost(result.usage),
          error: null,
          audit: {urlSource: selected.source, adapter: result.adapter},
        })
        if (row.error?.includes("schema_validation_failed")) stats.jsonValidationFailures += 1
        rows.push(row)
      } catch (err) {
        stats.requests += 1
        stats.jsonValidationFailures += messageOf(err).includes("validation") ? 1 : 0
        rows.push(errorPocProduct("llm-scraper", config, selected.url, Date.now() - started, messageOf(err), {
          urlSource: selected.source,
        }))
      } finally {
        await page.goto("about:blank", {timeout: 5000}).catch(() => {})
      }
    }
    await context.close().catch(() => {})
  } finally {
    await browser.close().catch(() => {})
  }

  stats.selectedProductUrls = selectedUrls.length
  stats.discoveredProductUrls = selectedUrls.length
  stats.elapsedMs += rows.reduce((sum, row) => sum + row.elapsed_ms, 0)
  stats.estimatedCost = sumNullable(rows.map((r) => r.estimated_cost))
  return rows
}

interface LlmExtractionResult {
  data: unknown
  usage: TokenUsage
  adapter: string
}

interface PageSnapshot {
  url: string
  title: string
  canonical: string | null
  metaDescription: string | null
  text: string
  images: string[]
  jsonLd: unknown[]
}

async function extractWithLlmScraper(page: Page, model: string): Promise<LlmExtractionResult> {
  const native = await tryNativeLlmScraper(page, model)
  if (native) return native

  const snapshot = await readPageSnapshot(page)
  if (process.env.OPENAI_API_KEY) {
    return extractWithOpenAi(snapshot, model)
  }
  return extractWithAnthropic(snapshot, model)
}

let nativeUnavailable = false

async function tryNativeLlmScraper(page: Page, model: string): Promise<LlmExtractionResult | null> {
  if (nativeUnavailable || process.env.LLM_SCRAPER_FORCE_DIRECT === "true") return null
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>
    const llmScraperMod = await dynamicImport("llm-scraper")
    const aiMod = await dynamicImport("ai")
    const providerMod = process.env.OPENAI_API_KEY
      ? await dynamicImport("@ai-sdk/openai")
      : await dynamicImport("@ai-sdk/anthropic")

    const LLMScraper = (llmScraperMod.default ?? llmScraperMod.LLMScraper) as new (llm: unknown) => {
      run: (page: Page, output: unknown, options: {format: "html"}) => Promise<{data?: unknown; usage?: unknown}>
    }
    const Output = (aiMod.Output ?? aiMod.output) as {object: (args: {schema: typeof NativeLlmProductSchema}) => unknown}
    const providerFactory = process.env.OPENAI_API_KEY ? providerMod.openai : providerMod.anthropic
    if (typeof providerFactory !== "function") throw new Error("AI SDK provider factory not found")

    const scraper = new LLMScraper(providerFactory(model))
    const result = await scraper.run(page, Output.object({schema: NativeLlmProductSchema}), {format: "html"})
    return {
      data: result.data,
      usage: normalizeUnknownUsage(result.usage),
      adapter: "llm-scraper",
    }
  } catch (err) {
    if (process.env.LLM_SCRAPER_REQUIRE_NATIVE === "true") throw err
    nativeUnavailable = true
    return null
  }
}

async function readPageSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null
    const metaDescription = document.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')?.content ?? null
    const images = Array.from(document.images)
      .map((img) => img.currentSrc || img.src || img.getAttribute("data-src") || "")
      .filter(Boolean)
      .slice(0, 30)
    const jsonLd = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))
      .map((script) => {
        try {
          return JSON.parse(script.textContent || "null")
        } catch {
          return null
        }
      })
      .filter((value) => value !== null)

    return {
      url: location.href,
      title: document.title || "",
      canonical,
      metaDescription,
      text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30000),
      images,
      jsonLd,
    }
  })
}

let openAiClient: OpenAI | null = null

async function extractWithOpenAi(snapshot: PageSnapshot, model: string): Promise<LlmExtractionResult> {
  openAiClient ??= new OpenAI({apiKey: process.env.OPENAI_API_KEY})
  const response = await openAiClient.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 1000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "product_extraction",
        schema: PRODUCT_JSON_SCHEMA,
        strict: false,
      },
    },
    messages: [
      {role: "system", content: EXTRACTION_SYSTEM},
      {role: "user", content: buildSnapshotPrompt(snapshot)},
    ],
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error("empty_openai_response")
  return {
    data: parseJsonLoose(content),
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    },
    adapter: "openai-direct",
  }
}

async function extractWithAnthropic(snapshot: PageSnapshot, model: string): Promise<LlmExtractionResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      temperature: 0,
      system: `${EXTRACTION_SYSTEM} Return only raw JSON. Schema: ${JSON.stringify(PRODUCT_JSON_SCHEMA)}`,
      messages: [{role: "user", content: buildSnapshotPrompt(snapshot)}],
    }),
  })
  const body = await res.json() as {
    content?: Array<{type?: string; text?: string}>
    usage?: {input_tokens?: number; output_tokens?: number}
    error?: {message?: string}
  }
  if (!res.ok) throw new Error(`anthropic_http_${res.status}: ${body.error?.message ?? "unknown error"}`)
  const text = body.content?.map((part) => part.text ?? "").join("\n").trim()
  if (!text) throw new Error("empty_anthropic_response")
  const input = body.usage?.input_tokens ?? 0
  const output = body.usage?.output_tokens ?? 0
  return {
    data: parseJsonLoose(text),
    usage: {input_tokens: input, output_tokens: output, total_tokens: input + output},
    adapter: "anthropic-direct",
  }
}

function buildSnapshotPrompt(snapshot: PageSnapshot): string {
  return JSON.stringify({
    instruction: "Extract the product represented by this product detail page.",
    page: snapshot,
  })
}

function extractionToPocProduct(args: {
  variant: Variant
  brandKey: string
  config: SiteConfig
  sourceUrl: string
  extracted: unknown
  elapsedMs: number
  estimatedCost: number | null
  error: string | null
  audit?: Record<string, unknown>
}): PocProduct {
  const parsed = ExtractedProductSchema.safeParse(args.extracted)
  const data: Partial<ExtractedProduct> = parsed.success ? parsed.data : {}
  const error = parsed.success ? args.error : appendError(args.error, `schema_validation_failed: ${parsed.error.message}`)

  const productUrl = absolutizeUrl(cleanString(data.product_url), args.sourceUrl) ?? args.sourceUrl
  const rawCategory = cleanString(data.raw_category) ?? cleanString(data.category)
  const rawColor = cleanString(data.raw_color) ?? cleanString(data.color)
  const price = coercePrice(data.price)
  const currency = normalizeCurrency(data.currency, args.config.sourceCurrency ?? inferCurrencyFromPrice(data.price) ?? "KRW")

  const row: PocProduct = {
    product_key: stableProductKey(args.brandKey, args.sourceUrl),
    name: cleanString(data.name),
    price,
    currency,
    image_url: absolutizeUrl(cleanString(data.image_url), productUrl),
    product_url: productUrl,
    in_stock: data.in_stock ?? null,
    raw_category: rawCategory,
    category: cleanString(data.category) ?? rawCategory,
    subcategory: cleanString(data.subcategory),
    gender: normalizeGender(data.gender),
    raw_color: rawColor,
    color: cleanString(data.color) ?? rawColor,
    description: cleanString(data.description),
    variant: args.variant,
    brand_key: args.brandKey,
    source_url: args.sourceUrl,
    confidence: clampConfidence(data.confidence) ?? null,
    elapsed_ms: args.elapsedMs,
    estimated_cost: args.estimatedCost,
    error,
    audit: args.audit,
  }

  row.confidence ??= fieldConfidence(row)
  return row
}

function errorPocProduct(
  variant: Variant,
  config: SiteConfig,
  sourceUrl: string,
  elapsedMs: number,
  error: string,
  audit?: Record<string, unknown>,
): PocProduct {
  return {
    product_key: stableProductKey(config.key, sourceUrl),
    name: null,
    price: null,
    currency: config.sourceCurrency ?? "KRW",
    image_url: null,
    product_url: sourceUrl,
    in_stock: null,
    raw_category: null,
    category: null,
    subcategory: null,
    gender: config.defaultGender ?? null,
    raw_color: null,
    color: null,
    description: null,
    variant,
    brand_key: config.key,
    source_url: sourceUrl,
    confidence: 0,
    elapsed_ms: elapsedMs,
    estimated_cost: variant === "firecrawl" ? firecrawlRowCost() : null,
    error,
    audit,
  }
}

function stableProductKey(brandKey: string, urlOrFallback: string): string {
  const canonical = canonicalProductUrl(urlOrFallback) ?? urlOrFallback
  const hash = createHash("sha1").update(canonical).digest("hex").slice(0, 12)
  return `${brandKey}:${hash}`
}

function canonicalProductUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const productNo = url.searchParams.get("product_no")
    const variant = url.searchParams.get("variant")
    const keep = new URLSearchParams()
    if (productNo) keep.set("product_no", productNo)
    if (variant) keep.set("variant", variant)
    url.hash = ""
    url.search = keep.toString()
    url.pathname = url.pathname.replace(/\/+$/, "")
    return url.toString()
  } catch {
    return raw.trim() || null
  }
}

function looksLikeProductUrl(raw: string, config: SiteConfig): boolean {
  try {
    const url = new URL(raw)
    const base = new URL(config.baseUrl)
    if (url.hostname !== base.hostname && !url.hostname.endsWith(`.${base.hostname}`)) return false
    const pathname = url.pathname.toLowerCase()
    if (config.type === "shopify") return /^\/products\/[^/]+/.test(pathname)
    return pathname.includes("/product/") || url.searchParams.has("product_no")
  } catch {
    return false
  }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.replace(/\s+/g, " ").trim()
  return cleaned.length > 0 ? cleaned : null
}

function coercePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const normalized = value.replace(/[^\d.,-]/g, "").replace(/,/g, "")
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeCurrency(value: unknown, fallback: string | null): string | null {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : ""
  if (["KRW", "USD", "EUR", "GBP", "JPY", "CNY"].includes(raw)) return raw
  if (raw.includes("EUR") || raw.includes("€")) return "EUR"
  if (raw.includes("USD") || raw.includes("$")) return "USD"
  if (raw.includes("GBP") || raw.includes("£")) return "GBP"
  if (raw.includes("KRW") || raw.includes("WON") || raw.includes("₩")) return "KRW"
  return fallback
}

function inferCurrencyFromPrice(value: unknown): string | null {
  if (typeof value !== "string") return null
  return normalizeCurrency(value, null)
}

function normalizeGender(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const result = value.map((x) => cleanString(x)).filter(isString)
    return result.length > 0 ? [...new Set(result)] : null
  }
  const single = cleanString(value)
  if (!single) return null
  return splitList(single).length > 1 ? splitList(single) : [single]
}

function absolutizeUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null
  try {
    return new URL(value, base).toString()
  } catch {
    return value
  }
}

function fieldConfidence(row: PocProduct): number {
  const filled = REQUIRED_FIELDS.filter((field) => hasRequiredField(row, field)).length
  return Number((filled / REQUIRED_FIELDS.length).toFixed(3))
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(1, value))
}

function hasRequiredField(row: PocProduct, field: (typeof REQUIRED_FIELDS)[number]): boolean {
  const value = row[field]
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return true
  return value !== null && value !== undefined
}

function firecrawlRowCost(): number | null {
  const rate = Number(process.env.FIRECRAWL_USD_PER_CREDIT)
  return Number.isFinite(rate) && rate >= 0 ? rate : null
}

function estimateLlmCost(usage: TokenUsage): number | null {
  const inputRate = Number(process.env.LLM_SCRAPER_INPUT_USD_PER_1M)
  const outputRate = Number(process.env.LLM_SCRAPER_OUTPUT_USD_PER_1M)
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null
  return (usage.input_tokens / 1_000_000) * inputRate + (usage.output_tokens / 1_000_000) * outputRate
}

function addTokenUsage(target: TokenUsage, next: TokenUsage): void {
  target.input_tokens += next.input_tokens
  target.output_tokens += next.output_tokens
  target.total_tokens += next.total_tokens
}

function normalizeUnknownUsage(value: unknown): TokenUsage {
  if (!value || typeof value !== "object") return {input_tokens: 0, output_tokens: 0, total_tokens: 0}
  const usage = value as Record<string, unknown>
  const input = numberValue(usage.inputTokens) ?? numberValue(usage.promptTokens) ?? numberValue(usage.input_tokens) ?? 0
  const output = numberValue(usage.outputTokens) ?? numberValue(usage.completionTokens) ?? numberValue(usage.output_tokens) ?? 0
  const total = numberValue(usage.totalTokens) ?? numberValue(usage.total_tokens) ?? input + output
  return {input_tokens: input, output_tokens: output, total_tokens: total}
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf("{")
    if (start < 0) throw new Error("json_parse_failed")
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === "\\") escaped = true
        else if (ch === "\"") inString = false
        continue
      }
      if (ch === "\"") inString = true
      else if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1))
      }
    }
    throw new Error("json_parse_failed")
  }
}

function getPath(value: unknown, pathParts: string[]): unknown {
  let current = value
  for (const part of pathParts) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function extractError(body: unknown): string {
  const candidates = [
    getPath(body, ["error"]),
    getPath(body, ["message"]),
    getPath(body, ["data", "error"]),
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate
  }
  try {
    return JSON.stringify(body).slice(0, 500)
  } catch {
    return String(body)
  }
}

function appendError(current: string | null, next: string): string {
  return current ? `${current}; ${next}` : next
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function sumNullable(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (nums.length === 0) return null
  return Number(nums.reduce((sum, value) => sum + value, 0).toFixed(6))
}

function buildSummary(options: CliOptions, rows: PocProduct[], stats: RuntimeStatsByBrand, runDir: string): unknown {
  const byBrand: Record<string, unknown> = {}
  for (const brandKey of options.brands) {
    byBrand[brandKey] = {
      variants: Object.fromEntries(options.variants.map((variant) => {
        const variantRows = rows.filter((row) => row.brand_key === brandKey && row.variant === variant)
        return [variant, buildVariantMetrics(variantRows, getRuntime(stats, brandKey, variant))]
      })),
    }
  }

  return {
    generated_at: new Date().toISOString(),
    run_dir: runDir,
    options: {
      brands: options.brands,
      variants: options.variants,
      limit: options.limit,
      strict_firecrawl_urls: options.strictFirecrawlUrls,
    },
    hard_limits: HARD_LIMITS,
    totals: {
      rows: rows.length,
      successful_rows: rows.filter((row) => !row.error).length,
      error_rows: rows.filter((row) => row.error).length,
      estimated_cost: sumNullable(rows.map((row) => row.estimated_cost)),
      llm_token_usage: totalTokenUsage(stats),
    },
    brands: byBrand,
  }
}

function buildVariantMetrics(rows: PocProduct[], runtime: RuntimeStats): unknown {
  const duplicateCount = rows.length - new Set(rows.map((row) => row.product_key)).size
  const successRows = rows.filter((row) => !row.error && REQUIRED_FIELDS.every((field) => hasRequiredField(row, field)))
  const fillRates = Object.fromEntries(REQUIRED_FIELDS.map((field) => [
    field,
    rows.length === 0 ? 0 : round(rows.filter((row) => hasRequiredField(row, field)).length / rows.length),
  ]))
  return {
    discovered_product_url_count: runtime.discoveredProductUrls,
    selected_product_url_count: runtime.selectedProductUrls,
    final_success_product_count: successRows.length,
    required_field_fill_rate: fillRates,
    low_confidence_or_held_ratio: rows.length === 0
      ? 0
      : round(rows.filter((row) => row.error || (row.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD).length / rows.length),
    duplicate_ratio: rows.length === 0 ? 0 : round(duplicateCount / rows.length),
    avg_elapsed_ms_per_product: rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.elapsed_ms, 0) / rows.length),
    elapsed_ms_total: runtime.elapsedMs,
    estimated_cost_total: runtime.estimatedCost ?? sumNullable(rows.map((row) => row.estimated_cost)),
    estimated_cost_per_product: rows.length === 0 ? null : nullableDivide(runtime.estimatedCost ?? sumNullable(rows.map((row) => row.estimated_cost)), rows.length),
    requests: runtime.requests,
    blocked_pages: runtime.blockedPages,
    firecrawl_credits_before: runtime.firecrawlCreditsBefore,
    firecrawl_credits_after: runtime.firecrawlCreditsAfter,
    firecrawl_credits_used: runtime.firecrawlCreditsUsed,
    llm_adapter: runtime.llmAdapter,
    llm_token_usage: runtime.tokenUsage,
    json_validation_failures: runtime.jsonValidationFailures,
    errors: runtime.errors,
  }
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function nullableDivide(value: number | null, divisor: number): number | null {
  return value === null ? null : Number((value / divisor).toFixed(6))
}

function totalTokenUsage(stats: RuntimeStatsByBrand): TokenUsage {
  const total: TokenUsage = {input_tokens: 0, output_tokens: 0, total_tokens: 0}
  for (const byVariant of Object.values(stats)) {
    for (const runtime of Object.values(byVariant)) {
      addTokenUsage(total, runtime.tokenUsage)
    }
  }
  return total
}

function buildDiffCsv(rows: PocProduct[]): string {
  const grouped = new Map<string, PocProduct[]>()
  for (const row of rows) {
    const key = `${row.brand_key}|${row.product_key}`
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  const headers = [
    "brand_key",
    "product_key",
    "product_url",
    "existing_name",
    "firecrawl_name",
    "llm_scraper_name",
    "existing_price",
    "firecrawl_price",
    "llm_scraper_price",
    "price_mismatch",
    "existing_stock",
    "firecrawl_stock",
    "llm_scraper_stock",
    "stock_mismatch",
    "existing_category",
    "firecrawl_category",
    "llm_scraper_category",
    "category_diff",
    "existing_subcategory",
    "firecrawl_subcategory",
    "llm_scraper_subcategory",
    "existing_color",
    "firecrawl_color",
    "llm_scraper_color",
    "color_diff",
    "existing_confidence",
    "firecrawl_confidence",
    "llm_scraper_confidence",
    "notes",
  ]

  const csvRows: unknown[][] = [headers]
  for (const group of grouped.values()) {
    const byVariant = Object.fromEntries(group.map((row) => [row.variant, row])) as Partial<Record<Variant, PocProduct>>
    const productUrl = firstString(group.map((row) => row.product_url)) ?? firstString(group.map((row) => row.source_url)) ?? ""
    const notes = [
      duplicateNote(group),
      ...group.filter((row) => row.error).map((row) => `${row.variant}: ${row.error}`),
    ].filter(Boolean).join(" | ")

    csvRows.push([
      group[0]?.brand_key ?? "",
      group[0]?.product_key ?? "",
      productUrl,
      byVariant.existing?.name ?? "",
      byVariant.firecrawl?.name ?? "",
      byVariant["llm-scraper"]?.name ?? "",
      byVariant.existing?.price ?? "",
      byVariant.firecrawl?.price ?? "",
      byVariant["llm-scraper"]?.price ?? "",
      mismatch([byVariant.existing?.price, byVariant.firecrawl?.price, byVariant["llm-scraper"]?.price], numericEqual),
      byVariant.existing?.in_stock ?? "",
      byVariant.firecrawl?.in_stock ?? "",
      byVariant["llm-scraper"]?.in_stock ?? "",
      mismatch([byVariant.existing?.in_stock, byVariant.firecrawl?.in_stock, byVariant["llm-scraper"]?.in_stock], strictEqual),
      byVariant.existing?.category ?? "",
      byVariant.firecrawl?.category ?? "",
      byVariant["llm-scraper"]?.category ?? "",
      mismatch([byVariant.existing?.category, byVariant.firecrawl?.category, byVariant["llm-scraper"]?.category], normalizedStringEqual),
      byVariant.existing?.subcategory ?? "",
      byVariant.firecrawl?.subcategory ?? "",
      byVariant["llm-scraper"]?.subcategory ?? "",
      byVariant.existing?.color ?? "",
      byVariant.firecrawl?.color ?? "",
      byVariant["llm-scraper"]?.color ?? "",
      mismatch([byVariant.existing?.color, byVariant.firecrawl?.color, byVariant["llm-scraper"]?.color], normalizedStringEqual),
      byVariant.existing?.confidence ?? "",
      byVariant.firecrawl?.confidence ?? "",
      byVariant["llm-scraper"]?.confidence ?? "",
      notes,
    ])
  }

  return csvRows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n"
}

function firstString(values: Array<string | null>): string | null {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null
}

function duplicateNote(group: PocProduct[]): string | null {
  const counts = new Map<Variant, number>()
  for (const row of group) counts.set(row.variant, (counts.get(row.variant) ?? 0) + 1)
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1)
  return duplicates.length > 0 ? `duplicate rows: ${duplicates.map(([variant, count]) => `${variant}=${count}`).join(";")}` : null
}

function mismatch<T>(values: Array<T | null | undefined>, equal: (a: T, b: T) => boolean): boolean {
  const present = values.filter((value): value is T => value !== null && value !== undefined && value !== "")
  if (present.length <= 1) return false
  const first = present[0]
  return present.some((value) => !equal(first, value))
}

function numericEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "number" || typeof b !== "number") return a === b
  return Math.abs(a - b) < 1
}

function strictEqual<T>(a: T, b: T): boolean {
  return a === b
}

function normalizedStringEqual(a: unknown, b: unknown): boolean {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text
}

async function writeArtifacts(runDir: string, rows: PocProduct[], summary: unknown): Promise<void> {
  await fs.mkdir(runDir, {recursive: true})
  await fs.writeFile(path.join(runDir, "products.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n")
  await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
  await fs.writeFile(path.join(runDir, "diff.csv"), buildDiffCsv(rows))
}

async function main(): Promise<void> {
  const options = parseArgs()
  if (options.help) {
    console.log(usage())
    return
  }

  assertHardLimits(options)
  const runDir = resolveRunDir(options)
  const stats: RuntimeStatsByBrand = {}
  const rows: PocProduct[] = []
  const firecrawlSelections = new Map<string, SelectedUrl[]>()
  const baselineProducts = new Map<string, Product[]>()

  console.log(`POC run: ${options.runId}`)
  console.log(`Brands: ${options.brands.join(", ")}`)
  console.log(`Variants: ${options.variants.join(", ")}`)
  console.log(`Output: ${runDir}`)

  for (const brandKey of options.brands) {
    const config = getSiteConfig(brandKey)
    if (!config) throw new Error(`Unknown brand key: ${brandKey}`)

    console.log(`\n[${brandKey}] starting`)
    let products = baselineProducts.get(brandKey) ?? []
    const needsExistingSeed =
      options.variants.includes("existing") ||
      (options.variants.includes("firecrawl") && options.allowExistingUrlFallback) ||
      (options.variants.includes("llm-scraper") && !options.variants.includes("firecrawl"))
    if (needsExistingSeed) {
      const runtime = getRuntime(stats, brandKey, "existing")
      try {
        products = await runExistingVariant(config, options.limit, runtime)
        baselineProducts.set(brandKey, products)
        const elapsedPerProduct = products.length > 0 ? Math.round(runtime.elapsedMs / products.length) : runtime.elapsedMs
        if (options.variants.includes("existing")) {
          rows.push(...products.map((product) => existingProductToPoc(product, config, elapsedPerProduct)))
        }
      } catch (err) {
        runtime.errors.push(messageOf(err))
        if (options.variants.includes("existing")) {
          rows.push(errorPocProduct("existing", config, config.baseUrl, runtime.elapsedMs, messageOf(err)))
        }
      }
    }

    if (options.variants.includes("firecrawl")) {
      const runtime = getRuntime(stats, brandKey, "firecrawl")
      const result = await runFirecrawlVariant(config, products, options, runtime)
      firecrawlSelections.set(brandKey, result.selectedUrls)
      rows.push(...result.rows)
    }

    if (options.variants.includes("llm-scraper")) {
      const selected = firecrawlSelections.get(brandKey)
        ?? products.slice(0, options.limit).map((product): SelectedUrl => ({url: product.productUrl, source: "existing_seed"}))
      const runtime = getRuntime(stats, brandKey, "llm-scraper")
      const llmRows = await runLlmScraperVariant(config, selected.slice(0, options.limit), runtime)
      rows.push(...llmRows)
    }
  }

  const summary = buildSummary(options, rows, stats, runDir)
  await writeArtifacts(runDir, rows, summary)
  console.log(`\nArtifacts written:`)
  console.log(`  ${path.join(runDir, "products.jsonl")}`)
  console.log(`  ${path.join(runDir, "summary.json")}`)
  console.log(`  ${path.join(runDir, "diff.csv")}`)
}

main().catch((err: unknown) => {
  console.error(messageOf(err))
  process.exitCode = 1
})
