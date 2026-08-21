#!/usr/bin/env npx tsx
/**
 * One-time backfill: replace auto-generated Cat{cateNo} placeholder category
 * names (src/configs/platforms.generated.ts) with real nav labels + inferred
 * gender, discovered live via Playwright — same signal the runtime engine's
 * discoverCategories() uses. The cateNo enumeration itself is never changed
 * (only names/gender), so crawl behavior for these sites is unaffected;
 * only the category label quality improves. cateNo values with no live nav
 * match keep their existing Cat{N} placeholder unchanged.
 *
 * Usage: npx dotenv -e .env.local -- tsx tools/backfill-cafe24-category-names.ts
 * Output: tools/cafe24-category-name-overrides.generated.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"
import {chromium} from "playwright"
import {GENERATED_PLATFORMS} from "../src/configs/platforms.generated"
import {parseCafe24CategoryHref, dedupeAndFilterCafe24Categories} from "../src/lib/cafe24-chain"
import {inferGenderFromText} from "../src/lib/product-gender"
import type {SiteConfig} from "../src/lib/types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH = path.join(__dirname, "cafe24-category-name-overrides.generated.ts")

function readExistingOverrides(): Record<string, CategoryOut[]> {
  if (!fs.existsSync(OUT_PATH)) return {}
  const content = fs.readFileSync(OUT_PATH, "utf8")
  const match = content.match(/CAFE24_CATEGORY_NAME_BACKFILL[^{]*=\s*(\{[\s\S]*\n\})/)
  if (!match) return {}
  // The file body is plain JS object literal syntax (unquoted keys use JSON.stringify
  // so it's valid JSON-ish but not strict JSON — eval it in an isolated function scope.
  // eslint-disable-next-line no-new-func
  return new Function(`return ${match[1]}`)()
}

function extractPlaceholderKeys(): string[] {
  const content = fs.readFileSync(
    path.join(__dirname, "../src/configs/platforms.generated.ts"),
    "utf8",
  )
  const blocks = content.split(/^\s{2}\{$/m).slice(1)
  const keys: string[] = []
  for (const b of blocks) {
    if (!/name: "Cat\d+"/.test(b)) continue
    if (/disabled: true/.test(b)) continue
    const m = b.match(/key: "([^"]+)"/)
    if (m) keys.push(m[1])
  }
  return keys
}

type CategoryOut = {name: string; cateNo: number; gender?: string[]}

const GENERATED_BY_KEY = new Map(GENERATED_PLATFORMS.map((c) => [c.key, c]))

async function discoverOne(
  browser: import("playwright").Browser,
  key: string,
  gotoTimeout: number,
): Promise<{key: string; categories: CategoryOut[]; matched: number; error?: string} | null> {
  // Read directly from the raw generated array — NOT getSiteConfig(), which merges
  // in SITE_CAFE24_CATEGORY_GENDERS at runtime and synthesizes extra
  // `OfficialGender${cateNo}` entries not present in the source file. Backfilling
  // against that merged view would misfire on those synthetic entries.
  const config: SiteConfig | undefined = GENERATED_BY_KEY.get(key)
  if (!config || !config.category?.categories) return null
  const existing = config.category.categories

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  })
  try {
    await page.goto(config.baseUrl, {waitUntil: "domcontentloaded", timeout: gotoTimeout})
    await page.waitForTimeout(3000)
    let links = await page.evaluate(() => {
      const anchors = document.querySelectorAll(
        'a[href*="cate_no="], a[href*="/category/"], a[href*="/product/list.html"]',
      )
      return Array.from(anchors)
        .slice(0, 500)
        .map((a) => ({
          text: a.textContent?.trim().replace(/\s+/g, " ") || "",
          href: a.getAttribute("href") || "",
        }))
    })
    if (links.length < 2) {
      // Slow-rendering nav (same failure mode fixed for yiyae this session) — retry with a longer wait.
      await page.waitForTimeout(4000)
      links = await page.evaluate(() => {
        const anchors = document.querySelectorAll(
          'a[href*="cate_no="], a[href*="/category/"], a[href*="/product/list.html"]',
        )
        return Array.from(anchors)
          .slice(0, 500)
          .map((a) => ({
            text: a.textContent?.trim().replace(/\s+/g, " ") || "",
            href: a.getAttribute("href") || "",
          }))
      })
    }

    const candidates = dedupeAndFilterCafe24Categories(
      links
        .map((l) => parseCafe24CategoryHref(l.href, config.baseUrl, l.text))
        .filter((c): c is NonNullable<typeof c> => c !== null),
    )
    const byCateNo = new Map(candidates.map((c) => [c.cateNo, c]))

    let matched = 0
    const categories: CategoryOut[] = existing.map((c) => {
      const found = byCateNo.get(c.cateNo)
      if (!found) return {name: c.name, cateNo: c.cateNo, ...(c.gender ? {gender: c.gender} : {})}
      matched += 1
      const inferred = inferGenderFromText(found.name)
      return {
        name: found.name,
        cateNo: c.cateNo,
        ...(inferred ? {gender: [inferred]} : c.gender ? {gender: c.gender} : {}),
      }
    })
    return {key, categories, matched}
  } catch (err) {
    return {key, categories: [], matched: 0, error: (err as Error).message}
  } finally {
    await page.close()
  }
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="))
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined
  const keysArg = process.argv.find((a) => a.startsWith("--keys="))
  const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="))
  const concurrency = concurrencyArg ? Number(concurrencyArg.slice("--concurrency=".length)) : 8
  const timeoutArg = process.argv.find((a) => a.startsWith("--timeout="))
  const gotoTimeout = timeoutArg ? Number(timeoutArg.slice("--timeout=".length)) : 20000
  const merge = process.argv.includes("--merge")

  let keys = keysArg ? keysArg.slice("--keys=".length).split(",") : extractPlaceholderKeys()
  if (limit) keys = keys.slice(0, limit)
  console.log(`${keys.length} active placeholder-category sites to backfill (concurrency=${concurrency}, merge=${merge})`)

  const browser = await chromium.launch({headless: true})
  const results: Array<{key: string; categories: CategoryOut[]; matched: number; error?: string}> = []
  let done = 0

  const queue = [...keys]
  async function worker() {
    while (queue.length > 0) {
      const key = queue.shift()
      if (!key) break
      const result = await discoverOne(browser, key, gotoTimeout)
      done += 1
      if (result) {
        results.push(result)
        const tag = result.error ? `ERROR: ${result.error}` : `matched ${result.matched}/${result.categories.length}`
        console.log(`[${done}/${keys.length}] ${key} — ${tag}`)
      } else {
        console.log(`[${done}/${keys.length}] ${key} — SKIP (no config/categories)`)
      }
    }
  }
  await Promise.all(Array.from({length: concurrency}, () => worker()))
  await browser.close()

  const improved = results.filter((r) => r.matched > 0 && !r.error)
  console.log(`\n${improved.length}/${results.length} sites got at least one real name backfilled`)
  const totalMatched = improved.reduce((sum, r) => sum + r.matched, 0)
  const totalCats = improved.reduce((sum, r) => sum + r.categories.length, 0)
  console.log(`${totalMatched}/${totalCats} category entries backfilled across improved sites`)

  const merged: Record<string, CategoryOut[]> = merge ? readExistingOverrides() : {}
  for (const r of improved) merged[r.key] = r.categories
  const finalKeys = Object.keys(merged).sort()

  const lines: string[] = []
  lines.push("// AUTO-GENERATED by tools/backfill-cafe24-category-names.ts — DO NOT EDIT BY HAND.")
  lines.push("// Regenerate: npx dotenv -e .env.local -- tsx tools/backfill-cafe24-category-names.ts")
  lines.push("//")
  lines.push("// Real category names + inferred gender, discovered live from each site's nav,")
  lines.push("// backfilled onto the cateNo lists that generate-platform-configs.ts previously")
  lines.push('// rendered as placeholder `Cat${cateNo}` names (2026-08-20 cafe24 batch2 follow-up).')
  lines.push('// cateNo values with no live nav match keep their original Cat{N} placeholder.')
  lines.push("")
  lines.push('import type {SiteConfig} from "../src/lib/types"')
  lines.push("")
  lines.push(
    "export const CAFE24_CATEGORY_NAME_BACKFILL: Partial<Record<string, NonNullable<SiteConfig[\"category\"]>[\"categories\"]>> = {",
  )
  for (const key of finalKeys) {
    lines.push(`  ${JSON.stringify(key)}: [`)
    for (const c of merged[key]) {
      const gender = c.gender?.length ? `, gender: ${JSON.stringify(c.gender)}` : ""
      lines.push(`    {name: ${JSON.stringify(c.name)}, cateNo: ${c.cateNo}${gender}},`)
    }
    lines.push("  ],")
  }
  lines.push("}")
  lines.push("")

  fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf8")
  console.log(`\nWrote ${OUT_PATH} (${finalKeys.length} total sites, merge=${merge})`)

  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    console.log(`\n${failed.length} sites errored (left unchanged):`)
    for (const f of failed) console.log(`  ${f.key}: ${f.error}`)
  }
  const noMatch = results.filter((r) => r.matched === 0 && !r.error)
  if (noMatch.length > 0) {
    console.log(`\n${noMatch.length} sites had 0 matches (left unchanged):`)
    for (const n of noMatch) console.log(`  ${n.key}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
