#!/usr/bin/env npx tsx

import {promises as fs} from "fs"
import * as path from "path"
import {fileURLToPath} from "url"
import {Output, wrapLanguageModel} from "ai"
import LLMScraper from "llm-scraper"
import {chromium, type Page} from "playwright"
import {z} from "zod"
import {getSiteConfig} from "../src/configs/platforms"
import {crawlCafe24} from "../src/lib/cafe24-engine"
import {crawlCafe24WithLightpanda} from "../src/lib/cafe24-lightpanda"
import {cafe24DetailConcurrency, parseCafe24EngineMode} from "../src/lib/cafe24-engine-selection"
import {crawlShopify} from "../src/lib/shopify-engine"
import {CATEGORIES, buildSubcategoryReference, isValidCategory, isValidSubcategory} from "../src/lib/enums/product-enums"
import {getDetailParser} from "../src/lib/parsers/detail"
import {genderFieldsToPoc} from "../src/lib/onboard-gender-transport"
import {pricingFieldsToPoc} from "../src/lib/onboard-pricing-transport"
import {crawlerFieldsToPoc, type PocCrawlerMetadata} from "../src/lib/onboard-crawler-fields-transport"
import {buildQwenNormalizationPatch} from "../src/lib/product-qwen-normalization"
import {runWithQwen, type QwenAttemptContext} from "../src/lib/qwen-client"
import type {CrawlResult, Product, SiteConfig} from "../src/lib/types"

type Variant = "existing" | "firecrawl" | "llm-scraper" | "hybrid"
type ScrapeFormat = "markdown" | "html" | "raw_html"

const DEFAULT_BRANDS = ["shopamomento", "pottery", "hamsaseyo", "rollingstudios", "becay"]
const DEFAULT_VARIANTS: Variant[] = ["existing", "llm-scraper"]
const DEFAULT_FORMAT: ScrapeFormat = "markdown"
const DEFAULT_QWEN_MODEL = "qwen3-vl-30b-awq"
const CRAWLER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REQUIRED_FIELDS = ["product_key", "name", "price", "currency", "image_url", "product_url", "in_stock"] as const
// Graded separately: `existing` fills every REQUIRED_FIELD on 4/5 brands, so the
// real quality signal lives here (raw nav labels leaking into category, null colors).
const CLASSIFICATION_FIELDS = ["category", "subcategory", "color", "description"] as const
const LOW_CONFIDENCE_THRESHOLD = 0.7
// Existing crawler is list-page driven; crawl a wider pool so the eval set can be
// drawn from the intersection of what it finds and what the sitemap advertises.
const DEFAULT_POOL_LIMIT = 40

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
  poolLimit: number
  format: ScrapeFormat
  outRoot: string
  runId: string
  strictFirecrawlUrls: boolean
  allowExistingUrlFallback: boolean
  includeOutOfStock: boolean
  help: boolean
}

interface EvalUrl {
  url: string
  productId: string
  /** intersection = existing crawler + sitemap agree; sitemap_only / existing_only = single-source top-up */
  source: "intersection" | "sitemap_only" | "existing_only"
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
  original_price?: number | null
  sale_price?: number | null
  source_price?: number | null
  pricing_observation?: Product["pricingObservation"]
  crawler_metadata?: PocCrawlerMetadata
  currency: string | null
  image_url: string | null
  images?: string[] | null
  product_url: string | null
  in_stock: boolean | null
  raw_category: string | null
  category: string | null
  subcategory: string | null
  // 크롤러가 결의한 상품 단위 성별과 근거를 import까지 보존한다.
  gender?: string[] | null
  gender_source?: string | null
  tags?: string[] | null
  // llm-scraper / firecrawl 변종 전용 (전체 페이지 추출). existing/hybrid 는
  // 2026-07-29 부터 색상·설명을 만들지 않는다 — VLM(product_features) 이관.
  raw_color?: string | null
  color?: string | null
  description?: string | null
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

// Hybrid variant: existing crawler owns the transactional fields (name/price/stock/
// image) which it reads reliably; the LLM only classifies. This needs a tiny compact
// context (name + breadcrumb + description snippet), not the whole page markdown.
// 2026-07-29 — color/description/gender 제거. color/gender 는 VLM
// (product_features)이 단일 출처가 됐고 description 은 폐기됐다.
const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  subcategory: z.string().nullable(),
})

