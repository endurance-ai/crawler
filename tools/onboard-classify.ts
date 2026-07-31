#!/usr/bin/env npx tsx
// existing-crawl output → QC gate → anomaly filter → batch classify
// → write data/<key>-products.json in the full import schema.
import * as fs from "fs"; import * as path from "path"
import {openai} from "@ai-sdk/openai"; import {generateText, Output, wrapLanguageModel} from "ai"; import {z} from "zod"
const RUN = process.argv[2], CONFIGS = process.argv[3], PASSOUT = process.argv[4]
// Which product-extraction-poc.ts variant to consume from products.jsonl.
// Default "existing" preserves current behavior; "hybrid" picks up the
// llm-scraper-enhanced rows (category/subcategory already LLM-filled during
// crawl — see runHybridVariant in product-extraction-poc.ts).
const VARIANT = process.env.ONBOARD_VARIANT || "existing"
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const CANON = ["tops", "knitwear", "bottoms", "dresses", "outerwear", "underwear", "swimwear", "activewear", "shoes", "bags", "accessories", "eyewear", "jewelry", "headwear", "other"], SYM: Record<string, string> = {KRW: "₩", USD: "$", EUR: "€", GBP: "£"}
const configs: any[] = JSON.parse(fs.readFileSync(CONFIGS, "utf8")); const cfgByKey: Record<string, any> = {}; for (const c of configs) cfgByKey[c.key] = c
const has = (v: any) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
const NOUN = /jacket|coat|pant|trouser|short|tee|shirt|top|knit|sweat|hoodie|cardigan|blouse|dress|skirt|bag|hat|cap|belt|scarf|sock|shoe|sneaker|boot|loafer|sandal|jean|denim|vest|blazer|parka|jersey|셔츠|팬츠|자켓|재킷|코트|니트|맨투맨|후드|원피스|스커트|가방|모자|바지|티셔츠/i
const isAnomaly = (rows: any[]) => rows.length >= 3 && rows.filter((r) => { const n = (r.name || "").trim(); return n.split(/\s+/).length <= 2 && !NOUN.test(n) }).length / rows.length >= 0.6
const uCls = {i: 0, o: 0}
const mk = (s: {i: number; o: number}) => wrapLanguageModel({model: openai("gpt-4.1-nano"), middleware: {specificationVersion: "v3", wrapGenerate: async ({doGenerate}) => { const r = await doGenerate(); const u = r.usage as any; const n = (v: any) => (typeof v === "number" ? v : v && typeof v.total === "number" ? v.total : 0); s.i += n(u?.inputTokens); s.o += n(u?.outputTokens); return r }}})
const clsModel = mk(uCls)
const ClsSchema = z.object({items: z.array(z.object({i: z.number(), category: z.string().nullable(), subcategory: z.string().nullable()}))})
// hybrid variant 은 runHybridVariant / createInlineClassifier 가 **상세 페이지를 보고**
// subcategory 를 뽑아 products.jsonl 에 실어 보낸다. 아래 classify() 는 이름만 보는
// gpt-4.1-nano 배치 분류라 근거가 훨씬 약하므로, hybrid 일 때는 페이지 기반 값을 우선한다.
// (existing variant 에는 이 필드가 없으므로 기존 경로는 바이트 동일하게 유지된다.)
const hybridSubcategory = (r: any): string | null =>
  VARIANT === "hybrid" && typeof r.subcategory === "string" && r.subcategory.trim() ? r.subcategory.trim() : null
