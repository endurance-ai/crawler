#!/usr/bin/env npx tsx
// Re-classify every products.category/subcategory into the 15-family taxonomy
// (product-enums.ts) using an LLM. The legacy `category` column is free text and
// mostly unusable for search (sale banners, ZARA nav labels, cate_no=…), so this
// rewrites both fields to the frozen vocabulary shared with the search path.
//
// Usage:
//   tsx tools/reclassify-categories.ts --dry-run --limit 200   # sample, no writes
//   tsx tools/reclassify-categories.ts                          # full run, writes DB
//   tsx tools/reclassify-categories.ts --start-id <id>          # resume after id
//   tsx tools/reclassify-categories.ts --only-invalid           # guardrail: fix only
//                                                                # rows whose category
//                                                                # isn't a canonical
//                                                                # family (cheap — safe
//                                                                # to run after every
//                                                                # onboarding import)
//   tsx tools/reclassify-categories.ts --only-invalid --platform=etce,oheshio
//                                                                # scope to specific
//                                                                # platform key(s),
//                                                                # comma-separated
//
// Resumable: processes products ordered by id in pages; prints the last id per
// page so a killed run can resume with --start-id.
import {createClient} from "@supabase/supabase-js"
import {z} from "zod"
import {CATEGORIES, buildEnumReference, isValidCategory, isValidSubcategory, type Category} from "../src/lib/enums/product-enums"
import {assertQwenReady, generateQwenObject} from "../src/lib/qwen-client"
import {classifyShopifyCategory} from "../src/lib/shopify-category-classifier"

const args = process.argv.slice(2)
const DRY = args.includes("--dry-run")
const ONLY_INVALID = args.includes("--only-invalid")
const ONLY_OTHER = args.includes("--only-other")
const IN_STOCK_ONLY = args.includes("--in-stock-only")
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || (args.includes("--limit") ? args[args.indexOf("--limit") + 1] : "") || 0)
const START_ID = (args.find((a) => a.startsWith("--start-id=")) || "").split("=")[1] || (args.includes("--start-id") ? args[args.indexOf("--start-id") + 1] : "")
const PLATFORM_FILTER = (args.find((a) => a.startsWith("--platform=")) || "").split("=")[1]?.split(",").filter(Boolean) || null
const PAGE = 1000
const BATCH = 25
const CONCURRENCY = 8

const db = createClient(process.env.DB_URL!, process.env.DB_TOKEN!)

const usage = {i: 0, o: 0}
let qwenModel = process.env.QWEN_MODEL || "qwen3-vl-30b-awq"
const num = (v: any) => (typeof v === "number" ? v : v && typeof v.total === "number" ? v.total : 0)

const ClsSchema = z.object({
  items: z.array(z.object({i: z.number(), category: z.string(), subcategory: z.string().nullable()})),
})
const SYSTEM = `You classify fashion e-commerce products into a fixed taxonomy. For each item pick the best category (family) and a subcategory from that family's list (or null). Use the product name, product URL slug, and tags together; the "hint" is a noisy legacy label (may be a sale banner, nav label, or another language) — use it only as a weak signal. Non-fashion / homeware / editorial lookbooks / unclassifiable → category "other" with null subcategory. One entry per input index.\n\n${buildEnumReference()}`

