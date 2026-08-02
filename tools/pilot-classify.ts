#!/usr/bin/env npx tsx
/**
 * 커스텀 브랜드 파일럿 분류기 — data/<key>-products.json (crawl.ts 출력 스키마)
 * 의 category/subcategory를 canonical taxonomy로 채운다.
 *
 * onboard-classify.ts 는 poc-runs/products.jsonl(POC 스키마) 전용이라 직접 크롤
 * 산출물에는 못 쓴다. 이 도구는 같은 배치 분류 접근(gpt-5.4-nano, 25개/청크)을
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

const usage = {input: 0, output: 0}
const OPENAI_MODEL = process.env.LLM_SCRAPER_MODEL || "gpt-5.4-nano"
const model = wrapLanguageModel({
  model: openai(OPENAI_MODEL),
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
  [key: string]: unknown
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
  const targets = products
    .map((p, i) => ({p, i}))
    .filter(({p}) => !CATEGORY_SET.has(p.category ?? ""))
  if (targets.length === 0) {
    fs.writeFileSync(file, JSON.stringify(products, null, 2))
    console.log(
      `- ${key}: ${products.length}개 모두 canonical — 분류 스킵`,
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
  console.log(
    `- ${key}: ${products.length}개 · 재분류 ${targets.length} · canonical 확정 ${filled} · other ${other}`,
  )
}

async function main(): Promise<void> {
  const keys = process.argv.slice(2)
  if (keys.length === 0) {
    console.error("usage: pilot-classify.ts <key> [<key>...]")
    process.exit(1)
  }
  for (const key of keys) await processSite(key)
  console.log(`model=${OPENAI_MODEL} · LLM tokens in=${usage.input} out=${usage.output}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
