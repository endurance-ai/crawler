/**
 * Discover domestic official-shop/retailer duplicates after color + image
 * enrichment. Dry-run is the default; --apply writes through the audited
 * pair matcher in sync-catalog.ts. Use --platform after a platform crawl to
 * limit decisions to pairs involving that refreshed platform.
 */
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {createClient} from "@supabase/supabase-js"
import {PLATFORMS} from "./configs/platforms"
import {decideCrossShopMatch} from "./lib/catalog/matching"

const execFileAsync = promisify(execFile)
const RETAILER_PLATFORMS = [
  "8division", "etcseoul", "fr8ight", "havati", "shopamomento", "slowsteadyclub", "sculpstore",
] as const

type ProductRow = {
  id: number | string
  brand_node_id: number | string
  brand: string
  platform: string
  name: string
  category: string | null
  product_url: string
  canonical_variant_id: number | string | null
  image_selection_version: string | null
  image_selected_at: string | null
}

type CandidatePair = {
  official: ProductRow
  retailer: ProductRow
  color: string
  imageDistance: number
  sharedSourceToken: string
}

const arg = (name: string): string | null => {
  const prefix = `--${name}=`
  const value = process.argv.find((entry) => entry.startsWith(prefix))
  return value ? value.slice(prefix.length) : null
}
const apply = process.argv.includes("--apply")
const targetPlatform = arg("platform")
const limit = Number(arg("limit") ?? "0") || 0

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function host(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const parsed = value.map(Number)
    return parsed.every(Number.isFinite) ? parsed : null
  }
  if (typeof value !== "string") return null
  const parsed = value.trim().replace(/^\[/, "").replace(/\]$/, "").split(",").map(Number)
  return parsed.length > 0 && parsed.every(Number.isFinite) ? parsed : null
}

async function fetchPages<T>(factory: (from: number, to: number) => PromiseLike<{data: unknown; error: unknown}>): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const {data, error} = await factory(from, from + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

async function fetchProductsForPlatforms(platforms: readonly string[]): Promise<ProductRow[]> {
  return fetchPages((from, to) => db.from("products")
    .select("id,brand_node_id,brand,platform,name,category,product_url,canonical_variant_id,image_selection_version,image_selected_at")
    .in("platform", [...platforms]).not("brand_node_id", "is", null)
    .order("id", {ascending: true}).range(from, to))
}

async function fetchProductsForBrands(brandIds: Array<number | string>): Promise<ProductRow[]> {
  const rows = new Map<string, ProductRow>()
  for (let offset = 0; offset < brandIds.length; offset += 40) {
    const chunk = brandIds.slice(offset, offset + 40)
    const found = await fetchPages<ProductRow>((from, to) => db.from("products")
      .select("id,brand_node_id,brand,platform,name,category,product_url,canonical_variant_id,image_selection_version,image_selected_at")
      .in("brand_node_id", chunk).order("id", {ascending: true}).range(from, to))
    for (const row of found) rows.set(String(row.id), row)
  }
  return [...rows.values()]
}

async function fetchColors(productIds: Array<number | string>): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (let offset = 0; offset < productIds.length; offset += 400) {
    const {data, error} = await db.from("product_features")
      .select("product_id,feature_metadata").in("product_id", productIds.slice(offset, offset + 400))
    if (error) throw error
    for (const row of data ?? []) {
      const color = row.feature_metadata?.primary_color
      if (typeof color === "string" && color.trim()) result.set(String(row.product_id), color.trim())
    }
  }
  return result
}

async function fetchEmbeddings(productIds: Array<number | string>): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>()
  for (let offset = 0; offset < productIds.length; offset += 100) {
    const {data, error} = await db.from("product_embeddings")
      .select("product_id,embedding").in("product_id", productIds.slice(offset, offset + 100))
    if (error) throw error
    for (const row of data ?? []) {
      const embedding = parseEmbedding(row.embedding)
      if (embedding) result.set(String(row.product_id), embedding)
    }
  }
  return result
}

function preliminaryPairs(officialRows: ProductRow[], retailerRows: ProductRow[]): Array<[ProductRow, ProductRow]> {
  const officialByKey = new Map<string, ProductRow[]>()
  for (const row of officialRows) {
    if (!row.category) continue
    const key = `${row.brand_node_id}:${normalize(row.name)}:${normalize(row.category)}`
    const group = officialByKey.get(key) ?? []
    group.push(row)
    officialByKey.set(key, group)
  }
  const pairs: Array<[ProductRow, ProductRow]> = []
  for (const retailer of retailerRows) {
    if (!retailer.category) continue
    const key = `${retailer.brand_node_id}:${normalize(retailer.name)}:${normalize(retailer.category)}`
    for (const official of officialByKey.get(key) ?? []) {
      if (host(official.product_url) === host(retailer.product_url)) continue
      if (targetPlatform && official.platform !== targetPlatform && retailer.platform !== targetPlatform) continue
      pairs.push([official, retailer])
    }
  }
  return pairs
}