async function classifyBatch(items: {i: number; name: string; hint: string; brand: string; url: string; tags: string[]}[]): Promise<Record<number, {category: Category; subcategory: string | null}>> {
  const out: Record<number, {category: Category; subcategory: string | null}> = {}
  try {
    const res = await generateQwenObject({
      schema: ClsSchema,
      system: SYSTEM,
      prompt: JSON.stringify(items.map((it) => ({i: it.i, name: it.name, brand: it.brand, hint: it.hint}))),
    })
    qwenModel = res.model
    usage.i += num(res.usage.inputTokens)
    usage.o += num(res.usage.outputTokens)
    for (const it of (res.value as z.infer<typeof ClsSchema>).items) {
      const cat = String(it.category || "").toLowerCase().trim()
      if (!isValidCategory(cat)) {
        out[it.i] = {category: "other", subcategory: null}
        continue
      }
      const sub = it.subcategory ? String(it.subcategory).toLowerCase().trim() : null
      out[it.i] = {category: cat as Category, subcategory: sub && isValidSubcategory(sub, cat as Category) ? sub : null}
    }
  } catch (error) {
    // A live guardrail must never report completion after silently losing its
    // Qwen fallback. Dry-run remains best-effort because it writes nothing.
    if (!DRY) throw error
    // leave unclassified indices; caller falls back to keeping row unchanged
  }
  return out
}

async function mapWithConcurrency<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let idx = 0
  await Promise.all(
    Array.from({length: Math.min(n, tasks.length)}, async () => {
      while (idx < tasks.length) {
        const cur = idx++
        results[cur] = await tasks[cur]()
      }
    }),
  )
  return results
}