const CLASSIFY_SYSTEM = [
  "You classify one fashion product from the compact context provided (name, breadcrumb, metadata, description).",
  "Return only JSON matching the schema.",
  `category MUST be one of: ${CATEGORIES.join(", ")}.`,
  `subcategory MUST match the selected category or be null:\n${buildSubcategoryReference()}`,
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
  --include-out-of-stock       Keep sold-out products and crawl their detail pages (recollection)
  --help                       Print this message

Required env for full default run:
  FIRECRAWL_API_KEY

Optional model env:
  QWEN_MODEL                   Default: ${DEFAULT_QWEN_MODEL}

Optional cost env:
  FIRECRAWL_USD_PER_CREDIT
  LLM_SCRAPER_INPUT_USD_PER_1M
  LLM_SCRAPER_OUTPUT_USD_PER_1M

Native llm-scraper uses the local Qwen OpenAI-compatible endpoints configured
by QWEN_BASE_URLS. There is no paid-provider fallback.
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
  const requestedLimit = numberFlag(flags, "limit") ?? HARD_LIMITS.maxProductsPerBrand
  // Scale runs (POC_UNSAFE_SCALE) may exceed the per-brand sample cap for full-catalog crawls.
  const limit = process.env.POC_UNSAFE_SCALE === "1" ? requestedLimit : Math.min(requestedLimit, HARD_LIMITS.maxProductsPerBrand)
  const strict = Boolean(flags["strict-firecrawl-urls"]) || Boolean(flags["no-existing-url-fallback"])
  const format = stringFlag(flags, "format") ?? DEFAULT_FORMAT
  if (!isScrapeFormat(format)) throw new Error(`Unknown format: ${format}`)

  return {
    brands,
    variants,
    limit,
    poolLimit: Math.max(numberFlag(flags, "pool-limit") ?? DEFAULT_POOL_LIMIT, limit),
    format,
    outRoot: stringFlag(flags, "out-root") ?? "poc-runs",
    runId: stringFlag(flags, "run-id") ?? timestampId(),
    strictFirecrawlUrls: strict,
    allowExistingUrlFallback: !strict,
    includeOutOfStock: Boolean(flags["include-out-of-stock"]),
    help: Boolean(flags.help),
  }
}

function isScrapeFormat(value: string): value is ScrapeFormat {
  return value === "markdown" || value === "html" || value === "raw_html"
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
  return value === "existing" || value === "firecrawl" || value === "llm-scraper" || value === "hybrid"
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function assertHardLimits(options: CliOptions): void {
  // Scale-validation escape hatch: the 100-brand end-to-end test intentionally
  // exceeds the per-run POC guard rails. Only bypasses count checks, not correctness.
  if (process.env.POC_UNSAFE_SCALE === "1") return
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

/**
 * POC 기본값은 "가볍게 한 페이지만" 이다 — 비교 실험용이라 카탈로그 전체를 받을
 * 이유가 없다. 다만 scale 런(POC_UNSAFE_SCALE=1, onboard-batch.sh 가 켠다)에서는
 * 이 클램프가 조용한 데이터 절단이 된다:
 *   - maxPages 1 → crawlShopify 가 /products.json?limit=250 을 한 번만 부른다.
 *     maxPages: 300 으로 등록된 브랜드도 250개에서 잘린다.
 *   - crawlDelay 300ms → Cloudflare 뒤에 있어 1500ms 를 선언한 브랜드(browns 등)를
 *     5배 빠르게 두드려 429 를 부른다.
 * --limit 캡이 이미 같은 env 로 풀리므로(위 parseCliOptions) 동일하게 맞춘다.
 */
function clonePocConfig(config: SiteConfig, limit: number): SiteConfig {
  const scaleRun = process.env.POC_UNSAFE_SCALE === "1"
  return {
    ...config,
    disabled: false,
    maxPages: scaleRun ? (config.maxPages ?? 1) : Math.min(config.maxPages ?? 1, 1),
    crawlDelay: scaleRun ? (config.crawlDelay ?? 300) : Math.min(config.crawlDelay ?? 300, 300),
    crawlReviews: false,
    crawlDetails: Boolean(config.crawlDetails),
    category: config.category ? {...config.category} : config.category,
  }
}

async function crawlCafe24Chromium(
  config: SiteConfig,
  limit: number,
  detailParser: ReturnType<typeof getDetailParser> | undefined,
  includeOutOfStock: boolean,
  enrichDetailPage?: (page: Page, product: Product) => Promise<void>,
): Promise<CrawlResult> {
  const browser = await chromium.launch({headless: true})
  try {
    const context = await browser.newContext({userAgent: USER_AGENT, locale: "ko-KR"})
    const page = await context.newPage()
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}))
    const result = await crawlCafe24(page, clonePocConfig(config, limit), detailParser, undefined, {
      sampleLimit: limit,
      detailConcurrency: cafe24DetailConcurrency(),
      includeOutOfStock,
      // Chromium detail-crawl pages are real Playwright Pages under the hood
      // (createPlaywrightDetailPageFactory) even though crawlCafe24's own
      // Cafe24Page type is narrower — safe to cast only on this branch.
      enrichDetailPage: enrichDetailPage
        ? (pg, product) => enrichDetailPage(pg as unknown as Page, product)
        : undefined,
    })
    await context.close().catch(() => {})
    return result
  } finally {
    await browser.close().catch(() => {})
  }
}

