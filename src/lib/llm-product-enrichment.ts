import {openai} from "@ai-sdk/openai"
import {Output, wrapLanguageModel} from "ai"
import LLMScraper from "llm-scraper"
import type {Page} from "playwright"
import {z} from "zod"

import {CATEGORIES, buildSubcategoryReference} from "./enums/product-enums"
import type {Product, SiteConfig} from "./types"

export interface LlmTokenUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}
export interface LlmProductEnrichment {
  product: Product
  model: string
  usage: LlmTokenUsage
  costUsd: number | null
}

const EnrichmentSchema = z.object({
  category: z.enum(CATEGORIES),
  subcategory: z.string().nullable(),
})

// subcategory stays a freeform string in EnrichmentSchema (not z.enum) — its
// valid set depends on the predicted category. It gets a canonical-strict
// second pass in the QC gate every write path already runs through
// (normalizeSubcategoryField), so this prompt only needs to steer the
// *common* case toward the same vocabulary instead of leaving it fully
// freeform.
const SYSTEM = `Classify one fashion product using only the supplied name, brand, breadcrumb, metadata and description.
Do not invent material, origin, fit or other factual claims absent from the context.

category must be exactly one of: ${CATEGORIES.join(", ")}.

subcategory must be one of the values below for the chosen category, or null if none fits — do not invent a value outside this list:
${buildSubcategoryReference()}

Return only JSON matching the schema.`

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const result = value.replace(/\s+/g, " ").trim()
  return result || null
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value && typeof value === "object") {
    const total = (value as {total?: unknown}).total
    if (typeof total === "number" && Number.isFinite(total)) return total
  }
  return 0
}

function normalizeUsage(value: unknown): LlmTokenUsage {
  if (!value || typeof value !== "object") {
    return {input_tokens: 0, output_tokens: 0, total_tokens: 0}
  }
  const usage = value as Record<string, unknown>
  const input =
    numberValue(usage.inputTokens) ||
    numberValue(usage.promptTokens) ||
    numberValue(usage.input_tokens)
  const output =
    numberValue(usage.outputTokens) ||
    numberValue(usage.completionTokens) ||
    numberValue(usage.output_tokens)
  const total =
    numberValue(usage.totalTokens) ||
    numberValue(usage.total_tokens) ||
    input + output
  return {input_tokens: input, output_tokens: output, total_tokens: total}
}

function estimateCost(usage: LlmTokenUsage): number | null {
  const inputRate = Number(process.env.LLM_SCRAPER_INPUT_USD_PER_1M)
  const outputRate = Number(process.env.LLM_SCRAPER_OUTPUT_USD_PER_1M)
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null
  return (usage.input_tokens / 1_000_000) * inputRate +
    (usage.output_tokens / 1_000_000) * outputRate
}

function normalizedHost(raw: string): string {
  const host = new URL(raw).hostname.toLowerCase()
  return host.startsWith("www.") ? host.slice(4) : host
}

function assertSameSource(url: string, config: SiteConfig): void {
  if (normalizedHost(url) !== normalizedHost(config.baseUrl)) {
    throw new Error(`candidate URL host differs from source config: ${url}`)
  }
}

async function compactContext(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    title: document.title || "",
    ogTitle: (document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null)?.content || "",
    ogDescription:
      (document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null)?.content || "",
    breadcrumb: Array.from(
      document.querySelectorAll('[class*="crumb" i] a, [class*="path" i] a, nav a'),
    )
      .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 15),
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
      .join("\n")
      .slice(0, 4000),
    description: (
      Array.from(
        document.querySelectorAll(
          '#prdDetail, .xans-product-detail, .xans-product-additional, .detailArea, #prdInfo, .goods_description, [class*="product-info" i], [class*="detail" i], [id*="detail" i]',
        ),
      )
        .map((node) => ((node as HTMLElement).innerText || "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 40)
        .sort((a, b) => b.length - a.length)[0] || ""
    ).slice(0, 2500),
  }))
}

export interface EnrichOptions {
  /**
   * 페이지 로드 후 컨텍스트를 읽기까지의 대기 (기본 800ms). zara/uniqlo 처럼
   * 클라이언트 렌더가 늦은 SPA 는 800ms 시점에 jsonLd/breadcrumb 가 아직
   * 비어 있을 수 있어 상향이 필요하다.
   */
  waitMs?: number
  /**
   * false 면 page.goto 를 생략하고 호출자가 준비해 둔 페이지를 그대로 읽는다.
   * 상세 페이지 대량 방문이 봇 차단을 부르는 사이트에서, 크롤 레코드만으로
   * 만든 최소 문서를 대신 넣어 돌리기 위한 탈출구
   * (src/enrich-products-file.ts --no-visit-page).
   */
  navigate?: boolean
}

export async function enrichProductWithLlm(
  page: Page,
  product: Product,
  config: SiteConfig,
  options: EnrichOptions = {},
): Promise<LlmProductEnrichment> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required")
  assertSameSource(product.productUrl, config)
  const model = process.env.LLM_SCRAPER_MODEL || "gpt-5.4-nano"
  const usage: LlmTokenUsage = {input_tokens: 0, output_tokens: 0, total_tokens: 0}
  const wrapped = wrapLanguageModel({
    model: openai(model),
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({doGenerate}) => {
        const result = await doGenerate()
        const current = normalizeUsage(result.usage)
        usage.input_tokens += current.input_tokens
        usage.output_tokens += current.output_tokens
        usage.total_tokens += current.total_tokens
        return result
      },
    },
  })

  if (options.navigate !== false) {
    await page.goto(product.productUrl, {waitUntil: "domcontentloaded", timeout: 60_000})
  }
  await page.waitForTimeout(options.waitMs ?? 800)
  const context = await compactContext(page)
  const scraper = new LLMScraper(wrapped)
  // Reasoning models (gpt-5.x, o1/o3, ...) reject the `temperature` sampling
  // param outright — the AI SDK only warns and ignores it, but the warning
  // fires on every single call and pollutes batch logs.
  const isReasoningModel = /^(?:gpt-5|o1|o3)/.test(model)
  const result = await scraper.run(page, Output.object({schema: EnrichmentSchema}), {
    format: "custom",
    formatFunction: async () =>
      JSON.stringify({
        name: product.name,
        brand: product.brand,
        tags: product.tags ?? [],
        page: context,
      }),
    system: SYSTEM,
    ...(isReasoningModel ? {} : {temperature: 0}),
  })
  const parsed = EnrichmentSchema.parse(result.data)
  const enriched: Product = {
    ...product,
    category: parsed.category,
    subcategory: clean(parsed.subcategory) ?? undefined,
  }
  return {product: enriched, model, usage, costUsd: estimateCost(usage)}
}