async function main() {
  if (ONLY_INVALID && ONLY_OTHER) {
    throw new Error("--only-invalid and --only-other are mutually exclusive")
  }
  console.log(
    `reclassify start · ${DRY ? "DRY-RUN" : "LIVE"} · ${ONLY_INVALID ? "mode=only-invalid (guardrail)" : ONLY_OTHER ? "mode=only-other" : `limit=${LIMIT || "all"} · start-id=${START_ID || "(begin)"}`}` +
      (IN_STOCK_ONLY ? " · in-stock-only" : "") +
      (PLATFORM_FILTER ? ` · platform=${PLATFORM_FILTER.join(",")}` : ""),
  )
  if (!DRY) {
    const ready = await assertQwenReady()
    console.log(
      `Qwen ready · ${ready.map(({endpoint, model}) => `${endpoint} (${model})`).join(", ")}`,
    )
  }
  let lastId = START_ID
  let processed = 0
  let changed = 0
  const newDist: Record<string, number> = {}
  const samples: string[] = []

  for (;;) {
    const pageLimit = LIMIT ? Math.min(PAGE, Math.max(0, LIMIT - processed)) : PAGE
    if (pageLimit === 0) break
    // --only-invalid: no id cursor — each fixed row leaves the invalid set, so
    // re-querying the same filter naturally drains to empty. Safe to run after
    // every onboarding import regardless of DB size (only touches broken rows).
    let q = ONLY_INVALID
      ? db.from("products").select("id,name,category,subcategory,brand,product_url,tags").not("category", "in", `(${CATEGORIES.join(",")})`).limit(pageLimit)
      : db.from("products").select("id,name,category,subcategory,brand,product_url,tags").order("id", {ascending: true}).limit(pageLimit)
    if (!ONLY_INVALID && lastId) q = q.gt("id", lastId)
    if (ONLY_OTHER) q = q.eq("category", "other")
    if (IN_STOCK_ONLY) q = q.eq("in_stock", true)
    if (PLATFORM_FILTER) q = q.in("platform", PLATFORM_FILTER)
    const {data, error} = await q
    if (error) {
      console.error("fetch error:", error.message)
      process.exitCode = 1
      return
    }
    if (!data || data.length === 0) break

    // 1. Deterministic pass — keyword classifier on the product name. High
    //    precision on clear tokens (sweater→knitwear, sunglasses→eyewear,
    //    hoodie→tops) which the cheap LLM routes inconsistently.
    const preds: Record<string, {category: Category; subcategory: string | null}> = {}
    const llmRows: {id: string; name: string; hint: string; brand: string; url: string; tags: string[]}[] = []
    let detCount = 0
    for (const r of data) {
      const tags = Array.isArray(r.tags) ? r.tags.filter((tag): tag is string => typeof tag === "string") : []
      // Rows already classified as `other` include genuine homeware, beauty,
      // books and editorial entries. The deterministic Shopify classifier is
      // deliberately fashion-biased and can turn those into false positives
      // (for example perfume -> accessories, book -> shoes). Let Qwen retain
      // `other` explicitly in this repair mode.
      const d = ONLY_OTHER ? {category: null, subcategory: null} :
        classifyShopifyCategory(r.product_url || "", r.name || "", tags)
      if (d.category && isValidCategory(d.category)) {
        preds[r.id] = {category: d.category as Category, subcategory: d.subcategory && isValidSubcategory(d.subcategory, d.category as Category) ? d.subcategory : null}
        detCount++
      } else {
        llmRows.push({id: r.id, name: r.name || "", hint: r.category || "", brand: r.brand || "", url: r.product_url || "", tags})
      }
    }

    // 2. LLM fallback — only names the deterministic pass could not classify.
    const batchTasks: (() => Promise<void>)[] = []
    for (let s = 0; s < llmRows.length; s += BATCH) {
      const slice = llmRows.slice(s, s + BATCH)
      batchTasks.push(async () => {
        const items = slice.map((r, k) => ({i: k, name: r.name, hint: r.hint, brand: r.brand, url: r.url, tags: r.tags}))
        const res = await classifyBatch(items)
        for (let k = 0; k < slice.length; k++) {
          const p = res[k]
          if (p) preds[slice[k].id] = p
        }
      })
    }
    await mapWithConcurrency(batchTasks, CONCURRENCY)

    // apply / report
    const updates: {id: string; category: Category; subcategory: string | null}[] = []
    for (const r of data) {
      const p = preds[r.id]
      processed++
      if (!p) continue
      newDist[p.category] = (newDist[p.category] || 0) + 1
      if (p.category !== r.category || (p.subcategory ?? null) !== (r.subcategory ?? null)) {
        changed++
        updates.push({id: r.id, category: p.category, subcategory: p.subcategory})
        if (samples.length < 30) samples.push(`  "${(r.category || "").slice(0, 28)}" | ${(r.name || "").slice(0, 34)} → ${p.category}/${p.subcategory ?? "-"}`)
      }
    }

    if (!DRY && updates.length) {
      // group by (category, subcategory) then PATCH id-chunks
      const groups: Record<string, {category: Category; subcategory: string | null; ids: string[]}> = {}
      for (const u of updates) {
        const key = `${u.category}||${u.subcategory ?? ""}`
        ;(groups[key] ||= {category: u.category, subcategory: u.subcategory, ids: []}).ids.push(u.id)
      }
      for (const g of Object.values(groups)) {
        for (let c = 0; c < g.ids.length; c += 100) {
          const chunk = g.ids.slice(c, c + 100)
          const {error: uerr} = await db.from("products").update({category: g.category, subcategory: g.subcategory}).in("id", chunk)
          if (uerr) console.error(`update error (${g.category}/${g.subcategory}):`, uerr.message)
        }
      }
    }

    lastId = data[data.length - 1].id
    console.log(`  page done · processed=${processed} changed=${changed} · det=${detCount} llm=${llmRows.length} · lastId=${lastId} · model=${qwenModel} · LLM tokens in=${usage.i} out=${usage.o}`)

    if (LIMIT && processed >= LIMIT) break
    if (data.length < PAGE) break
    // ONLY_INVALID + DRY never shrinks the result set (no writes) — one pass is enough.
    if ((ONLY_INVALID || ONLY_OTHER) && DRY) break
  }

  console.log(`\n=== DONE ${DRY ? "(DRY-RUN, no writes)" : "(LIVE)"} ===`)
  console.log(`processed=${processed} changed=${changed} · model=${qwenModel} · LLM tokens in=${usage.i} out=${usage.o}`)
  console.log("new family distribution:")
  Object.entries(newDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`))
  console.log("\nsample old→new (changed):")
  console.log(samples.join("\n"))
  console.log(`\ntaxonomy families (${CATEGORIES.length}): ${CATEGORIES.join(", ")}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