async function classify(items: {name: string; hint: string | null}[]) { const p: Record<number, any> = {}; for (let s = 0; s < items.length; s += 25) { const chunk = items.slice(s, s + 25).map((it, k) => ({i: s + k, name: it.name, hint: it.hint})); try { const res = await generateText({model: clsModel, output: Output.object({schema: ClsSchema}), system: `Classify each fashion product. category MUST be one of: ${CANON.join(", ")}. Use name+hint. One entry per index.`, messages: [{role: "user", content: JSON.stringify(chunk)}], temperature: 0}); for (const it of (res.output as any).items) p[it.i] = it } catch {} } return p }
async function main() {
  // 빈 줄을 걸러내고 파싱한다. 크롤이 0건이면 products.jsonl 이 빈 파일이 되는데,
  // 예전에는 "".split("\n") → [""] → JSON.parse("") 로 터졌다. 브랜드 하나가 상품을
  // 못 뽑으면 **청크 전체가 죽는** 구조였다 (실측 2026-07-31: tune 이 0건이라 크래시).
  const jsonlPath = `${RUN}/products.jsonl`
  const rawText = fs.existsSync(jsonlPath) ? fs.readFileSync(jsonlPath, "utf8") : ""
  const rows = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r: any) => r.variant === VARIANT)
  if (rows.length === 0) {
    // 빈 결과도 정상 종료해야 다음 청크로 넘어간다. PASSOUT 은 비워서 쓴다 —
    // onboard-batch.sh 가 이걸 읽어 import 대상을 정하므로 파일 자체는 있어야 한다.
    console.log(`crawled 0 rows (variant=${VARIANT}) — 적재할 브랜드 없음`)
    fs.writeFileSync(PASSOUT, JSON.stringify([]))
    return
  }
  const seen = new Set<string>(); const uniq = rows.filter((r: any) => { const k = `${r.brand_key}|${r.product_url || r.name}`; if (seen.has(k)) return false; seen.add(k); return true })
  const byBrand: Record<string, any[]> = {}; for (const r of uniq) (byBrand[r.brand_key] ||= []).push(r)
  let fail = 0, anom = 0; const passBrands: string[] = []
  for (const c of configs) { const rs = byBrand[c.key] || []; if (rs.length === 0 || rs.filter((r) => !has(r.price)).length / rs.length >= 0.99) { fail++; continue } if (isAnomaly(rs)) { anom++; continue } passBrands.push(c.key) }
  const pass = uniq.filter((r) => passBrands.includes(r.brand_key) && has(r.name))
  console.log(`crawled ${Object.keys(byBrand).length}/${configs.length} · FAIL ${fail} · anomaly ${anom} · PASS ${passBrands.length} · SKU ${pass.length}`)
  // hybrid rows already carry an LLM-derived `category` (from runHybridVariant) —
  // feed it as the hint so this pass mostly just normalizes it into the canonical
  // taxonomy instead of re-classifying blind from name alone.
  const preds = await classify(pass.map((r) => ({name: r.name, hint: r.raw_category ?? r.category ?? null})))
  // 2026-07-29: 색상 복구 단계 제거. 색상 출처가 VLM(product_features.primary_color)
  // 으로 이관되면서 여기서 브라우저를 띄우고 상품마다 LLM 을 호출하던 3단계 복구
  // (텍스트 추출 → 상세 재방문 → LLM)가 통째로 불필요해졌다.
  // brand is a required non-nullable field downstream (product-validator.ts
  // ProductSchema). cfg.brand is unset for multi-brand editorial shops (correct —
  // they need per-product DOM brand extraction, not a single config value) and
  // for house-brand malls not yet given a `brand:` field in platforms.ts. Either
  // way, writing `undefined` here gets silently dropped by JSON.stringify and the
  // validator rejects 100% of the brand's products with no obvious signal. Fall
  // back to cfg.name (always set) and warn once per brand so the gap is visible.
  const warnedNoBrand = new Set<string>()
  const perBrand: Record<string, any[]> = {}
  pass.forEach((r, i) => { const cfg = cfgByKey[r.brand_key], p = preds[i] || {}, cur = r.currency || "KRW", price = typeof r.price === "number" ? r.price : null
    if (!cfg.brand && !warnedNoBrand.has(r.brand_key)) { warnedNoBrand.add(r.brand_key); console.warn(`⚠️  ${r.brand_key}: platforms.ts has no config.brand — falling back to name "${cfg.name}". If this is a single-house-brand shop, add the brand field (see docs/bulk-onboarding.md §4-1); if it's multi-brand, this fallback is wrong and needs per-product brand extraction instead.`) }
    // 멀티브랜드 편집샵은 스토어명으로 폴백하지 않는다 — LLM 이 상품에서 뽑은
    // 브랜드를 쓰고, 못 뽑으면 "" 로 남겨 import 의 provenance 가드가 격리한다
    // (`lib/brand-provenance.ts`). 단일브랜드몰은 종전대로 cfg.name 폴백 + 경고.
    ;(perBrand[r.brand_key] ||= []).push({name: r.name, category: p.category ?? r.category ?? null, subcategory: hybridSubcategory(r) ?? p.subcategory ?? null, price, originalPrice: price, salePrice: null, priceFormatted: price != null ? `${SYM[cur] || ""}${price.toLocaleString()}` : "", sourceCurrency: cur, imageUrl: r.image_url, productUrl: r.product_url, inStock: r.in_stock, platform: r.brand_key, brand: cfg.brand || (cfg.multiBrand ? ((p as {brand?: string}).brand ?? "") : cfg.name), crawledAt: new Date().toISOString()}) })
  fs.mkdirSync("data", {recursive: true}); const written: string[] = []
  for (const [key, prods] of Object.entries(perBrand)) { fs.writeFileSync(path.join("data", `${key}-products.json`), JSON.stringify(prods, null, 2)); written.push(key) }
  fs.writeFileSync(PASSOUT, JSON.stringify(written))
  const all = Object.values(perBrand).flat(); const fill = (f: string) => all.length ? Math.round(all.filter((p: any) => has(p[f])).length / all.length * 100) : 0
  console.log(`=== ${written.length} files · ${all.length} products · fill price=${fill("price")} category=${fill("category")} · LLM $${(uCls.i / 1e6 * 0.1 + uCls.o / 1e6 * 0.4).toFixed(4)}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
