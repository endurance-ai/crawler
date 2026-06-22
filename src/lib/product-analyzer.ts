/**
 * 상품 이미지 AI 분석 — LiteLLM 호출 + 응답 파싱 + 유효성 검증
 */

import OpenAI from "openai"
import {createHash} from "crypto"
import {buildProductAnalyzeUser, PRODUCT_ANALYZE_SYSTEM} from "../configs/analyze-prompt"
import {
  isValidCategory,
  isValidColorFamily,
  isValidFabric,
  isValidFit,
  isValidSubcategory,
} from "./enums/product-enums"
import {isValidPattern, isValidSeason} from "./enums/season-pattern"
import {STYLE_NODE_IDS} from "./fashion-genome"

// ─── 타입 ────────────────────────────────────────────

// SPEC-SEARCH-V6: mood_tags 제거. brand-VLM 의 primary/secondary_node 가 정체성 채널.
// season/pattern 은 audit 용으로 유지 (검색 weight=0 이지만 admin 분석에 활용).
export interface AnalysisResult {
  category: string
  subcategory: string | null
  fit: string | null
  fabric: string | null
  color_family: string | null
  color_detail: string | null
  style_node: string | null
  keywords_ko: string[]
  keywords_en: string[]
  season: string | null
  pattern: string | null
  confidence: number
}

export interface AnalysisOutput {
  productId: string
  success: boolean
  result: AnalysisResult | null
  raw: unknown
  error: string | null
}

// ─── 클라이언트 ──────────────────────────────────────

let client: OpenAI
let modelName: string
let promptHash: string

export function initAnalyzer(config: {
  baseUrl: string
  apiKey: string
  model: string
}) {
  client = new OpenAI({
    baseURL: config.baseUrl + "/v1",
    apiKey: config.apiKey,
  })
  modelName = config.model
  promptHash = createHash("sha256")
    .update(PRODUCT_ANALYZE_SYSTEM)
    .digest("hex")
    .slice(0, 8)
}

export function getModelId(): string { return modelName }
export function getPromptHash(): string { return promptHash }

// ─── 분석 실행 ───────────────────────────────────────

export async function analyzeProductImage(
  productId: string,
  imageUrl: string,
  hint?: { name?: string; category?: string; description?: string; material?: string; color?: string },
): Promise<AnalysisOutput> {
  try {
    const userPrompt = buildProductAnalyzeUser(hint)

    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: PRODUCT_ANALYZE_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 600,
      temperature: 0.2,
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      return { productId, success: false, result: null, raw: null, error: "empty_response" }
    }

    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return { productId, success: false, result: null, raw: cleaned, error: "json_parse_failed" }
    }

    const result = validateAndNormalize(parsed)
    if (!result) {
      return { productId, success: false, result: null, raw: parsed, error: "invalid_category" }
    }
    return { productId, success: true, result, raw: parsed, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (message.includes("429") || message.toLowerCase().includes("rate")) {
      return { productId, success: false, result: null, raw: null, error: "rate_limited" }
    }

    return { productId, success: false, result: null, raw: null, error: message }
  }
}

// ─── 유효성 검증 + 보정 ─────────────────────────────

export function validateAndNormalize(raw: Record<string, unknown>): AnalysisResult | null {
  const category = String(raw.category || "")
  // category 추출 실패는 위조(Accessories 강제 배정) 대신 분석 실패로 처리한다.
  // 호출부가 재시도하고, 최종 실패 시 DB 저장을 건너뛰어 데이터 오염을 막는다.
  if (!isValidCategory(category)) return null

  const subcategory = raw.subcategory ? String(raw.subcategory) : null
  const fit = raw.fit ? String(raw.fit) : null
  const fabric = raw.fabric ? String(raw.fabric) : null
  const colorFamily = raw.color_family ? String(raw.color_family) : null

  return {
    category,
    subcategory: subcategory && isValidSubcategory(subcategory, category) ? subcategory : null,
    fit: fit && isValidFit(fit) ? fit : null,
    fabric: fabric && isValidFabric(fabric) ? fabric : null,
    color_family: colorFamily && isValidColorFamily(colorFamily) ? colorFamily : null,
    color_detail: raw.color_detail ? String(raw.color_detail) : null,
    style_node: raw.style_node && (STYLE_NODE_IDS as readonly string[]).includes(String(raw.style_node))
      ? String(raw.style_node) : null,
    keywords_ko: Array.isArray(raw.keywords_ko) ? raw.keywords_ko.map(String) : [],
    keywords_en: Array.isArray(raw.keywords_en) ? raw.keywords_en.map(String) : [],
    season: raw.season && isValidSeason(String(raw.season)) ? String(raw.season) : null,
    pattern: raw.pattern && isValidPattern(String(raw.pattern)) ? String(raw.pattern) : "solid",
    confidence: typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.5,
  }
}
