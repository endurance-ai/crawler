#!/usr/bin/env npx tsx
/**
 * Classify brand_nodes without an official homepage and optionally synchronize
 * deterministic direct-store matches from the crawler config.
 *
 * Default scope is the historical backlog (id <= 5792). Pass --all for every
 * brand node. Dry-run by default; --apply only fills exact direct-store matches.
 */
import {createClient} from "@supabase/supabase-js"
import {PLATFORMS} from "../src/configs/platforms.js"

type BrandRow = {
  id: number
  brand_name: string
  brand_name_normalized: string | null
  source_platforms: string[] | null
  wiki: Record<string, unknown> | null
}

type ProductSourceRow = {
  brand_node_id: number
  platform: string
}

type DirectConfig = {
  key: string
  brand: string
  baseUrl: string
  sourceCurrency: string | null
}

// Crawling can use an international store while brand_node should prefer KR/KRW.
const OFFICIAL_HOMEPAGE_OVERRIDES: Readonly<Record<string, string>> = {
  "en-5267": "https://juntaekim.net",
}

const LEGACY_MAX_ID = 5792
const apply = process.argv.includes("--apply")
const all = process.argv.includes("--all")
const maxId = all ? null : LEGACY_MAX_ID

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function homepage(wiki: BrandRow["wiki"]): string | null {
  for (const key of ["homepage_url", "homepage", "official_url", "website"]) {
    const value = wiki?.[key]
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim()
  }
  return null
}