async function runExistingVariant(
  config: SiteConfig,
  limit: number,
  stats: RuntimeStats,
  includeOutOfStock: boolean,
  enrichDetailPage?: (page: Page, product: Product) => Promise<void>,
): Promise<Product[]> {
  const started = Date.now()
  let result: CrawlResult

  if (config.type === "shopify") {
    result = await crawlShopify(clonePocConfig(config, limit), {includeOutOfStock})
  } else if (config.type === "cafe24") {
    const detailParser = config.crawlDetails ? getDetailParser(config.key) : undefined
    const engine = parseCafe24EngineMode(process.env.CRAWLER_CAFE24_ENGINE)
    if (engine === "lightpanda" || engine === "auto") {
      // llm-scraper (LLMScraper.run) requires a real playwright.Page; Lightpanda's
      // Cafe24Page is backed by puppeteer-core, and Playwright cannot drive
      // Lightpanda at all -- page.goto/page.evaluate hang even on example.com
      // (.moai/plans/lightpanda-spike-report.md, 2026-07-07 spike). Fail loudly
      // instead of silently falling back to a broken enrichment pass.
      if (enrichDetailPage) {
        throw new Error(
          "hybrid variant is not supported on the Lightpanda engine — see .moai/plans/lightpanda-spike-report.md",
        )
      }
      // Lightpanda runs its own browser process. It does not honor sampleLimit —
      // it crawls the full catalog, sliced to `limit` below (fine for onboarding).
      // Per-brand Chromium fallback mirrors src/crawl.ts so a brand Lightpanda
      // cannot render is not silently dropped.
      try {
        // Detail fetch is the wall-clock bottleneck on large catalogs, so honor
        // CRAWLER_CAFE24_DETAIL_CONCURRENCY here the same way src/crawl.ts does.
        // Without this the pool silently stayed at the default 3 even when the
        // env var was set (2026-07-20 bulk onboarding).
        result = await crawlCafe24WithLightpanda(clonePocConfig(config, limit), detailParser, undefined, {
          detailConcurrency: cafe24DetailConcurrency(),
          includeOutOfStock,
        })
        if (result.stats.totalProducts === 0) throw new Error("Lightpanda returned 0 products")
      } catch (err) {
        console.warn(`⚠️ ${config.key} Lightpanda failed — Chromium fallback: ${(err as Error).message}`)
        result = await crawlCafe24Chromium(config, limit, detailParser, includeOutOfStock)
      }
    } else {
      result = await crawlCafe24Chromium(config, limit, detailParser, includeOutOfStock, enrichDetailPage)
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
  const imageUrl = absolutizeUrl(product.imageUrl, productUrl || config.baseUrl)
  const images = [...new Set(
    (product.images ?? [product.imageUrl])
      .map((url) => absolutizeUrl(url, productUrl || config.baseUrl))
      .filter((url): url is string => Boolean(url)),
  )]
  const row: PocProduct = {
    product_key: stableProductKey(config.key, productUrl || product.productUrl || product.name, config),
    name: cleanString(product.name),
    price: product.price,
    ...pricingFieldsToPoc(product),
    ...crawlerFieldsToPoc(product),
    currency,
    image_url: imageUrl,
    images: images.length > 0 ? images : null,
    product_url: productUrl,
    in_stock: product.inStock,
    raw_category: cleanString(product.category),
    category: cleanString(product.category),
    subcategory: cleanString(product.subcategory),
    ...genderFieldsToPoc(product),
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
  evalUrls: EvalUrl[],
  options: CliOptions,
  stats: RuntimeStats,
): Promise<PocProduct[]> {
  const model = process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL
  stats.llmAdapter = `llm-scraper/qwen/${model}/${options.format}`

  const browser = await chromium.launch({headless: true})
  const rows: PocProduct[] = []
  try {
    const context = await browser.newContext({userAgent: USER_AGENT, locale: "ko-KR"})
    // Images/fonts are never read by the LLM; blocking them cuts page load time.
    // CSS is kept: `markdown` preprocessing walks the rendered DOM.
    await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}", (route) => route.abort())
    const page = await context.newPage()
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}))

    for (const target of evalUrls) {
      const started = Date.now()
      // Per-call usage sink: llm-scraper's run() returns only {data, url}, so the
      // only place token counts are observable is inside the model middleware.
      const usage: TokenUsage = {input_tokens: 0, output_tokens: 0, total_tokens: 0}
      try {
        await page.goto(target.url, {waitUntil: "domcontentloaded", timeout: 60000})
        await page.waitForTimeout(1200)
        const request = await runWithQwen(async ({model: languageModel, abortSignal}) => {
          const scraper = new LLMScraper(usageCapturingModel(languageModel, usage))
          return scraper.run(page, Output.object({schema: NativeLlmProductSchema}), {
            format: options.format,
            system: EXTRACTION_SYSTEM,
            temperature: 0,
            maxRetries: 0,
            abortSignal,
          })
        })
        stats.requests += 1
        addTokenUsage(stats.tokenUsage, usage)
        const row = extractionToPocProduct({
          variant: "llm-scraper",
          brandKey: config.key,
          config,
          sourceUrl: target.url,
          extracted: request.value.data,
          elapsedMs: Date.now() - started,
          estimatedCost: estimateLlmCost(usage),
          error: null,
          audit: {urlSource: target.source, format: options.format, model, usage},
        })
        if (row.error?.includes("schema_validation_failed")) stats.jsonValidationFailures += 1
        rows.push(row)
      } catch (err) {
        stats.requests += 1
        addTokenUsage(stats.tokenUsage, usage)
        stats.jsonValidationFailures += messageOf(err).includes("validation") ? 1 : 0
        rows.push(errorPocProduct("llm-scraper", config, target.url, Date.now() - started, messageOf(err), {
          urlSource: target.source,
          format: options.format,
          model,
          usage,
        }))
      } finally {
        await page.goto("about:blank", {timeout: 5000}).catch(() => {})
      }
    }
    await context.close().catch(() => {})
  } finally {
    await browser.close().catch(() => {})
  }

  stats.selectedProductUrls = evalUrls.length
  stats.discoveredProductUrls = evalUrls.length
  stats.elapsedMs += rows.reduce((sum, row) => sum + row.elapsed_ms, 0)
  stats.estimatedCost = sumNullable(rows.map((r) => r.estimated_cost))
  return rows
}

