#!/usr/bin/env npx tsx
/**
 * 커스텀 브랜드 파일럿 분류기 — data/<key>-products.json (crawl.ts 출력 스키마)
 * 의 category/subcategory를 canonical taxonomy로 채운다.
 *
 * onboard-classify.ts 는 poc-runs/products.jsonl(POC 스키마) 전용이라 직접 크롤
 * 산출물에는 못 쓴다. 이 도구는 같은 배치 분류 접근(gpt-4.1-nano, 25개/청크)을
 * data/*.json 에 적용하는 얇은 어댑터다. taxonomy 원천은 product-enums.ts
 * (bulk-onboarding.md §0 핵심 원칙 — 자체 CANON 하드코딩 금지).
 *
 * Usage: npx dotenv -e .env.local -- npx tsx tools/pilot-classify.ts <key> [<key>...]
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {openai} from "@ai-sdk/openai"
import {generateText, Output, wrapLanguageModel} from "ai"
import {z} from "zod"
import {CATEGORIES, SUBCATEGORIES, type Category} from "../src/lib/enums/product-enums"
import {getSiteConfig} from "../src/configs/platforms"
import {extractColorFromText, normalizeColorList} from "../src/lib/parsers/field-extractors/color-normalizer"

const usage = {input: 0, output: 0}
const model = wrapLanguageModel({
  model: openai("gpt-4.1-nano"),
  middleware: {
    specificationVersion: "v3",
    wrapGenerate: async ({doGenerate}) => {
      const r = await doGenerate()
      // ai SDK 버전에 따라 토큰이 number 또는 {total, ...} 객체 (onboard-classify.ts와 동일 처리)
      const n = (v: unknown): number =>
        typeof v === "number" ? v : ((v as {total?: number} | undefined)?.total ?? 0)
      const u = r.usage as {inputTokens?: unknown; outputTokens?: unknown} | undefined
      usage.input += n(u?.inputTokens)
      usage.output += n(u?.outputTokens)
      return r
    },
  },
})

const Schema = z.object({
  items: z.array(
    z.object({i: z.number(), category: z.string().nullable(), subcategory: z.string().nullable()}),
  ),
})

const ColorSchema = z.object({
  items: z.array(z.object({i: z.number(), color: z.string().nullable()})),
})

const CATEGORY_SET = new Set<string>(CATEGORIES)
const SUB_BY_CAT = new Map<string, Set<string>>(
  Object.entries(SUBCATEGORIES).map(([cat, subs]) => [cat, new Set(subs as readonly string[])]),
)

const enumReference = (Object.entries(SUBCATEGORIES) as Array<[Category, readonly string[]]>)
  .map(([cat, subs]) => `${cat}: ${subs.join(", ") || "(none)"}`)
  .join("\n")

interface PilotProduct {
  name: string
  category?: string
  subcategory?: string
  gender?: string[]
  color?: string
  description?: string
  [key: string]: unknown
}

/**
 * color 복구 — import 게이트가 color NOT NULL을 강제하므로(마이그레이션 091 계열
 * 정책), 비어있는 color를 ① name+description 텍스트 추출 → ② LLM 배치(25개/청크,
 * description은 상세 JSON-LD에서 이미 확보돼 있어 브라우저 불필요) 순서로 채운다.
 * 그래도 null이면 그대로 둔다 — 게이트에서 제외되는 것이 맞는 상품.
 */