function normalizeBrand(value: string): string {
  return (value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []).join("")
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

async function loadBrands(): Promise<BrandRow[]> {
  const rows: BrandRow[] = []
  for (let offset = 0; ; offset += 1000) {
    let query = db
      .from("brand_nodes")
      .select("id,brand_name,brand_name_normalized,source_platforms,wiki")
      .order("id")
      .range(offset, offset + 999)
    if (maxId !== null) query = query.lte("id", maxId)
    const {data, error} = await query
    if (error) throw error
    rows.push(...(data as BrandRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function loadProductSources(brandIds: number[]): Promise<Map<number, Set<string>>> {
  const sources = new Map<number, Set<string>>()
  const chunkSize = 100
  for (let start = 0; start < brandIds.length; start += chunkSize) {
    const ids = brandIds.slice(start, start + chunkSize)
    for (let offset = 0; ; offset += 1000) {
      const {data, error} = await db
        .from("products")
        .select("brand_node_id,platform")
        .in("brand_node_id", ids)
        .order("id")
        .range(offset, offset + 999)
      if (error) throw error
      for (const row of data as ProductSourceRow[]) {
        if (!row.brand_node_id || !row.platform) continue
        const values = sources.get(row.brand_node_id) ?? new Set<string>()
        values.add(row.platform)
        sources.set(row.brand_node_id, values)
      }
      if (!data || data.length < 1000) break
    }
  }
  return sources
}

const directConfigs: DirectConfig[] = PLATFORMS
  .filter((config) =>
    Boolean(config.brand) &&
    !config.disabled &&
    !config.multiBrand &&
    isHttpUrl(OFFICIAL_HOMEPAGE_OVERRIDES[config.key] ?? config.baseUrl),
  )
  .map((config) => ({
    key: config.key,
    brand: config.brand!,
    baseUrl: OFFICIAL_HOMEPAGE_OVERRIDES[config.key] ?? config.baseUrl,
    // SiteConfig contract treats an omitted source currency as KRW.
    sourceCurrency: config.sourceCurrency ?? "KRW",
  }))

const brands = await loadBrands()
const missing = brands.filter((row) => !homepage(row.wiki))
const managed = brands.filter((row) =>
  typeof row.wiki?.homepage_verification_note === "string" &&
  row.wiki.homepage_verification_note.startsWith("Synchronized from direct single-brand crawler config"),
)
const sourceIds = [...new Set([...missing, ...managed].map((row) => row.id))]
const sourcesByBrand = await loadProductSources(sourceIds)

const directSync: Array<{brand: BrandRow; config: DirectConfig; platforms: string[]}> = []
const retailerSourced: Array<{brand: BrandRow; platforms: string[]}> = []
const collaborationSourced: Array<{brand: BrandRow; platforms: string[]}> = []
const reviewedNoStandalone: BrandRow[] = []
const noProducts: BrandRow[] = []

for (const brand of missing) {
  // `products` is mutable inventory. `source_platforms` is the durable acquisition
  // provenance and must remain part of the audit after products are sold out/deleted.
  const platforms = [...new Set([
    ...(brand.source_platforms ?? []),
    ...(sourcesByBrand.get(brand.id) ?? []),
  ])].sort()
  if (/\s[x×]\s/i.test(brand.brand_name)) {
    collaborationSourced.push({brand, platforms})
    continue
  }
  if (["social_only_no_standalone_site", "duplicate_node"].includes(String(brand.wiki?.homepage_review_status ?? ""))) {
    reviewedNoStandalone.push(brand)
    continue
  }
  if (platforms.length === 0) {
    noProducts.push(brand)
    continue
  }
  const brandKey = normalizeBrand(brand.brand_name_normalized || brand.brand_name)
  const matches = directConfigs.filter((config) =>
    platforms.includes(config.key) && normalizeBrand(config.brand) === brandKey,
  )
  const uniqueUrls = [...new Set(matches.map((match) => match.baseUrl))]
  if (matches.length > 0 && uniqueUrls.length === 1) {
    directSync.push({brand, config: matches[0], platforms})
  } else {
    retailerSourced.push({brand, platforms})
  }
}

const snapshotAt = new Date().toISOString()
console.log(JSON.stringify({
  snapshotAt,
  mode: apply ? "apply" : "dry-run",
  scope: maxId === null ? "all brand_nodes" : `brand_nodes.id <= ${maxId}`,
  totalNodes: brands.length,
  withHomepage: brands.length - missing.length,
  missingHomepage: missing.length,
  classification: {
    directStoreSyncRequired: directSync.length,
    retailerOrOtherProductSourceHomepageOptional: retailerSourced.length,
    collaborationNodeHomepageOptional: collaborationSourced.length,
    reviewedNoStandaloneHomepage: reviewedNoStandalone.length,
    noProductsHomepageResearchRequired: noProducts.length,
  },
  rule: "Current product platforms and durable brand_node.source_platforms are merged. Collaboration names are optional. A sync target requires an enabled config whose explicit brand exactly normalizes to the brand_node name; all multi-brand/retailer sources are optional.",
}, null, 2))

for (const item of directSync) {
  console.log(`DIRECT_SYNC\t${item.brand.id}\t${item.brand.brand_name}\t${item.platforms.join(",")}\t${item.config.baseUrl}`)
}

if (apply) {
  for (const item of directSync) {
    const wiki = item.brand.wiki && typeof item.brand.wiki === "object" ? item.brand.wiki : {}
    const nextWiki = {
      ...wiki,
      homepage_url: item.config.baseUrl,
      homepage_verified_at: snapshotAt,
      homepage_sources: [item.config.baseUrl],
      homepage_storefront: item.config.sourceCurrency === "KRW" ? "KR" : "GLOBAL",
      ...(item.config.sourceCurrency ? {homepage_currency: item.config.sourceCurrency} : {}),
      homepage_verification_note:
        `Synchronized from direct single-brand crawler config '${item.config.key}'; ` +
        "products exist from the same platform. Multi-brand store sources are excluded.",
    }
    const {data, error} = await db
      .from("brand_nodes")
      .update({wiki: nextWiki})
      .eq("id", item.brand.id)
      .filter("wiki->>homepage_url", "is", null)
      .select("id")
    if (error) throw error
    console.log(`${data?.length ? "APPLIED" : "SKIPPED_CHANGED"}\t${item.brand.id}\t${item.brand.brand_name}`)
  }

  // Reconcile values managed by this tool. This also removes a homepage when
  // a config is subsequently identified as a multi-brand retailer.
  for (const brand of managed) {
    const platforms = [...(sourcesByBrand.get(brand.id) ?? [])]
    const brandKey = normalizeBrand(brand.brand_name_normalized || brand.brand_name)
    const config = directConfigs.find((candidate) =>
      platforms.includes(candidate.key) && normalizeBrand(candidate.brand) === brandKey,
    )
    const wiki = brand.wiki && typeof brand.wiki === "object" ? brand.wiki : {}
    if (!config) {
      const {
        homepage_url: _homepageUrl,
        homepage_verified_at: _verifiedAt,
        homepage_sources: _sources,
        homepage_storefront: _storefront,
        homepage_currency: _currency,
        homepage_verification_note: _note,
        ...restWiki
      } = wiki
      const {error} = await db.from("brand_nodes").update({wiki: restWiki}).eq("id", brand.id)
      if (error) throw error
      console.log(`RECLASSIFIED_RETAILER\t${brand.id}\t${brand.brand_name}`)
      continue
    }
    const {error} = await db
      .from("brand_nodes")
      .update({wiki: {
        ...wiki,
        homepage_url: config.baseUrl,
        homepage_sources: [config.baseUrl],
        homepage_storefront: config.sourceCurrency === "KRW" ? "KR" : "GLOBAL",
        homepage_currency: config.sourceCurrency,
      }})
      .eq("id", brand.id)
    if (error) throw error
    console.log(`METADATA_SYNCED\t${brand.id}\t${brand.brand_name}`)
  }
}

for (const item of retailerSourced) {
  console.log(`HOMEPAGE_OPTIONAL\t${item.brand.id}\t${item.brand.brand_name}\t${item.platforms.join(",")}`)
}
for (const item of collaborationSourced) {
  console.log(`COLLABORATION_OPTIONAL\t${item.brand.id}\t${item.brand.brand_name}\t${item.platforms.join(",")}`)
}
for (const brand of reviewedNoStandalone) {
  console.log(`REVIEWED_NO_STANDALONE\t${brand.id}\t${brand.brand_name}\t${String(brand.wiki?.homepage_review_status ?? "")}`)
}
for (const brand of noProducts) {
  console.log(`HOMEPAGE_RESEARCH\t${brand.id}\t${brand.brand_name}`)
}