/**
 * llm-scraper calls `generateText()` internally and returns only `{data, url}` --
 * `usage` is discarded (see llm-scraper/dist/models.js). Wrapping the model is the
 * only way to observe token counts, and without them every cost number is zero.
 */
function usageCapturingModel(model: QwenAttemptContext["model"], sink: TokenUsage) {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({doGenerate}) => {
        const result = await doGenerate()
        addTokenUsage(sink, normalizeUnknownUsage(result.usage))
        return result
      },
    },
  })
}

/**
 * Compact classification context. Instead of the whole page (becay markdown = 267k
 * chars / ~92k tokens), send just the signals a classifier needs: title, breadcrumb,
 * og metadata, JSON-LD, and a bounded description snippet. Typically <8k chars.
 * NOTE: the page.evaluate callback uses only expressions (no inner const/function) --
 * tsx's __name transform breaks named declarations inside the browser context.
 */
async function readCompactContext(page: Page): Promise<string> {
  const compact = await page.evaluate(() => ({
    title: document.title || "",
    ogTitle: (document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null)?.content || "",
    ogDescription:
      (document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null)?.content || "",
    ogType: (document.querySelector('meta[property="og:type"]') as HTMLMetaElement | null)?.content || "",
    breadcrumb: Array.from(
      document.querySelectorAll('[class*="crumb" i] a, [class*="path" i] a, .xans-layout-category a, nav a'),
    )
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 15)
      .join(" > "),
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => (s.textContent || "").replace(/\s+/g, " ").trim())
      .join("\n")
      .slice(0, 4000),
    // Cafe24/Shopify themes scatter the description across many container names. Take
    // the longest text block among the common ones rather than the first that matches.
    description: (
      Array.from(
        document.querySelectorAll(
          '#prdDetail, .xans-product-detail, .xans-product-additional, .cont, .detailArea, #prdInfo, .goods_description, [class*="product-info" i], [class*="detail" i], [id*="detail" i]',
        ),
      )
        .map((el) => ((el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 40)
        .sort((a, b) => b.length - a.length)[0] || ""
    ).slice(0, 2500),
  }))
  return JSON.stringify(compact)
}

interface InlineEnrichResult {
  usage: TokenUsage
  error: string | null
}

function safeClassificationPatch(
  product: Product,
  prediction: z.infer<typeof ClassificationSchema>,
) {
  return buildQwenNormalizationPatch(
    {
      productUrl: product.productUrl,
      name: product.name,
      brand: product.brand,
      category: isValidCategory(product.category) ? product.category : "other",
      subcategory: product.subcategory ?? null,
      tags: product.tags,
    },
    prediction,
  )
}

/**
 * Cafe24 + Chromium hybrid path: same LLM classification as runHybridVariant
 * below, but invoked as crawlCafe24's enrichDetailPage hook -- reusing the
 * detail page crawlCafe24 already has open instead of a second page.goto().
 * Mutates `product` in place only when the Qwen patch is taxonomy-safe. An
 * existing canonical category cannot be replaced by the model.
 * and records per-product usage/error in
 * `results` for the caller to build hybrid PocProduct rows from afterward.
 * SPEC: .moai/plans/velvet-toasting-star.md.
 */
function createInlineClassifier(
  model: string,
  stats: RuntimeStats,
): {enrich: (page: Page, product: Product) => Promise<void>; results: Map<string, InlineEnrichResult>} {
  const results = new Map<string, InlineEnrichResult>()
  const enrich = async (page: Page, product: Product): Promise<void> => {
    const usage: TokenUsage = {input_tokens: 0, output_tokens: 0, total_tokens: 0}
    try {
      const existingName = product.name ?? ""
      const request = await runWithQwen(async ({model: languageModel, abortSignal}) => {
        const scraper = new LLMScraper(usageCapturingModel(languageModel, usage))
        return scraper.run(page, Output.object({schema: ClassificationSchema}), {
          format: "custom",
          formatFunction: async (p: Page) => JSON.stringify({name: existingName, page: JSON.parse(await readCompactContext(p))}),
          system: CLASSIFY_SYSTEM,
          temperature: 0,
          maxRetries: 0,
          abortSignal,
        })
      })
      stats.requests += 1
      addTokenUsage(stats.tokenUsage, usage)
      const c = ClassificationSchema.parse(request.value.data)
      const patch = safeClassificationPatch(product, c)
      if (patch) {
        product.category = patch.category
        product.subcategory = patch.subcategory ?? undefined
      }
      results.set(product.productUrl, {
        usage,
        error: null,
      })
    } catch (err) {
      stats.requests += 1
      addTokenUsage(stats.tokenUsage, usage)
      results.set(product.productUrl, {usage, error: messageOf(err)})
    }
  }
  return {enrich, results}
}

