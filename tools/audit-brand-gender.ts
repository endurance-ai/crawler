/**
 * Audit brand_nodes.gender_scope against evidence that is independent of the
 * current brand fallback. The default mode is read-only and writes a report to
 * data/brand-gender-audit.json.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- tsx tools/audit-brand-gender.ts
 *   pnpm exec dotenv -e .env.local -- tsx tools/audit-brand-gender.ts --fetch-homepages
 *   pnpm exec dotenv -e .env.local -- tsx tools/audit-brand-gender.ts --apply
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
  source_platforms: string[] | null
}

interface HomepageEvidence {
  url: string
  scope: Scope | null
  confidence: number
  signals: string[]
  fetchedAt: string
  error?: string
}

interface Proposal {
  brandId: number
  brandName: string
  before: unknown
  after: Scope[]
  confidence: number
  reason: string
  sources: string[]
}

interface ProductEvidence {
  total: number
  femaleSpecific: number
  trustedMen: number
  trustedWomen: number
  trustedUnisex: number
  platforms: string[]
  officialCrawl: boolean
}

const args = new Set(process.argv.slice(2))
const fetchHomepages = args.has("--fetch-homepages")
const apply = args.has("--apply")
const refreshProducts = args.has("--refresh-products")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

const db = createClient(dbUrl, dbToken)
const repo = path.resolve(import.meta.dirname, "..")
const reportPath = path.join(repo, "data", "brand-gender-audit.json")
const homepageCachePath = path.join(repo, "data", "brand-gender-homepage-cache.json")
const productCachePath = path.join(repo, "data", "brand-gender-product-evidence.json")

function canonicalScope(value: unknown): Scope | null {
  if (!Array.isArray(value)) return null
  const values = new Set(value.map((v) => String(v).trim().toLowerCase()))
  if (values.has("unknown") || values.size === 0) return null
  if (values.has("unisex") || (values.has("men") && values.has("women"))) return "unisex"
  if (values.size === 1 && values.has("men")) return "men"
  if (values.size === 1 && values.has("women")) return "women"
  return null
}

function scopeArray(scope: Scope): Scope[] {
  return [scope]
}

function inferFromText(value: unknown): {scope: Scope | null; confidence: number; signals: string[]} {
  if (typeof value !== "string") return {scope: null, confidence: 0, signals: []}
  const text = value.toLowerCase()
  const women = [
    /(?:^|\W)women(?:'s|s)?(?:wear| clothing| fashion| brand| collection)?(?:\W|$)/i,
    /womenswear/i,
    /여성복|여성 의류|여성 패션|여성 브랜드|우먼웨어/i,
    /レディース|女装/i,
  ].some((r) => r.test(text))
  const men = [
    /(?:^|\W)men(?:'s|s)?(?:wear| clothing| fashion| brand| collection)?(?:\W|$)/i,
    /menswear/i,
    /남성복|남성 의류|남성 패션|남성 브랜드|맨즈웨어/i,
    /メンズ|男装/i,
  ].some((r) => r.test(text))
  const unisex = /unisex|gender[ -]?neutral|젠더리스|성별.?구분.?없|남녀.?공용|공용 브랜드/i.test(text)
  const signals = [women && "women-explicit", men && "men-explicit", unisex && "unisex-explicit"].filter(Boolean) as string[]
  if (unisex || (women && men)) return {scope: "unisex", confidence: 0.9, signals}
  if (women) return {scope: "women", confidence: 0.84, signals}
  if (men) return {scope: "men", confidence: 0.84, signals}
  return {scope: null, confidence: 0, signals: []}
}

function inferFromWiki(wiki: BrandRow["wiki"]): {scope: Scope | null; confidence: number; signals: string[]} {
  if (!wiki) return {scope: null, confidence: 0, signals: []}
  const pieces = [wiki.gender, wiki.category, wiki.categories, wiki.description_ko, wiki.description_original]
  const results = pieces.map((v) => inferFromText(Array.isArray(v) ? v.join(" ") : v)).filter((r) => r.scope)
  if (results.length === 0) return {scope: null, confidence: 0, signals: []}
  const scopes = new Set(results.map((r) => r.scope))
  if (scopes.size !== 1) return {scope: null, confidence: 0, signals: ["wiki-conflict"]}
  return {
    scope: results[0].scope,
    confidence: results.length >= 2 ? 0.9 : results[0].confidence,
    signals: results.flatMap((r) => r.signals),
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
}

function classifyHomepage(url: string, html: string): HomepageEvidence {
  const clean = stripHtml(html)
  const anchors = [...clean.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => `${m[1]} ${m[2].replace(/<[^>]+>/g, " ")}`.toLowerCase())
    .slice(0, 2500)
  const nav = anchors.join("\n")
  const womenNav = /(?:^|[\s/_-])(women|womens|woman|ladies|여성|우먼|レディース|女装)(?:[\s/?#&=_-]|$)/im.test(nav)
  const menNav = /(?:^|[\s/_-])(men|mens|man|남성|맨즈|メンズ|男装)(?:[\s/?#&=_-]|$)/im.test(nav)
  const femaleCategories = ["dress", "dresses", "skirt", "skirts", "blouse", "blouses", "lingerie", "bras", "원피스", "스커트", "블라우스"]
  const femaleHits = femaleCategories.filter((word) => new RegExp(`(?:^|[\\s/_-])${word}(?:[\\s/?#&=_-]|$)`, "im").test(nav))
  const meta = clean.slice(0, 120_000).replace(/<[^>]+>/g, " ")
  const explicit = inferFromText(meta)
  const signals = [
    womenNav && "women-nav",
    menNav && "men-nav",
    ...femaleHits.map((x) => `category:${x}`),
    ...explicit.signals.map((x) => `meta:${x}`),
  ].filter(Boolean) as string[]
  let scope: Scope | null = null
  let confidence = 0
  if (womenNav && menNav) {
    scope = "unisex"
    confidence = 0.98
  } else if (womenNav || menNav) {
    scope = womenNav ? "women" : "men"
    confidence = 0.96
  } else if (explicit.scope) {
    scope = explicit.scope
    confidence = 0.9
  } else if (femaleHits.length >= 2) {
    scope = "women"
    confidence = 0.9
  }
  return {url, scope, confidence, signals, fetchedAt: new Date().toISOString()}
}

function homepageUrl(wiki: BrandRow["wiki"]): string | null {
  if (!wiki) return null
  for (const key of ["homepage_url", "homepage", "official_url", "website"]) {
    const value = wiki[key]
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value
  }
  return null
}

async function loadBrands(): Promise<BrandRow[]> {
  const rows: BrandRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id,brand_name,gender_scope,wiki,source_platforms")
      .order("id")
      .range(offset, offset + 999)
    if (error) throw error
    rows.push(...(data as BrandRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function loadProductEvidence(): Promise<Map<number, ProductEvidence>> {
  if (!refreshProducts && fs.existsSync(productCachePath)) {
    const cached = JSON.parse(fs.readFileSync(productCachePath, "utf8")) as Record<string, ProductEvidence>
    return new Map(Object.entries(cached).map(([id, value]) => [Number(id), value]))
  }

  const officialPlatforms = new Map<number, string>()
  for (let offset = 0; ; offset += 1000) {
    const {data, error} = await db
      .from("product_crawl_status")
      .select("brand_node_id,platform_key")
      .range(offset, offset + 999)
    if (error) throw error
    for (const row of data ?? []) {
      if (row.platform_key) officialPlatforms.set(row.brand_node_id, row.platform_key)
    }
    if (!data || data.length < 1000) break
  }

  const {count, error: countError} = await db.from("products").select("*", {count: "exact", head: true})
  if (countError) throw countError
  const pageCount = Math.ceil((count ?? 0) / 1000)
  const pages: Array<Array<{
    brand_node_id: number | null
    name: string | null
    category: string | null
    gender: unknown
    gender_source: string | null
    platform: string | null
  }>> = new Array(pageCount)
  let cursor = 0
  let completed = 0
  const workers = Array.from({length: 16}, async () => {
    while (cursor < pageCount) {
      const page = cursor++
      const {data, error} = await db
        .from("products")
        .select("brand_node_id,name,category,gender,gender_source,platform")
        .order("id")
        .range(page * 1000, page * 1000 + 999)
      if (error) throw error
      pages[page] = data ?? []
      completed++
      if (completed % 25 === 0) console.log(`products ${completed}/${pageCount}`)
    }
  })
  await Promise.all(workers)

  const output: Record<string, ProductEvidence & {platformSet?: Set<string>}> = {}
  const femalePattern = /(?:^|\W)(dress(?:es)?|skirt(?:s)?|blouse(?:s)?|lingerie|bra(?:s)?|원피스|스커트|블라우스)(?:\W|$)/i
  const untrustedSources = new Set(["unverified_legacy", "repair_brand_scope", "brand_scope"])
  for (const product of pages.flat()) {
    const id = product.brand_node_id
    if (typeof id !== "number") continue
    const evidence = output[String(id)] ??= {
      total: 0,
      femaleSpecific: 0,
      trustedMen: 0,
      trustedWomen: 0,
      trustedUnisex: 0,
      platforms: [],
      officialCrawl: false,
      platformSet: new Set<string>(),
    }
    evidence.total++
    const categoryAndName = `${product.category ?? ""} ${product.name ?? ""}`
    if (femalePattern.test(categoryAndName)) evidence.femaleSpecific++
    if (product.platform) evidence.platformSet!.add(product.platform)
    if (officialPlatforms.get(id) === product.platform) evidence.officialCrawl = true
    if (product.gender_source && !untrustedSources.has(product.gender_source) && Array.isArray(product.gender)) {
      const values = new Set(product.gender.map((v) => String(v).toLowerCase()))
      if (values.has("men")) evidence.trustedMen++
      if (values.has("women")) evidence.trustedWomen++
      if (values.has("unisex")) evidence.trustedUnisex++
    }
  }
  for (const evidence of Object.values(output)) {
    evidence.platforms = [...evidence.platformSet!]
    delete evidence.platformSet
  }
  fs.writeFileSync(productCachePath, JSON.stringify(output, null, 2))
  return new Map(Object.entries(output).map(([id, value]) => [Number(id), value]))
}

async function fetchEvidence(brands: BrandRow[]): Promise<Map<number, HomepageEvidence>> {
  const cached = fs.existsSync(homepageCachePath)
    ? JSON.parse(fs.readFileSync(homepageCachePath, "utf8")) as Record<string, HomepageEvidence>
    : {}
  if (!fetchHomepages) return new Map(Object.entries(cached).map(([id, v]) => [Number(id), v]))

  const targets = brands.filter((b) => homepageUrl(b.wiki) && !cached[String(b.id)])
  let cursor = 0
  let completed = 0
  const workers = Array.from({length: 48}, async () => {
    while (cursor < targets.length) {
      const brand = targets[cursor++]
      const url = homepageUrl(brand.wiki)!
      try {
        const response = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(7_000),
          headers: {"user-agent": "Mozilla/5.0 (compatible; KikoBrandAudit/1.0)"},
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const html = (await response.text()).slice(0, 2_000_000)
        cached[String(brand.id)] = classifyHomepage(response.url, html)
      } catch (error) {
        cached[String(brand.id)] = {
          url,
          scope: null,
          confidence: 0,
          signals: [],
          fetchedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }
      }
      completed++
      if (completed % 100 === 0) {
        fs.writeFileSync(homepageCachePath, JSON.stringify(cached, null, 2))
        console.log(`homepage ${completed}/${targets.length}`)
      }
    }
  })
  await Promise.all(workers)
  fs.writeFileSync(homepageCachePath, JSON.stringify(cached, null, 2))
  return new Map(Object.entries(cached).map(([id, v]) => [Number(id), v]))
}

function chooseProposal(
  brand: BrandRow,
  homepage: HomepageEvidence | undefined,
  products: ProductEvidence | undefined,
): Proposal | null {
  const before = canonicalScope(brand.gender_scope)
  const hasManualVerification = Boolean(
    before &&
    brand.wiki &&
    typeof brand.wiki.gender_verified_at === "string" &&
    typeof brand.wiki.gender_confidence === "number" &&
    brand.wiki.gender_confidence >= 0.95 &&
    Array.isArray(brand.wiki.gender_sources) &&
    brand.wiki.gender_sources.length > 0,
  )
  if (hasManualVerification) return null

  const wiki = inferFromWiki(brand.wiki)
  let scope: Scope | null = null
  let confidence = 0
  let reason = ""
  const sources: string[] = []

  if (homepage?.scope && homepage.confidence >= 0.9) {
    scope = homepage.scope
    confidence = homepage.confidence
    reason = homepage.signals.join(", ")
    sources.push(homepage.url)
  } else if (
    products?.officialCrawl &&
    products.total >= 10 &&
    products.femaleSpecific >= 5 &&
    products.femaleSpecific / products.total >= 0.08 &&
    (wiki.scope !== "men" ||
      (products.femaleSpecific >= 10 && products.femaleSpecific / products.total >= 0.15))
  ) {
    scope = "women"
    confidence = 0.93
    reason = `official-products:female-specific=${products.femaleSpecific}/${products.total}`
    const url = homepageUrl(brand.wiki)
    if (url) sources.push(url)
  } else if (
    products &&
    products.trustedMen >= 3 &&
    products.trustedWomen >= 3
  ) {
    scope = "unisex"
    confidence = 0.92
    reason = `product-gender:men=${products.trustedMen},women=${products.trustedWomen}`
  } else if (!before && wiki.scope && wiki.confidence >= 0.9) {
    // Wiki-only evidence may fill invalid/missing data, but must never overwrite
    // an existing valid scope without independent homepage confirmation.
    scope = wiki.scope
    confidence = wiki.confidence
    reason = wiki.signals.join(", ")
    const urls = Array.isArray(brand.wiki?.sources) ? brand.wiki.sources : []
    for (const item of urls) {
      if (item && typeof item === "object" && typeof (item as {url?: unknown}).url === "string") {
        sources.push((item as {url: string}).url)
      }
    }
  }

  if (!scope || scope === before) return null
  return {
    brandId: brand.id,
    brandName: brand.brand_name,
    before: brand.gender_scope,
    after: scopeArray(scope),
    confidence,
    reason,
    sources,
  }
}

async function applyProposals(proposals: Proposal[]): Promise<void> {
  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i]
    const {data: current, error: readError} = await db
      .from("brand_nodes")
      .select("wiki")
      .eq("id", proposal.brandId)
      .single()
    if (readError) throw readError
    const wiki = (current?.wiki && typeof current.wiki === "object" ? current.wiki : {}) as Record<string, unknown>
    const gender = proposal.after[0] === "women" ? "\uC5EC\uC131" : proposal.after[0] === "men" ? "\uB0A8\uC131" : "\uACF5\uC6A9"
    const nextWiki = {
      ...wiki,
      gender,
      gender_verified_at: new Date().toISOString(),
      gender_confidence: proposal.confidence,
      gender_sources: proposal.sources,
    }
    const {error} = await db
      .from("brand_nodes")
      .update({gender_scope: proposal.after, wiki: nextWiki})
      .eq("id", proposal.brandId)
    if (error) throw error
    if ((i + 1) % 50 === 0) console.log(`updated ${i + 1}/${proposals.length}`)
  }
}

async function main(): Promise<void> {
  const brands = await loadBrands()
  const [evidence, productEvidence] = await Promise.all([fetchEvidence(brands), loadProductEvidence()])
  const proposals = brands
    .map((brand) => chooseProposal(brand, evidence.get(brand.id), productEvidence.get(brand.id)))
    .filter((p): p is Proposal => p !== null)
  const invalid = brands.filter((b) => canonicalScope(b.gender_scope) === null)
  const scopeDistribution = brands.reduce<Record<string, number>>((counts, brand) => {
    const scope = canonicalScope(brand.gender_scope) ?? "invalid_or_not_applicable"
    counts[scope] = (counts[scope] ?? 0) + 1
    return counts
  }, {})
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    totals: {
      brands: brands.length,
      homepageUrls: brands.filter((b) => homepageUrl(b.wiki)).length,
      homepageChecked: evidence.size,
      homepageClassified: [...evidence.values()].filter((e) => e.scope).length,
      brandsWithProducts: productEvidence.size,
      invalidBefore: invalid.length,
      proposals: proposals.length,
      scopeDistribution,
    },
    proposals,
    unresolvedInvalid: invalid
      .filter((brand) => !proposals.some((p) => p.brandId === brand.id))
      .map((b) => ({id: b.id, brandName: b.brand_name, genderScope: b.gender_scope})),
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.totals, null, 2))
  console.log(`report: ${reportPath}`)
  if (apply) {
    await applyProposals(proposals)
    console.log(`applied: ${proposals.length}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