async function recoverColors(products: PilotProduct[]): Promise<{text: number; llm: number}> {
  const stats = {text: 0, llm: 0}
  const missing: Array<{i: number; p: PilotProduct}> = []
  products.forEach((p, i) => {
    if (typeof p.color === "string" && p.color.trim()) return
    const found = extractColorFromText(`${p.name} ${p.description ?? ""}`)
    if (found) {
      p.color = found
      stats.text++
    } else {
      missing.push({i, p})
    }
  })
  for (let start = 0; start < missing.length; start += 25) {
    const chunk = missing.slice(start, start + 25)
    try {
      const res = await generateText({
        model,
        output: Output.object({schema: ColorSchema}),
        system:
          "Extract each product's primary color from its name/description. " +
          "Answer with one common English color word (black, ivory, beige, navy...). null ONLY if no color is stated or implied. One entry per index.",
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              chunk.map(({i, p}) => ({i, name: p.name, description: (p.description ?? "").slice(0, 300)})),
            ),
          },
        ],
        temperature: 0,
      })
      const byIndex = new Map(chunk.map(({i, p}) => [i, p]))
      for (const item of (res.output as z.infer<typeof ColorSchema>).items) {
        const p = byIndex.get(item.i)
        if (!p || !item.color?.trim()) continue
        const normalized = normalizeColorList(item.color)
        if (normalized) {
          p.color = normalized
          stats.llm++
        }
      }
    } catch (err) {
      console.error(`  color chunk failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return stats
}

/**
 * gender 백필 — products.gender DB CHECK(091: 비어있으면 안 됨, men/women/unisex만
 * 허용)를 통과하도록 빈 gender를 config.defaultGender(브랜드 gender_scope 유래)로
 * 채운다. config에도 없으면 unisex.
 */
function backfillGender(products: PilotProduct[], key: string): number {
  const fallback = getSiteConfig(key)?.defaultGender?.filter((g) => ["men", "women", "unisex"].includes(g))
  const gender = fallback && fallback.length > 0 ? fallback : ["unisex"]
  let filled = 0
  for (const p of products) {
    if (!Array.isArray(p.gender) || p.gender.length === 0) {
      p.gender = [...gender]
      filled++
    }
  }
  return filled
}

async function classifyBatch(
  items: Array<{i: number; name: string; hint: string | null}>,
): Promise<Map<number, {category: string | null; subcategory: string | null}>> {
  const out = new Map<number, {category: string | null; subcategory: string | null}>()
  for (let start = 0; start < items.length; start += 25) {
    const chunk = items.slice(start, start + 25)
    try {
      const res = await generateText({
        model,
        output: Output.object({schema: Schema}),
        system:
          `Classify each fashion product into the canonical taxonomy. ` +
          `category MUST be one of: ${CATEGORIES.join(", ")}. ` +
          `subcategory MUST come from the matching category's list below (or null):\n${enumReference}\n` +
          `Use the product name plus the site-category hint. Non-fashion or unclassifiable → "other". One entry per index.`,
        messages: [{role: "user", content: JSON.stringify(chunk)}],
        temperature: 0,
      })
      for (const item of (res.output as z.infer<typeof Schema>).items) {
        out.set(item.i, {category: item.category, subcategory: item.subcategory})
      }
    } catch (err) {
      console.error(`  chunk ${start / 25} failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return out
}

async function processSite(key: string): Promise<void> {
  const file = path.join("data", `${key}-products.json`)
  if (!fs.existsSync(file)) {
    console.error(`- ${key}: ${file} 없음 — 스킵`)
    return
  }
  const products = JSON.parse(fs.readFileSync(file, "utf-8")) as PilotProduct[]
  const genderFilled = backfillGender(products, key)
  const colorStats = await recoverColors(products)
  const targets = products
    .map((p, i) => ({p, i}))
    .filter(({p}) => !CATEGORY_SET.has(p.category ?? ""))
  if (targets.length === 0) {
    fs.writeFileSync(file, JSON.stringify(products, null, 2))
    console.log(
      `- ${key}: ${products.length}개 모두 canonical — 분류 스킵 (gender ${genderFilled} · color 텍스트 ${colorStats.text}/LLM ${colorStats.llm})`,
    )
    return
  }
  const preds = await classifyBatch(
    targets.map(({p, i}) => ({i, name: p.name, hint: p.category?.trim() || null})),
  )
  let filled = 0
  for (const {p, i} of targets) {
    const pred = preds.get(i)
    const category = pred?.category && CATEGORY_SET.has(pred.category) ? pred.category : "other"
    const subOk = pred?.subcategory && SUB_BY_CAT.get(category)?.has(pred.subcategory)
    p.category = category
    if (subOk) p.subcategory = pred!.subcategory as string
    if (category !== "other") filled++
  }
  fs.writeFileSync(file, JSON.stringify(products, null, 2))
  const other = products.filter((p) => p.category === "other").length
  const colorNull = products.filter((p) => !(typeof p.color === "string" && p.color.trim())).length
  console.log(
    `- ${key}: ${products.length}개 · 재분류 ${targets.length} · canonical 확정 ${filled} · other ${other} · gender ${genderFilled} · color 텍스트 ${colorStats.text}/LLM ${colorStats.llm}/null ${colorNull}`,
  )
}

async function main(): Promise<void> {
  const keys = process.argv.slice(2)
  if (keys.length === 0) {
    console.error("usage: pilot-classify.ts <key> [<key>...]")
    process.exit(1)
  }
  for (const key of keys) await processSite(key)
  const cost = (usage.input / 1e6) * 0.1 + (usage.output / 1e6) * 0.4
  console.log(`LLM tokens in=${usage.input} out=${usage.output} · $${cost.toFixed(4)}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