/**
 * Shopify hybrid path (and Lightpanda-engine cafe24 fallback -- but Lightpanda
 * + hybrid is rejected upstream in runExistingVariant, so this only runs for
 * shopify in practice): existing crawler never opens a detail page for
 * shopify (pure /products.json fetch, see src/lib/shopify-engine.ts), so this
 * IS the only browser visit -- unlike cafe24, there is no second navigation to
 * eliminate here. Existing crawler provides name/price/currency/image/
 * in_stock/color; the LLM, fed only the compact context, fills the fields
 * existing is weak at (category, subcategory). Inherits
 * existing's discovery -- so pottery, where existing finds nothing, produces
 * no hybrid rows either.
 */
async function runHybridVariant(
  config: SiteConfig,
  baseProducts: Product[],
  options: CliOptions,
  stats: RuntimeStats,
): Promise<PocProduct[]> {
  const model = process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL
  stats.llmAdapter = `hybrid/qwen/${model}/compact`

  const browser = await chromium.launch({headless: true})
  const rows: PocProduct[] = []
  try {
    const context = await browser.newContext({userAgent: USER_AGENT, locale: "ko-KR"})
    await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}", (route) => route.abort())
    const page = await context.newPage()
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}))

    for (const product of baseProducts) {
      const base = existingProductToPoc(product, config, 0)
      const started = Date.now()
      const usage: TokenUsage = {input_tokens: 0, output_tokens: 0, total_tokens: 0}
      try {
        await page.goto(base.product_url ?? product.productUrl, {waitUntil: "domcontentloaded", timeout: 60000})
        await page.waitForTimeout(800)
        const existingName = base.name ?? ""
        const request = await runWithQwen(async ({model: languageModel, abortSignal}) => {
          const scraper = new LLMScraper(usageCapturingModel(languageModel, usage))
          return scraper.run(page, Output.object({schema: ClassificationSchema}), {
            format: "custom",
            formatFunction: async (p: Page) => JSON.stringify({name: existingName, page: JSON.parse(await readCompactContext(p))}),
            system: CLASSIFY_SYSTEM,
            temperature: 0,
            maxRetries: 0,
            abortSignal,
          })
        })
        stats.requests += 1
        addTokenUsage(stats.tokenUsage, usage)
        const c = ClassificationSchema.parse(request.value.data)
        const patch = safeClassificationPatch(product, c)
        rows.push({
          ...base,
          variant: "hybrid",
          category: patch ? patch.category : base.category,
          subcategory: patch ? patch.subcategory : base.subcategory,
          confidence: null,
          elapsed_ms: Date.now() - started,
          estimated_cost: estimateLlmCost(usage),
          error: null,
          audit: {source: "hybrid", model, format: "compact", usage},
        })
      } catch (err) {
        stats.requests += 1
        addTokenUsage(stats.tokenUsage, usage)
        // On LLM failure, keep the existing fields -- hybrid degrades to existing, not to nothing.
        rows.push({
          ...base,
          variant: "hybrid",
          elapsed_ms: Date.now() - started,
          estimated_cost: estimateLlmCost(usage),
          error: messageOf(err),
          audit: {source: "hybrid_fallback_to_existing", model, usage},
        })
      } finally {
        await page.goto("about:blank", {timeout: 5000}).catch(() => {})
      }
    }
    await context.close().catch(() => {})
  } finally {
    await browser.close().catch(() => {})
  }

  stats.selectedProductUrls = baseProducts.length
  stats.discoveredProductUrls = baseProducts.length
  stats.elapsedMs += rows.reduce((sum, row) => sum + row.elapsed_ms, 0)
  stats.estimatedCost = sumNullable(rows.map((r) => r.estimated_cost))
  return rows
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
    product_key: stableProductKey(args.brandKey, args.sourceUrl, args.config),
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
    product_key: stableProductKey(config.key, sourceUrl, config),
    name: null,
    price: null,
    currency: config.sourceCurrency ?? "KRW",
    image_url: null,
    product_url: sourceUrl,
    in_stock: null,
    raw_category: null,
    category: null,
    subcategory: null,
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

/**
 * Join key across variants. A hash of the canonical URL does NOT work: the same
 * Cafe24 product is reachable as `/product/detail.html?product_no=47`, as
 * `/product/<slug>/47/category/27/display/1/`, and as `/product/<slug>/47/`.
 * All three must collapse to the same key or `existing` and `llm-scraper` rows
 * never line up in diff.csv.
 */
