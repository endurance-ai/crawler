#!/usr/bin/env npx tsx
/** Read-only search-index audit for explicit menswear/womenswear brand descriptions. */
import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"

type Scope = "men" | "women" | "unisex"
type BrandRow = {id: number; brand_name: string; gender_scope: unknown}
type Descriptor = "men" | "women" | "both" | null

type SearchRow = {
  brandId: number
  brandName: string
  current: Scope
  status: number | null
  error: string | null
  blocked: boolean
  descriptor: Descriptor
  excerpt: string | null
  resultUrls: string[]
}

const OUTPUT = path.resolve("data/brand-gender-descriptor-audit.json")
const CONCURRENCY = 4
const DELAY_MS = 500

const MEN = /(?:menswear|men's (?:fashion|clothing|apparel)) (?:brand|label)|(?:brand|label) (?:dedicated|designed|made|exclusively designed) (?:exclusively )?for men|men-only (?:brand|label)/iu
const WOMEN = /(?:womenswear|women's (?:fashion|clothing|apparel)) (?:brand|label)|(?:brand|label) (?:dedicated|designed|made|exclusively designed) (?:exclusively )?for women|women-only (?:brand|label)/iu

function currentScope(value: unknown): Scope | null {
  return Array.isArray(value) && value.length === 1 && ["men", "women", "unisex"].includes(value[0]) ? value[0] as Scope : null
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
    let value = match[1].replace(/&amp;/gi, "&")
    if (/^https?:\/\/www\.bing\.com\/ck\/a/iu.test(value)) {
      const encoded = new URL(value).searchParams.get("u")
      if (encoded?.startsWith("a1")) value = Buffer.from(encoded.slice(2), "base64url").toString("utf8")
    }
    if (!/^https?:\/\//iu.test(value)) continue
    const hostname = new URL(value).hostname
    if (/(?:^|\.)(bing)\./iu.test(hostname) || seen.has(value)) continue
    seen.add(value)
    urls.push(value)
    if (urls.length === 10) break
  }
  return urls
}

function classify(text: string): Descriptor {
  const men = MEN.test(text)
  const women = WOMEN.test(text)
  if (men && women) return "both"
  if (men) return "men"
  if (women) return "women"
  return null
}

function excerpt(text: string, descriptor: Descriptor): string | null {
  if (!descriptor) return null
  const matches = [descriptor === "women" ? WOMEN.exec(text) : MEN.exec(text), descriptor === "both" ? WOMEN.exec(text) : null].filter(Boolean)
  if (matches.length === 0) return null
  const start = Math.min(...matches.map((match) => match!.index))
  return text.slice(Math.max(0, start - 220), Math.min(text.length, start + 500))
}

async function search(brand: BrandRow, current: Scope): Promise<SearchRow> {
  const query = `"${brand.brand_name}" official fashion brand`
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10&setlang=en`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36"},
    })
    const html = await response.text()
    const text = visibleText(html)
    const urls = resultUrls(html)
    const blocked = /unusual traffic|not a robot|captcha|automated queries|verify you are human/iu.test(text) || urls.length === 0
    const descriptor = blocked ? null : classify(text)
    return {brandId: brand.id, brandName: brand.brand_name, current, status: response.status, error: response.ok ? null : `HTTP ${response.status}`, blocked, descriptor, excerpt: excerpt(text, descriptor), resultUrls: urls}
  } catch (error) {
    return {brandId: brand.id, brandName: brand.brand_name, current, status: null, error: error instanceof Error ? error.message : String(error), blocked: false, descriptor: null, excerpt: null, resultUrls: []}
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
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
    return current ? [{brand, current}] : []
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
      if (completed % 100 === 0 || completed === targets.length) console.log(`progress ${completed}/${targets.length}`)
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    }
  }
  await Promise.all(Array.from({length: CONCURRENCY}, () => worker()))
  const candidates = rows.filter((row) => row.descriptor && row.descriptor !== "both" && row.descriptor !== row.current)
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {targets: rows.length, fetched: rows.filter((row) => !row.error).length, failed: rows.filter((row) => row.error).length, blocked: rows.filter((row) => row.blocked).length, descriptorRows: rows.filter((row) => row.descriptor).length, candidates: candidates.length},
    candidates,
    rows,
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.totals, null, 2))
  console.log(`report: ${OUTPUT}`)
}

await main()
