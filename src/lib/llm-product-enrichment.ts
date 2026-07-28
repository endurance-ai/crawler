import {openai} from "@ai-sdk/openai"
import {Output, wrapLanguageModel} from "ai"
import LLMScraper from "llm-scraper"
import type {Page} from "playwright"
import {z} from "zod"

import {CATEGORIES, buildSubcategoryReference} from "./enums/product-enums"
import {COLOR_CANONICAL_NAMES} from "./product-qc/normalization"
import {PRODUCT_GENDER_VALUES} from "./product-gender"
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
  color: z.string().nullable(),
  description: z.string().nullable(),
  gender: z.array(z.enum(PRODUCT_GENDER_VALUES)).min(1),
})

// subcategory/color stay freeform strings in EnrichmentSchema (not z.enum) —
// subcategory's valid set depends on the predicted category, and color
// intentionally keeps room for a specific real name when nothing canonical
// fits (see product-qc/normalization.ts's COLOR_RULES policy comment). Both
// get a canonical-strict second pass in the QC gate every write path already
// runs through (normalizeSubcategoryField / normalizeColorField), so this
// prompt only needs to steer the *common* case toward the same vocabulary
// instead of leaving it fully freeform.
const SYSTEM = `Classify one fashion product using only the supplied name, brand, breadcrumb, metadata and description.
Do not invent material, origin, fit or other factual claims absent from the context.

category must be exactly one of: ${CATEGORIES.join(", ")}.

subcategory must be one of the values below for the chosen category, or null if none fits — do not invent a value outside this list:
${buildSubcategoryReference()}

color: use one of these canonical names when the product's color matches: ${COLOR_CANONICAL_NAMES.join(", ")}. Only return a different, more specific name when the actual color clearly isn't one of these. Return null if no color is stated or shown.
CRITICAL — do not infer color from technical/marketing phrases that merely happen to contain a color word: "블루라이트 차단"(blue-light-filtering lens coating, not the item's color), "UV차단", "골드메달 수상"(gold medal award), "블랙프라이데이"(Black Friday sale), "그린워싱", "레드카펫" and similar are NOT color evidence. Only report a color when something explicitly and unambiguously names the physical color/appearance of THIS item — a stated color/variant option, a color word in the product title/breadcrumb describing the item itself, or a tag naming the color. If no such explicit, unambiguous signal exists, return null. Do not guess.
You may receive "tags" (site-provided product tags) and "existingColorHint" (a previously scraped color value) as extra signal. Tags are a genuine site-provided signal — a tag like "black" or "color-navy" is real evidence. existingColorHint is NOT reliable — it is frequently a size/stock/UI label ("사이즈", "Quantity Up Down", a bare SKU code) rather than an actual color, so only use it when it plainly names a color; otherwise ignore it and rely on tags/name/breadcrumb/description instead.

Return a concise useful description, canonical category, specific subcategory when known, primary color, and audience.
Return only JSON matching the schema.`

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const result = value.replace(/\s+/g, " ").trim()
  return result || null
}

function junkDescription(value: string, name: string): boolean {
  if (/[₩$€£]\s*[\d,]+/.test(value)) return true
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
  const normalizedName = normalize(name)
  return normalizedName.length >= 8 && normalize(value).startsWith(normalizedName.slice(0, normalizedName.length - 4))
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

export async function enrichProductWithLlm(
  page: Page,
  product: Product,
  config: SiteConfig,
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

  await page.goto(product.productUrl, {waitUntil: "domcontentloaded", timeout: 60_000})
  await page.waitForTimeout(800)
  const context = await compactContext(page)
  const scraper = new LLMScraper(wrapped)
  // Reasoning models (gpt-5.x, o1/o3, ...) reject the `temperature` sampling
  // param outright — the AI SDK only warns and ignores it, but the warning
  // fires on every single call and pollutes batch-repair logs (2026-07-28
  // color-repair review, switching the default model to gpt-5.4-nano).
  const isReasoningModel = /^(?:gpt-5|o1|o3)/.test(model)
  const result = await scraper.run(page, Output.object({schema: EnrichmentSchema}), {
    format: "custom",
    formatFunction: async () =>
      JSON.stringify({
        name: product.name,
        brand: product.brand,
        tags: product.tags ?? [],
        existingColorHint: product.color ?? null,
        page: context,
      }),
    system: SYSTEM,
    ...(isReasoningModel ? {} : {temperature: 0}),
  })
  const parsed = EnrichmentSchema.parse(result.data)
  const description = clean(parsed.description)
  const enriched: Product = {
    ...product,
    category: parsed.category,
    subcategory: clean(parsed.subcategory) ?? undefined,
    color: clean(parsed.color) ?? product.color,
    description:
      description && !junkDescription(description, product.name)
        ? description
        : product.description,
    gender: parsed.gender,
  }
  return {product: enriched, model, usage, costUsd: estimateCost(usage)}
}