function productIdOf(raw: string | null | undefined, config: SiteConfig): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw, config.baseUrl)
    if (config.type === "shopify") {
      const m = url.pathname.match(/\/products\/([^/?#]+)/i)
      return m ? decodeURIComponent(m[1]).toLowerCase() : null
    }
    const productNo = url.searchParams.get("product_no")
    if (productNo && /^\d+$/.test(productNo)) return productNo
    const m = url.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function stableProductKey(brandKey: string, urlOrFallback: string, config?: SiteConfig): string {
  const id = config ? productIdOf(urlOrFallback, config) : null
  return `${brandKey}:${id ?? (canonicalProductUrl(urlOrFallback) ?? urlOrFallback)}`
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

/**
 * A product DETAIL page. `pathname.includes("/product/")` is far too loose: it also
 * matches Cafe24's `/product/list.html?cate_no=125` (category grid) and
 * `/product/post-news.html?product_no=29217` (Q&A board), both of which were being
 * fed in as products.
 */
/** `www.ptry.co.kr` and `ptry.co.kr` are the same shop; sitemap.xml often uses the apex. */
function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.replace(/^www\./i, "").toLowerCase()
  const ha = strip(a)
  const hb = strip(b)
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`)
}

function looksLikeProductUrl(raw: string, config: SiteConfig): boolean {
  try {
    const url = new URL(raw, config.baseUrl)
    const base = new URL(config.baseUrl)
    if (!sameSite(url.hostname, base.hostname)) return false
    const pathname = url.pathname.toLowerCase()
    if (config.type === "shopify") return /^\/products\/[^/]+/.test(pathname)
    // detail.html is the only *.html page under /product/ that is a real detail page
    if (/\/product\/(list|search|review|post-news|board|write)\.html/.test(pathname)) return false
    return productIdOf(url.toString(), config) !== null
  } catch {
    return false
  }
}

/** Detail URLs straight from sitemap.xml (Cafe24) or /products.json (Shopify). Free, no Firecrawl credits. */
async function discoverDetailUrls(config: SiteConfig, max: number): Promise<Array<{url: string; productId: string}>> {
  const base = config.baseUrl.replace(/\/+$/, "")
  const out: Array<{url: string; productId: string}> = []
  const seen = new Set<string>()

  const push = (url: string) => {
    const productId = productIdOf(url, config)
    if (!productId || seen.has(productId)) return
    if (!looksLikeProductUrl(url, config)) return
    seen.add(productId)
    out.push({url, productId})
  }

  if (config.type === "shopify") {
    const res = await fetch(`${base}/products.json?limit=${Math.min(250, max * 3)}`, {
      headers: {"User-Agent": USER_AGENT},
    })
    if (!res.ok) throw new Error(`products.json HTTP ${res.status}`)
    const body = (await res.json()) as {products?: Array<{handle?: string}>}
    for (const p of body.products ?? []) {
      if (p.handle) push(`${base}/products/${p.handle}`)
      if (out.length >= max) break
    }
    return out
  }

  const res = await fetch(`${base}/sitemap.xml`, {headers: {"User-Agent": USER_AGENT}})
  if (!res.ok) throw new Error(`sitemap.xml HTTP ${res.status}`)
  const xml = await res.text()
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    push(m[1].trim())
    if (out.length >= max) break
  }
  return out
}

/**
 * Eval set = the same products for every variant. Prefer products the existing crawler
 * actually returned (so field-level diffs are on identical items); top up from the
 * sitemap when the intersection is short (e.g. pottery, where existing finds nothing).
 */
function buildEvalSet(
  candidates: Array<{url: string; productId: string}>,
  existingProducts: Product[],
  config: SiteConfig,
  limit: number,
): EvalUrl[] {
  // Existing products are also candidate URLs. Critical for brands whose sitemap is
  // missing/broken (e.g. parmika returns an HTML placeholder): without this, the eval
  // set would be empty even though the existing crawler found products.
  const existingCandidates = existingProducts
    .map((p) => ({url: absolutizeUrl(p.productUrl, config.baseUrl) ?? p.productUrl, productId: productIdOf(p.productUrl, config)}))
    .filter((c): c is {url: string; productId: string} => isString(c.productId))
  const existingIds = new Set(existingCandidates.map((c) => c.productId))

  const result: EvalUrl[] = candidates
    .filter((c) => existingIds.has(c.productId))
    .slice(0, limit)
    .map((c): EvalUrl => ({...c, source: "intersection"}))
  const taken = new Set(result.map((c) => c.productId))

  const addFrom = (pool: Array<{url: string; productId: string}>, source: EvalUrl["source"]) => {
    for (const c of pool) {
      if (result.length >= limit) return
      if (taken.has(c.productId)) continue
      taken.add(c.productId)
      result.push({...c, source})
    }
  }
  addFrom(candidates, "sitemap_only") // top up from sitemap
  addFrom(existingCandidates, "existing_only") // fall back to existing-found URLs (broken sitemap)

  return result
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.replace(/\s+/g, " ").trim()
  return cleaned.length > 0 ? cleaned : null
}

// Defense-in-depth against the LLM not following the "disqualify price/name
// noise" instruction (observed on an earlier hosted model, 2026-07-22: it returned the
// raw "<name> <season> ₩X ₩Y" text verbatim on every product in a 35-item
// live test despite an explicit prompt rule against it). Rather than trust
// the model's judgment blindly, reject descriptions that are obviously just
// price/name text so callers fall back to null instead of storing noise.
function looksLikeJunkDescription(description: string, name: string | null): boolean {
  if (/[₩$€£]\s*[\d,]+/.test(description)) return true
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
  if (name && normalize(description).startsWith(normalize(name).slice(0, Math.max(8, normalize(name).length - 4)))) {
    return true
  }
  return false
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
  return hasField(row, field)
}

function hasField(row: PocProduct, field: keyof PocProduct): boolean {
  const value = row[field]
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return true
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined
}

function firecrawlRowCost(): number | null {
  const rate = Number(process.env.FIRECRAWL_USD_PER_CREDIT)
  return Number.isFinite(rate) && rate >= 0 ? rate : null
}

function estimateLlmCost(_usage: TokenUsage): null {
  // Qwen is self-hosted. Keep token usage for capacity planning, but do not
  // apply stale hosted-provider rates from the environment.
  return null
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

/**
 * At the AI SDK v6 provider layer, usage counters are `{total, noCache, cacheRead}`
 * objects rather than plain numbers; only the top-level `generateText` result flattens
 * them. Accept both so token capture survives either call site.
 */
function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value && typeof value === "object") {
    const total = (value as {total?: unknown}).total
    if (typeof total === "number" && Number.isFinite(total)) return total
  }
  return null
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
  const classificationFillRates = Object.fromEntries(CLASSIFICATION_FIELDS.map((field) => [
    field,
    rows.length === 0 ? 0 : round(rows.filter((row) => hasField(row, field)).length / rows.length),
  ]))
  return {
    discovered_product_url_count: runtime.discoveredProductUrls,
    selected_product_url_count: runtime.selectedProductUrls,
    final_success_product_count: successRows.length,
    required_field_fill_rate: fillRates,
    classification_field_fill_rate: classificationFillRates,
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
  const evalSets: Record<string, EvalUrl[]> = {}

  // Ad-hoc brand configs not in platforms.ts (new-brand onboarding test). Path via
  // POC_EXTRA_BRANDS env; each entry is a minimal SiteConfig (key/name/type/baseUrl).
  const extraConfigs = new Map<string, SiteConfig>()
  if (process.env.POC_EXTRA_BRANDS) {
    const raw = JSON.parse(await fs.readFile(process.env.POC_EXTRA_BRANDS, "utf8")) as SiteConfig[]
    for (const c of raw) extraConfigs.set(c.key, c)
    console.log(`Extra brands loaded: ${[...extraConfigs.keys()].join(", ")}`)
  }

  console.log(`POC run: ${options.runId}`)
  console.log(`Brands: ${options.brands.join(", ")}`)
  console.log(`Variants: ${options.variants.join(", ")}`)
  console.log(`Format: ${options.format} | model: ${process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL}`)
  console.log(`Output: ${runDir}`)

  for (const brandKey of options.brands) {
    // Registry config wins over POC_EXTRA_BRANDS when both exist: the extra-brands
    // JSON round-trips through JSON.stringify (recrawl-batch.ts writes worklist
    // configs to disk), which silently corrupts RegExp fields like
    // genderTextPatterns into "{}" (RegExp has no enumerable own properties).
    // extraConfigs stays the fallback for genuinely new brands not yet in
    // platforms.ts, where it's the only source of truth.
    const config = getSiteConfig(brandKey) ?? extraConfigs.get(brandKey)
    if (!config) throw new Error(`Unknown brand key: ${brandKey}`)

    console.log(`\n[${brandKey}] starting`)
    const existingRuntime = getRuntime(stats, brandKey, "existing")

    // Cafe24 + Chromium + hybrid requested: enrich inline during the existing
    // detail-crawl visit instead of a second page.goto() per product (SPEC:
    // .moai/plans/velvet-toasting-star.md). Lightpanda can't host llm-scraper
    // at all (lightpanda-spike-report.md) -- runExistingVariant throws below
    // if hybrid is requested on that engine, rather than silently degrading.
    const hybridRequested = options.variants.includes("hybrid")
    const cafe24Engine = parseCafe24EngineMode(process.env.CRAWLER_CAFE24_ENGINE)
    if (hybridRequested && config.type === "cafe24" && cafe24Engine !== "chromium") {
      existingRuntime.errors.push(
        `hybrid variant is not supported on the Lightpanda engine (CRAWLER_CAFE24_ENGINE=${cafe24Engine}) — see .moai/plans/lightpanda-spike-report.md`,
      )
      console.error(`[${brandKey}] ❌ hybrid + Lightpanda engine is unsupported — skipping brand`)
      continue
    }
    const useInlineHybrid = hybridRequested && config.type === "cafe24" && cafe24Engine === "chromium"
    let inlineHybrid: {model: string; results: Map<string, InlineEnrichResult>} | undefined
    let enrichDetailPageFn: ((page: Page, product: Product) => Promise<void>) | undefined
    if (useInlineHybrid) {
      const model = process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL
      const hybridRuntime = getRuntime(stats, brandKey, "hybrid")
      hybridRuntime.llmAdapter = `hybrid/qwen/${model}/compact-inline`
      const classifier = createInlineClassifier(model, hybridRuntime)
      enrichDetailPageFn = classifier.enrich
      inlineHybrid = {model, results: classifier.results}
    }

    // 1. Wide pool from the existing crawler (its own list-page discovery).
    //    When useInlineHybrid, pool's products are already LLM-enriched in
    //    place by the time this returns (crawlCafe24 called enrichDetailPageFn
    //    per product during its own detail-crawl loop).
    let pool: Product[] = []
    try {
      pool = await runExistingVariant(
        config,
        options.poolLimit,
        existingRuntime,
        options.includeOutOfStock,
        enrichDetailPageFn,
      )
    } catch (err) {
      existingRuntime.errors.push(messageOf(err))
    }

    // 2. Candidate detail URLs from sitemap.xml / products.json. Scan the whole sitemap:
    //    shopamomento lists 2253 products and the existing crawler samples one category,
    //    so a low cap makes the intersection spuriously empty.
    let candidates: Array<{url: string; productId: string}> = []
    try {
      candidates = await discoverDetailUrls(config, 5000)
    } catch (err) {
      existingRuntime.errors.push(`discovery_failed: ${messageOf(err)}`)
    }

    // 3. Same products for every variant.
    const evalSet = buildEvalSet(candidates, pool, config, options.limit)
    evalSets[brandKey] = evalSet
    const intersectionCount = evalSet.filter((e) => e.source === "intersection").length
    console.log(
      `[${brandKey}] pool=${pool.length} sitemap=${candidates.length} eval=${evalSet.length} (intersection=${intersectionCount})`,
    )

    // 4. Products the existing crawler found that are in the eval set. `existing` and
    //    `hybrid` both build on these (hybrid re-classifies them via the LLM).
    const evalIds = new Set(evalSet.map((e) => e.productId))
    const matched: Product[] = []
    const matchedIds = new Set<string>()
    for (const product of pool) {
      const id = productIdOf(product.productUrl, config)
      if (id === null || !evalIds.has(id) || matchedIds.has(id)) continue
      matchedIds.add(id)
      matched.push(product)
      if (matched.length >= options.limit) break
    }

    if (options.variants.includes("existing")) {
      existingRuntime.selectedProductUrls = matched.length
      const perProduct = pool.length > 0 ? Math.round(existingRuntime.elapsedMs / pool.length) : existingRuntime.elapsedMs
      rows.push(...matched.map((product) => existingProductToPoc(product, config, perProduct)))
      if (matched.length === 0) {
        console.log(`[${brandKey}] existing produced 0 rows for the eval set`)
      }
    }

    if (options.variants.includes("firecrawl")) {
      const runtime = getRuntime(stats, brandKey, "firecrawl")
      const result = await runFirecrawlVariant(config, pool, options, runtime)
      rows.push(...result.rows)
    }

    if (options.variants.includes("llm-scraper")) {
      const runtime = getRuntime(stats, brandKey, "llm-scraper")
      rows.push(...(await runLlmScraperVariant(config, evalSet, options, runtime)))
    }

    if (hybridRequested) {
      if (inlineHybrid) {
        // Cafe24 + Chromium: pool is already LLM-enriched in place (no second
        // visit) -- just re-stamp the matched subset as hybrid rows.
        const hybridRuntime = getRuntime(stats, brandKey, "hybrid")
        hybridRuntime.selectedProductUrls = matched.length
        hybridRuntime.discoveredProductUrls = matched.length
        const hybridRows: PocProduct[] = matched.map((product) => {
          const enrichResult = inlineHybrid!.results.get(product.productUrl)
          const base = existingProductToPoc(product, config, 0)
          return {
            ...base,
            variant: "hybrid",
            confidence: null,
            estimated_cost: enrichResult ? estimateLlmCost(enrichResult.usage) : null,
            error: enrichResult?.error ?? null,
            audit: {source: "hybrid_inline", model: inlineHybrid!.model, format: "compact", usage: enrichResult?.usage ?? null},
          }
        })
        hybridRuntime.estimatedCost = sumNullable(hybridRows.map((r) => r.estimated_cost))
        rows.push(...hybridRows)
        if (matched.length === 0) {
          console.log(`[${brandKey}] hybrid produced 0 rows (existing found nothing to classify)`)
        }
      } else if (config.type !== "cafe24") {
        // Shopify (and any future non-cafe24 type): unchanged separate-visit path.
        const runtime = getRuntime(stats, brandKey, "hybrid")
        rows.push(...(await runHybridVariant(config, matched, options, runtime)))
        if (matched.length === 0) {
          console.log(`[${brandKey}] hybrid produced 0 rows (existing found nothing to classify)`)
        }
      }
      // else: cafe24 on a non-Chromium engine (Lightpanda/auto) -- runExistingVariant
      // already threw/recorded an explicit error above; no hybrid rows to add.
    }
  }

  const summary = buildSummary(options, rows, stats, runDir)
  await writeArtifacts(runDir, rows, summary)
  await fs.writeFile(path.join(runDir, "eval-set.json"), JSON.stringify(evalSets, null, 2) + "\n")
  console.log(`\nArtifacts written:`)
  console.log(`  ${path.join(runDir, "products.jsonl")}`)
  console.log(`  ${path.join(runDir, "summary.json")}`)
  console.log(`  ${path.join(runDir, "diff.csv")}`)
  console.log(`  ${path.join(runDir, "eval-set.json")}`)
}

main().catch((err: unknown) => {
  console.error(messageOf(err))
  process.exitCode = 1
})
