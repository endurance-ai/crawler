#!/usr/bin/env npx tsx
// existing-crawl output → QC gate → anomaly filter → batch classify → color recovery
// → write data/<key>-products.json in the full import schema.
import * as fs from "fs"; import * as path from "path"
import {openai} from "@ai-sdk/openai"; import {generateText, Output, wrapLanguageModel} from "ai"; import {chromium, type Page} from "playwright"; import {z} from "zod"
import {normalizeColorList} from "../src/lib/parsers/field-extractors/color-normalizer"
const RUN = process.argv[2], CONFIGS = process.argv[3], PASSOUT = process.argv[4]
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const CANON = ["tops", "knitwear", "bottoms", "dresses", "outerwear", "underwear", "swimwear", "activewear", "shoes", "bags", "accessories", "eyewear", "jewelry", "headwear", "other"], SYM: Record<string, string> = {KRW: "₩", USD: "$", EUR: "€", GBP: "£"}
const configs: any[] = JSON.parse(fs.readFileSync(CONFIGS, "utf8")); const cfgByKey: Record<string, any> = {}; for (const c of configs) cfgByKey[c.key] = c
const has = (v: any) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
const NOUN = /jacket|coat|pant|trouser|short|tee|shirt|top|knit|sweat|hoodie|cardigan|blouse|dress|skirt|bag|hat|cap|belt|scarf|sock|shoe|sneaker|boot|loafer|sandal|jean|denim|vest|blazer|parka|jersey|셔츠|팬츠|자켓|재킷|코트|니트|맨투맨|후드|원피스|스커트|가방|모자|바지|티셔츠/i
const isAnomaly = (rows: any[]) => rows.length >= 3 && rows.filter((r) => { const n = (r.name || "").trim(); return n.split(/\s+/).length <= 2 && !NOUN.test(n) }).length / rows.length >= 0.6
const uCls = {i: 0, o: 0}, uCol = {i: 0, o: 0}
const mk = (s: {i: number; o: number}) => wrapLanguageModel({model: openai("gpt-4.1-nano"), middleware: {specificationVersion: "v3", wrapGenerate: async ({doGenerate}) => { const r = await doGenerate(); const u = r.usage as any; const n = (v: any) => (typeof v === "number" ? v : v && typeof v.total === "number" ? v.total : 0); s.i += n(u?.inputTokens); s.o += n(u?.outputTokens); return r }}})
const clsModel = mk(uCls), colModel = mk(uCol)
const ClsSchema = z.object({items: z.array(z.object({i: z.number(), category: z.string().nullable(), subcategory: z.string().nullable()}))}), ColSchema = z.object({color: z.string().nullable()})
const CW = /^(black|white|ivory|cream|beige|tan|khaki|olive|green|blue|navy|sky ?blue|teal|indigo|red|pink|coral|burgundy|wine|purple|violet|grey|gray|charcoal|brown|camel|mocha|taupe|sand|bone|yellow|gold|orange|silver|melange|mint)$/i
const detColor = (t: string) => { for (const r of t.split(/[\s,_/|.\-()]+/)) { const c = normalizeColorList(r); if (c && CW.test(c)) return c } return null }
async function classify(items: {name: string; hint: string | null}[]) { const p: Record<number, any> = {}; for (let s = 0; s < items.length; s += 25) { const chunk = items.slice(s, s + 25).map((it, k) => ({i: s + k, name: it.name, hint: it.hint})); try { const res = await generateText({model: clsModel, output: Output.object({schema: ClsSchema}), system: `Classify each fashion product. category MUST be one of: ${CANON.join(", ")}. Use name+hint. One entry per index.`, messages: [{role: "user", content: JSON.stringify(chunk)}], temperature: 0}); for (const it of (res.output as any).items) p[it.i] = it } catch {} } return p }
async function llmColor(page: Page, pr: any) { try { await page.goto(pr.product_url, {waitUntil: "domcontentloaded", timeout: 40000}).catch(() => {}); await page.waitForTimeout(300); const c = await page.evaluate(() => ({handle: location.pathname, options: Array.from(document.querySelectorAll("select option")).map((o) => (o.textContent || "").trim()).filter(Boolean).slice(0, 12), detail: (document.querySelector('#prdDetail, .xans-product-detail, .cont, [class*="detail" i]') as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").slice(0, 800) || ""})).catch(() => ({handle: "", options: [] as string[], detail: ""})); const res = await generateText({model: colModel, output: Output.object({schema: ColSchema}), system: "Extract THIS product's primary color from name/handle/options/description. One color word. null ONLY if none.", messages: [{role: "user", content: JSON.stringify({name: pr.name, ...c})}], temperature: 0}); const col = (res.output as any)?.color; return col && String(col).trim() ? String(col).trim() : null } catch { return null } }
async function main() {
  const rows = fs.readFileSync(`${RUN}/products.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r: any) => r.variant === "existing")
  const seen = new Set<string>(); const uniq = rows.filter((r: any) => { const k = `${r.brand_key}|${r.product_url || r.name}`; if (seen.has(k)) return false; seen.add(k); return true })
  const byBrand: Record<string, any[]> = {}; for (const r of uniq) (byBrand[r.brand_key] ||= []).push(r)
  let fail = 0, anom = 0; const passBrands: string[] = []
  for (const c of configs) { const rs = byBrand[c.key] || []; if (rs.length === 0 || rs.filter((r) => !has(r.price)).length / rs.length >= 0.99) { fail++; continue } if (isAnomaly(rs)) { anom++; continue } passBrands.push(c.key) }
  const pass = uniq.filter((r) => passBrands.includes(r.brand_key) && has(r.name))
  console.log(`crawled ${Object.keys(byBrand).length}/${configs.length} · FAIL ${fail} · anomaly ${anom} · PASS ${passBrands.length} · SKU ${pass.length}`)
  const preds = await classify(pass.map((r) => ({name: r.name, hint: r.raw_category ?? null})))
  const browser = await chromium.launch({headless: true}); const fc: Record<number, string | null> = {}; let det = 0, llm = 0
  try { const ctx = await browser.newContext({userAgent: UA, locale: "ko-KR"}); await ctx.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}", (r) => r.abort()); const page = await ctx.newPage(); page.on("dialog", (d) => d.dismiss().catch(() => {}))
    for (let i = 0; i < pass.length; i++) { const r = pass[i]; let c = has(r.color) ? (normalizeColorList(r.color) || null) : null; if (!c) { c = detColor(`${r.name} ${r.product_url} ${r.description || ""}`); if (c) det++ } if (!c) { c = await llmColor(page, r); if (c) { c = normalizeColorList(c) || c; llm++ } await page.goto("about:blank", {timeout: 5000}).catch(() => {}) } fc[i] = c }
    await ctx.close().catch(() => {}) } finally { await browser.close().catch(() => {}) }
  console.log(`color: det +${det} · llm +${llm}`)
  const perBrand: Record<string, any[]> = {}
  pass.forEach((r, i) => { const cfg = cfgByKey[r.brand_key], p = preds[i] || {}, cur = r.currency || "KRW", price = typeof r.price === "number" ? r.price : null; (perBrand[r.brand_key] ||= []).push({name: r.name, category: p.category ?? r.category ?? null, subcategory: p.subcategory ?? null, price, originalPrice: price, salePrice: null, priceFormatted: price != null ? `${SYM[cur] || ""}${price.toLocaleString()}` : "", sourceCurrency: cur, imageUrl: r.image_url, productUrl: r.product_url, inStock: r.in_stock, platform: cfg.type, gender: cfg.defaultGender ?? [], brand: cfg.brand, color: fc[i], description: r.description ?? null, crawledAt: new Date().toISOString()}) })
  fs.mkdirSync("data", {recursive: true}); const written: string[] = []
  for (const [key, prods] of Object.entries(perBrand)) { fs.writeFileSync(path.join("data", `${key}-products.json`), JSON.stringify(prods, null, 2)); written.push(key) }
  fs.writeFileSync(PASSOUT, JSON.stringify(written))
  const all = Object.values(perBrand).flat(); const fill = (f: string) => all.length ? Math.round(all.filter((p: any) => has(p[f])).length / all.length * 100) : 0
  console.log(`=== ${written.length} files · ${all.length} products · fill price=${fill("price")} category=${fill("category")} color=${fill("color")} · color null ${all.filter((p: any) => !has(p.color)).length} · LLM $${((uCls.i + uCol.i) / 1e6 * 0.1 + (uCls.o + uCol.o) / 1e6 * 0.4).toFixed(4)}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
