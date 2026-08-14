#!/usr/bin/env npx tsx
/**
 * Read-only, full-table homepage evidence collector for brand_nodes.gender_scope.
 *
 * This never writes to Supabase. It records official-page navigation signals so
 * a later, separately reviewed apply step can cite the exact source URL.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"

type Scope = "men" | "women" | "unisex"
interface BrandRow {
  id: number
  brand_name: string
  gender_scope: unknown
  wiki: Record<string, unknown> | null
}

interface LinkSignal {
  href: string
  text: string
}

interface HomepageEvidence {
  brandId: number
  brandName: string
  current: unknown
  url: string
  finalUrl: string | null
  status: number | null
  error: string | null
  title: string | null
  menLinks: LinkSignal[]
  womenLinks: LinkSignal[]
  unisexLinks: LinkSignal[]
  suggested: Scope | null
  suggestionRule: string | null
}

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN

const OUTPUT = path.resolve("data/brand-gender-homepage-audit.json")
const CONCURRENCY = 30
const TIMEOUT_MS = 8_000
const MAX_BYTES = 2_000_000

function homepage(wiki: BrandRow["wiki"]): string | null {
  for (const key of ["homepage_url", "homepage", "official_url", "website"]) {
    const value = wiki?.[key]
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value
  }
  return null
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const MEN = /(?:^|[\s/_?&=.#-])(men|mens|men's|menswear|male|남성)(?:$|[\s/_?&=.#-])/iu
const WOMEN = /(?:^|[\s/_?&=.#-])(women|womens|women's|womenswear|female|ladies|lady|여성)(?:$|[\s/_?&=.#-])/iu
const UNISEX = /(?:^|[\s/_?&=.#-])(unisex|genderless|gender-neutral|gender_neutral|공용|유니섹스)(?:$|[\s/_?&=.#-])/iu

function uniqueSignals(signals: LinkSignal[]): LinkSignal[] {
  const seen = new Set<string>()
  return signals.filter((signal) => {
    const key = `${signal.href}\n${signal.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 12)
}

export function extractHomepageSignals(html: string): {
  title: string | null
  menLinks: LinkSignal[]
  womenLinks: LinkSignal[]
  unisexLinks: LinkSignal[]
  suggested: Scope | null
  suggestionRule: string | null
} {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)
  const title = titleMatch ? decodeHtml(titleMatch[1]) : null
  const menLinks: LinkSignal[] = []
  const womenLinks: LinkSignal[] = []
  const unisexLinks: LinkSignal[] = []
  const searchableHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
  const anchorPattern = /<a\b([^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*)>([\s\S]*?)<\/a>/giu

  for (const match of searchableHtml.matchAll(anchorPattern)) {
    const href = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "")
    const text = decodeHtml(match[5] ?? "")
    const haystack = `${href} ${text}`.normalize("NFKC")
    const signal = {href, text}
    const exactMan = text.trim().toLowerCase() === "man" || /(?:^|\/)man(?:$|[/?#])/iu.test(href)
    if (MEN.test(haystack) || exactMan) menLinks.push(signal)
    if (WOMEN.test(haystack)) womenLinks.push(signal)
    const collectionLevel = /(?:^|\/)(collections?|categories|category|pages?|gender|shop)(?:\/|$)/iu.test(href)
    const exactUnisex = /^(unisex|genderless|gender[- ]neutral|공용|유니섹스)$/iu.test(text.trim())
    if (UNISEX.test(haystack) && (collectionLevel || exactUnisex)) unisexLinks.push(signal)
  }

  const uniqueMen = uniqueSignals(menLinks)
  const uniqueWomen = uniqueSignals(womenLinks)
  const uniqueUnisex = uniqueSignals(unisexLinks)
  if (uniqueMen.length > 0 && uniqueWomen.length > 0) {
    return {title, menLinks: uniqueMen, womenLinks: uniqueWomen, unisexLinks: uniqueUnisex, suggested: "unisex", suggestionRule: "official_navigation_men_and_women"}
  }
  if (uniqueUnisex.length > 0) {
    return {title, menLinks: uniqueMen, womenLinks: uniqueWomen, unisexLinks: uniqueUnisex, suggested: "unisex", suggestionRule: "official_navigation_unisex"}
  }
  return {title, menLinks: uniqueMen, womenLinks: uniqueWomen, unisexLinks: uniqueUnisex, suggested: null, suggestionRule: null}
}

async function fetchHomepage(brand: BrandRow, url: string): Promise<HomepageEvidence> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; kiko-brand-audit/1.0; +https://kiko.ai)",
        accept: "text/html,application/xhtml+xml",
      },
    })
    const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, MAX_BYTES)
    const html = bytes.toString("utf8")
    const signals = extractHomepageSignals(html)
    return {
      brandId: brand.id,
      brandName: brand.brand_name,
      current: brand.gender_scope,
      url,
      finalUrl: response.url || url,
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      ...signals,
    }
  } catch (error) {
    return {
      brandId: brand.id,
      brandName: brand.brand_name,
      current: brand.gender_scope,
      url,
      finalUrl: null,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      title: null,
      menLinks: [],
      womenLinks: [],
      unisexLinks: [],
      suggested: null,
      suggestionRule: null,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function loadBrands(): Promise<BrandRow[]> {
  const db = createClient(dbUrl!, dbToken!)
  const rows: BrandRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const {data, error} = await db.from("brand_nodes").select("id,brand_name,gender_scope,wiki").order("id").range(offset, offset + 999)
    if (error) throw error
    rows.push(...data as BrandRow[])
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main(): Promise<void> {
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
  console.log("loading brand_nodes")
  const brands = await loadBrands()
  const targets = brands.flatMap((brand) => {
    const url = homepage(brand.wiki)
    return url ? [{brand, url}] : []
  })
  const evidence: HomepageEvidence[] = new Array(targets.length)
  console.log(`targets ${targets.length}/${brands.length}`)
  let cursor = 0
  let completed = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++
      if (index >= targets.length) return
      const target = targets[index]
      evidence[index] = await fetchHomepage(target.brand, target.url)
      completed++
      if (completed % 25 === 0 || completed === targets.length) console.log(`progress ${completed}/${targets.length}`)
    }
  }
  const workers = Promise.all(Array.from({length: CONCURRENCY}, () => worker()))
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(resolve, 6 * 60_000)
    workers.then(() => {
      clearTimeout(deadline)
      resolve()
    }, (error) => {
      clearTimeout(deadline)
      throw error
    })
  })
  for (let index = 0; index < targets.length; index++) {
    if (evidence[index]) continue
    const target = targets[index]
    evidence[index] = {
      brandId: target.brand.id,
      brandName: target.brand.brand_name,
      current: target.brand.gender_scope,
      url: target.url,
      finalUrl: null,
      status: null,
      error: "global_timeout",
      title: null,
      menLinks: [],
      womenLinks: [],
      unisexLinks: [],
      suggested: null,
      suggestionRule: null,
    }
  }

  const currentToken = (value: unknown): Scope | null => Array.isArray(value) && value.length === 1 && ["men", "women", "unisex"].includes(value[0]) ? value[0] as Scope : null
  const contradictions = evidence.filter((item) => item.suggested && item.suggested !== currentToken(item.current))
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      brands: brands.length,
      targets: targets.length,
      fetchedOk: evidence.filter((item) => item.status !== null && item.status >= 200 && item.status < 300).length,
      failed: evidence.filter((item) => item.error).length,
      officialMixedOrUnisex: evidence.filter((item) => item.suggested === "unisex").length,
      contradictions: contradictions.length,
    },
    contradictions,
    evidence,
  }
  fs.mkdirSync(path.dirname(OUTPUT), {recursive: true})
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.totals, null, 2))
  console.log(`report: ${OUTPUT}`)
  process.exitCode = 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  await main()
}
