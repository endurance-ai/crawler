#!/usr/bin/env npx tsx
/** Read-only search-index fallback for brands whose official homepage was unavailable. */
import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"

type Scope = "men" | "women"
type BrandRow = {id: number; brand_name: string; gender_scope: unknown}
type SearchRow = {
  brandId: number
  brandName: string
  current: Scope
  status: number | null
  error: string | null
  blocked: boolean
  oppositeSignal: boolean
  excerpt: string | null
  resultUrls: string[]
}

const OUTPUT = path.resolve("data/brand-gender-search-fallback.json")
const CONCURRENCY = 2

function currentScope(value: unknown): Scope | null {
  return Array.isArray(value) && value.length === 1 && (value[0] === "men" || value[0] === "women") ? value[0] : null
}

function visibleText(html: string): string {
  return html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/giu, " ")
    .replace(/<(script|style|svg|form)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function resultUrls(html: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/\bhref=(?:"|')([^"']+)(?:"|')/giu)) {
    let value = match[1]
    const googleTarget = value.match(/^\/url\?q=([^&]+)/u)
    if (googleTarget) value = decodeURIComponent(googleTarget[1])
    value = value.replace(/&amp;/gi, "&")
    if (/^https?:\/\/www\.bing\.com\/ck\/a/iu.test(value)) {
      const encoded = new URL(value).searchParams.get("u")
      if (encoded?.startsWith("a1")) value = Buffer.from(encoded.slice(2), "base64url").toString("utf8")
    }
    if (!/^https?:\/\//iu.test(value) || /(?:^|\.)(google|bing)\./iu.test(new URL(value).hostname) || seen.has(value)) continue
    seen.add(value)
    urls.push(value)
    if (urls.length === 10) break
  }
  return urls
}

function oppositePattern(current: Scope): RegExp {
  return current === "men"
    ? /women'?s?(?:wear| clothing| fashion| collection| range)?|for women|여성복|여성 (?:브랜드|컬렉션|의류)/iu
    : /(?<!wo)men'?s?(?:wear| clothing| fashion| collection| range)?|for men|남성복|남성 (?:브랜드|컬렉션|의류)/iu
}

function excerptAround(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text)
  if (!match || match.index === undefined) return null
  return text.slice(Math.max(0, match.index - 180), Math.min(text.length, match.index + match[0].length + 180))
}

async function search(brand: BrandRow, current: Scope): Promise<SearchRow> {
  const query = `"${brand.brand_name}" official fashion brand`
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10&setlang=en`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36"}})
    const html = await response.text()
    const text = visibleText(html)
    const urls = resultUrls(html)
    const blocked = /unusual traffic|not a robot|captcha|automated queries|verify you are human/iu.test(text) || urls.length === 0
    const pattern = oppositePattern(current)
    return {
      brandId: brand.id,
      brandName: brand.brand_name,
      current,
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      blocked,
      oppositeSignal: !blocked && pattern.test(text),
      excerpt: !blocked ? excerptAround(text, pattern) : null,
      resultUrls: urls,
    }
  } catch (error) {
    return {brandId: brand.id, brandName: brand.brand_name, current, status: null, error: error instanceof Error ? error.message : String(error), blocked: false, oppositeSignal: false, excerpt: null, resultUrls: []}
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
  const homepageReport = JSON.parse(fs.readFileSync(path.resolve("data/brand-gender-homepage-audit.json"), "utf8")) as {evidence: Array<{brandId: number; error: string | null}>}
  const homepageUsable = new Set(homepageReport.evidence.filter((item) => !item.error).map((item) => item.brandId))
  const db = createClient(dbUrl, dbToken)
  const brands: BrandRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const {data, error} = await db.from("brand_nodes").select("id,brand_name,gender_scope").order("id").range(offset, offset + 999)
    if (error) throw error
    brands.push(...data as BrandRow[])
    if (!data || data.length < 1000) break
  }
  const targets = brands.flatMap((brand) => {
    const current = currentScope(brand.gender_scope)
    return current && !homepageUsable.has(brand.id) ? [{brand, current}] : []
  })
  const rows: SearchRow[] = new Array(targets.length)
  let cursor = 0
  let completed = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++
      if (index >= targets.length) return
      rows[index] = await search(targets[index].brand, targets[index].current)
      completed++
      if (completed % 25 === 0 || completed === targets.length) console.log(`progress ${completed}/${targets.length}`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  await Promise.all(Array.from({length: CONCURRENCY}, () => worker()))
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      targets: rows.length,
      fetched: rows.filter((row) => !row.error).length,
      failed: rows.filter((row) => row.error).length,
      blocked: rows.filter((row) => row.blocked).length,
      oppositeSignalCandidates: rows.filter((row) => row.oppositeSignal).length,
    },
    candidates: rows.filter((row) => row.oppositeSignal),
    rows,
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.totals, null, 2))
  console.log(`report: ${OUTPUT}`)
}

await main()
