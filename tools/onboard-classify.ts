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
const mk = (s: {i: number; o: number}) => wrapLanguageModel({model: openai("gpt-5.4-nano"), middleware: {specificationVersion: "v3", wrapGenerate: async ({doGenerate}) => { const r = await doGenerate(); const u = r.usage as any; const n = (v: any) => (typeof v === "number" ? v : v && typeof v.total === "number" ? v.total : 0); s.i += n(u?.inputTokens); s.o += n(u?.outputTokens); return r }}})
const clsModel = mk(uCls)
const ClsSchema = z.object({items: z.array(z.object({i: z.number(), category: z.string().nullable(), subcategory: z.string().nullable(), brand: z.string().nullable()}))})
async function classify(items: {name: string; hint: string | null}[]) { const p: Record<number, any> = {}; for (let s = 0; s < items.length; s += 25) { const chunk = items.slice(s, s + 25).map((it, k) => ({i: s + k, name: it.name, hint: it.hint})); try { const res = await generateText({model: clsModel, output: Output.object({schema: ClsSchema}), system: `Classify each fashion product. category MUST be one of: ${CANON.join(", ")}. Use name+hint. Also extract "brand": when the name is formatted like "[BRAND] product name", "BRAND - product name", or otherwise starts with an explicit brand/label (common on multi-brand editorial shops), return that brand string; return null if no brand is discernible from the name alone. One entry per index.`, messages: [{role: "user", content: JSON.stringify(chunk)}], temperature: 0}); for (const it of (res.output as any).items) p[it.i] = it } catch {} } return p }
async function main() {
  const rows = fs.readFileSync(`${RUN}/products.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r: any) => r.variant === VARIANT)
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
    // brand 결정: 단일브랜드몰은 config.brand. 멀티브랜드 편집샵(cfg.multiBrand)은
    // LLM 이 상품명에서 추출한 브랜드(p.brand)를 쓰고, 추출 실패 시 "" 로 남겨
    // import 단계에서 격리한다(플랫폼명으로 폴백하지 않음). config.brand 도 없고
    // multiBrand 도 아닌 하우스브랜드몰은 종전처럼 cfg.name 폴백 + 경고.
    const brand = cfg.brand || (cfg.multiBrand ? (p.brand ?? "") : cfg.name)
    if (!cfg.brand && !cfg.multiBrand && !warnedNoBrand.has(r.brand_key)) { warnedNoBrand.add(r.brand_key); console.warn(`⚠️  ${r.brand_key}: platforms.ts has no config.brand — falling back to name "${cfg.name}". If this is a single-house-brand shop, add the brand field (see docs/bulk-onboarding.md §4-1); if it's multi-brand, mark it multiBrand:true so per-product LLM brand extraction is used instead.`) }
    ;(perBrand[r.brand_key] ||= []).push({name: r.name, category: p.category ?? r.category ?? null, subcategory: p.subcategory ?? null, price, originalPrice: price, salePrice: null, priceFormatted: price != null ? `${SYM[cur] || ""}${price.toLocaleString()}` : "", sourceCurrency: cur, imageUrl: r.image_url, productUrl: r.product_url, inStock: r.in_stock, platform: r.brand_key, brand, crawledAt: new Date().toISOString()}) })
  fs.mkdirSync("data", {recursive: true}); const written: string[] = []
  for (const [key, prods] of Object.entries(perBrand)) { fs.writeFileSync(path.join("data", `${key}-products.json`), JSON.stringify(prods, null, 2)); written.push(key) }
  fs.writeFileSync(PASSOUT, JSON.stringify(written))
  const all = Object.values(perBrand).flat(); const fill = (f: string) => all.length ? Math.round(all.filter((p: any) => has(p[f])).length / all.length * 100) : 0
  console.log(`=== ${written.length} files · ${all.length} products · fill price=${fill("price")} category=${fill("category")} · LLM $${(uCls.i / 1e6 * 0.1 + uCls.o / 1e6 * 0.4).toFixed(4)}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