async function discoverCandidates(): Promise<{
  pairs: CandidatePair[]
  preliminary: number
  missingColor: number
  pendingImageSelection: number
  missingEmbedding: number
}> {
  const retailerRows = await fetchProductsForPlatforms(RETAILER_PLATFORMS)
  const brandIds = [...new Set(retailerRows.map((row) => row.brand_node_id))]
  const allOverlapRows = await fetchProductsForBrands(brandIds)
  const configs = new Map(PLATFORMS.map((config) => [config.key, config]))
  const officialRows = allOverlapRows.filter((row) => {
    const config = configs.get(row.platform)
    return !RETAILER_PLATFORMS.includes(row.platform as typeof RETAILER_PLATFORMS[number]) && Boolean(config) && !config?.multiBrand
  })
  const rawPairs = preliminaryPairs(officialRows, retailerRows)
  const pairProductIds = [...new Set(rawPairs.flatMap(([a, b]) => [a.id, b.id]))]
  const colors = await fetchColors(pairProductIds)
  const coloredPairs = rawPairs.filter(([a, b]) => {
    const left = colors.get(String(a.id))
    const right = colors.get(String(b.id))
    return Boolean(left && right && normalize(left) === normalize(right))
  })
  const imageReadyPairs = coloredPairs.filter(([a, b]) =>
    Boolean(a.image_selection_version && a.image_selected_at && b.image_selection_version && b.image_selected_at))
  const coloredProductIds = [...new Set(imageReadyPairs.flatMap(([a, b]) => [a.id, b.id]))]
  const embeddings = await fetchEmbeddings(coloredProductIds)
  const candidates: CandidatePair[] = []
  for (const [official, retailer] of imageReadyPairs) {
    const color = colors.get(String(official.id))!
    const decision = decideCrossShopMatch({
      brandKey: String(official.brand_node_id), name: official.name, category: official.category,
      colorKey: color, platform: official.platform, productUrl: official.product_url,
      imageEmbedding: embeddings.get(String(official.id)), imageReady: true,
    }, {
      brandKey: String(retailer.brand_node_id), name: retailer.name, category: retailer.category,
      colorKey: colors.get(String(retailer.id)), platform: retailer.platform, productUrl: retailer.product_url,
      imageEmbedding: embeddings.get(String(retailer.id)), imageReady: true,
    })
    if (decision.status !== "auto") continue
    candidates.push({
      official, retailer, color,
      imageDistance: Number(decision.evidence.imageDistance),
      sharedSourceToken: String(decision.evidence.sharedSourceToken),
    })
  }
  return {
    pairs: candidates,
    preliminary: rawPairs.length,
    missingColor: rawPairs.length - coloredPairs.length,
    pendingImageSelection: coloredPairs.length - imageReadyPairs.length,
    missingEmbedding: imageReadyPairs.length - candidates.length,
  }
}

async function applyPair(pair: CandidatePair): Promise<void> {
  await execFileAsync(process.execPath, [
    "--import", "tsx", "src/sync-catalog.ts", "--cross-shop-auto-match",
    `--source-product-id=${pair.official.id}`, `--candidate-product-id=${pair.retailer.id}`,
  ], {cwd: process.cwd(), env: process.env, maxBuffer: 2_000_000})
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  }))
}

async function main(): Promise<void> {
  const discovered = await discoverCandidates()
  const selected = limit > 0 ? discovered.pairs.slice(0, limit) : discovered.pairs
  const pending = selected.filter(({official, retailer}) => !(
    official.canonical_variant_id
    && String(official.canonical_variant_id) === String(retailer.canonical_variant_id)
  ))
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run", targetPlatform, preliminary: discovered.preliminary,
    missingColorOrConflict: discovered.missingColor,
    pendingImageSelection: discovered.pendingImageSelection,
    missingEmbeddingOrCorroboration: discovered.missingEmbedding,
    autoCandidates: discovered.pairs.length, selected: selected.length,
    alreadyMapped: selected.filter(({official, retailer}) => official.canonical_variant_id
      && String(official.canonical_variant_id) === String(retailer.canonical_variant_id)).length,
  }, null, 2))
  for (const pair of selected.slice(0, 20)) {
    console.log(`${pair.official.id}\t${pair.retailer.id}\t${pair.official.brand}\t${pair.official.platform}->${pair.retailer.platform}\t${pair.sharedSourceToken}\t${pair.imageDistance}`)
  }
  if (!apply) return
  await runPool(pending, 3, applyPair)
  console.log(`applied=${pending.length}`)
}

main().catch((error) => {
  console.error("cross-shop catalog matching failed", error)
  process.exitCode = 1
})
