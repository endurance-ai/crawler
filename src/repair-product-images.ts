/**
 * Revisit registered product detail pages and atomically replace legacy image
 * pools with product-owned candidates. Dry-run by default; --apply --all writes.
 *
 * Examples:
 *   pnpm repair:product-images -- --site=roughside --limit=20
 *   pnpm repair:product-images -- --apply --all --concurrency=3
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"
import {chromium, type Page} from "playwright"
import {getSiteConfig, PLATFORMS} from "./configs/platforms"
import {gotoWithRetry} from "./lib/nav-retry"
import {
  collectProductImagesFromPage,
  extractShopifyProductImages,
  mergeProductImages,
} from "./lib/product-images"
import {checkRobots} from "./lib/robots-check"

interface ProductRow {
  id: number
  product_url: string
  image_url: string | null
  source_image_url: string | null
  images: string[] | null
  platform: string
  image_selection_version: string | null
}

interface CollectedRow {
  row: ProductRow
  images: string[]
  error?: string
}

interface CheckpointEntry {
  id: number
  platform: string
  status: "updated" | "unchanged"
  image_count: number
  at: string
}

function argValue(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return exact?.slice(name.length + 3)
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(argValue(name) ?? fallback)
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
  return value
}

function loadCompleted(checkpointPath: string): Set<number> {
  if (!fs.existsSync(checkpointPath)) return new Set()
  const completed = new Set<number>()
  for (const line of fs.readFileSync(checkpointPath, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as Partial<CheckpointEntry>
      if (typeof entry.id === "number" && (entry.status === "updated" || entry.status === "unchanged")) {
        completed.add(entry.id)
      }
    } catch {
      // A process may be killed while appending the last line. Earlier lines
      // remain valid, and the incomplete item is safely retried.
    }
  }
  return completed
}

function sameUrls(current: string[] | null, next: string[]): boolean {
  return (current ?? []).length === next.length && (current ?? []).every((url, index) => url === next[index])
}

function safeProductUrl(row: ProductRow): boolean {
  const config = getSiteConfig(row.platform)
  if (!config) return false
  try {
    const productHost = new URL(row.product_url).hostname.toLowerCase()
    const baseHost = new URL(config.baseUrl).hostname.toLowerCase()
    return productHost === baseHost || productHost.endsWith(`.${baseHost}`) || baseHost.endsWith(`.${productHost}`)
  } catch {
    return false
  }
}

async function collectOne(page: Page, row: ProductRow): Promise<CollectedRow> {
  const existing = mergeProductImages(
    row.image_selection_version === "mac-vision-v2" ? row.image_url : row.source_image_url,
    row.product_url,
    row.image_selection_version === "mac-vision-v2" ? row.images : [],
  )
  const config = getSiteConfig(row.platform)

  // These engines already receive complete image sets from their catalogue
  // APIs. A multi-image DB row is therefore authoritative and does not need a
  // slow product-page browser visit.
  if ((config?.type === "uniqlo" || config?.type === "zara") && existing.length > 1) {
    return {row, images: existing}
  }

  // Shopify's public product JSON is both faster and more complete than the
  // rendered gallery. Fall back to Playwright only when the endpoint fails.
  if (config?.type === "shopify") {
    try {
      const endpoint = new URL(row.product_url)
      endpoint.search = ""
      endpoint.hash = ""
      endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}.js`
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(15_000),
        headers: {"User-Agent": "Mozilla/5.0 (compatible; kiko-product-image-backfill/1.0)"},
      })
      if (response.ok) {
        const nativeImages = extractShopifyProductImages(await response.json())
        if (nativeImages.length > 0) {
          return {row, images: mergeProductImages(existing[0], row.product_url, existing.slice(1), nativeImages)}
        }
      }
    } catch {
      // Browser fallback below preserves coverage for storefronts that disable
      // the public JSON route or temporarily return a network error.
    }
  }

  const navigation = await gotoWithRetry(page, row.product_url, {
    attempts: 3,
    timeoutMs: 45_000,
    onRetry: (attempt, error) => console.warn(`   retry ${row.id} after attempt ${attempt}: ${error}`),
  })
  if (!navigation.ok) return {row, images: existing, error: navigation.error ?? "navigation failed"}
  await page.waitForTimeout(500)
  try {
    const images = await collectProductImagesFromPage(page, existing)
    return images.length > 0 ? {row, images} : {row, images, error: "no product-owned images found"}
  } catch (error) {
    return {row, images: existing, error: error instanceof Error ? error.message : String(error)}
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--list-sites")) {
    for (const key of [...new Set(PLATFORMS.map((config) => config.key))].sort()) console.log(key)
    return
  }

  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

  const apply = process.argv.includes("--apply")
  const all = process.argv.includes("--all")
  const site = argValue("site")
  const ids = (argValue("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  const limit = argValue("limit") ? positiveInt("limit", 1) : null
  const concurrency = positiveInt("concurrency", 3)
  if (apply && !all && !site && ids.length === 0) {
    throw new Error("writes require --all, --site=<platform>, or --ids=<id,...>")
  }

  const checkpointPath = path.resolve(
    argValue("checkpoint") ?? "data/product-image-backfill/checkpoint.jsonl",
  )
  const completed = apply ? loadCompleted(checkpointPath) : new Set<number>()
  if (apply) fs.mkdirSync(path.dirname(checkpointPath), {recursive: true})

  const db = createClient(dbUrl, dbToken)
  const rows: ProductRow[] = []
  const pageSize = 1_000
  for (let offset = 0; ; offset += pageSize) {
    let query = db
      .from("products")
      .select("id,product_url,image_url,source_image_url,images,platform,image_selection_version")
      .order("id", {ascending: true})
      .range(offset, offset + pageSize - 1)
    if (site) query = query.eq("platform", site)
    if (ids.length > 0) query = query.in("id", ids)
    const {data, error} = await query
    if (error) throw new Error(`product query failed: ${error.message}`)
    const pageRows = (data ?? []) as ProductRow[]
    rows.push(...pageRows.filter((row) => !completed.has(row.id) && safeProductUrl(row)))
    if (pageRows.length < pageSize || (limit !== null && rows.length >= limit)) break
  }

  rows.sort((a, b) => {
    const aMissing = (a.images?.length ?? 0) === 0 ? 0 : 1
    const bMissing = (b.images?.length ?? 0) === 0 ? 0 : 1
    return a.platform.localeCompare(b.platform) || aMissing - bMissing || a.id - b.id
  })
  const targets = limit === null ? rows : rows.slice(0, limit)
  console.log(`${apply ? "APPLY" : "DRY-RUN"}: ${targets.length} products, concurrency=${concurrency}`)
  if (targets.length === 0) return

  const browser = await chromium.launch({headless: true})
  let updated = 0
  let unchanged = 0
  let failed = 0
  try {
    for (let start = 0; start < targets.length;) {
      const platform = targets[start].platform
      const end = targets.findIndex((row, index) => index >= start && row.platform !== platform)
      const platformEnd = end === -1 ? targets.length : end
      const platformRows = targets.slice(start, platformEnd)
      start = platformEnd

      const config = getSiteConfig(platform)
      if (!config) continue
      const robots = await checkRobots(config.baseUrl)
      if (!robots.allowed) {
        console.warn(`SKIP ${platform}: ${robots.blockingLine ?? "robots.txt denied"}`)
        continue
      }
      console.log(`[${platform}] ${platformRows.length} products`)

      const contexts = await Promise.all(
        Array.from({length: Math.min(concurrency, platformRows.length)}, async () => {
          const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          })
          await context.route("**/*", async (route) => {
            const kind = route.request().resourceType()
            if (kind === "image" || kind === "media" || kind === "font") await route.abort()
            else await route.continue()
          })
          return {context, page: await context.newPage()}
        }),
      )

      try {
        for (let index = 0; index < platformRows.length; index += contexts.length) {
          const slice = platformRows.slice(index, index + contexts.length)
          const collected = await Promise.all(slice.map((row, worker) => collectOne(contexts[worker].page, row)))
          const successful = collected.filter((item) => !item.error)
          const appliedIds = new Set<number>()
          failed += collected.length - successful.length
          for (const item of collected.filter((entry) => entry.error)) {
            console.warn(`   FAIL ${item.row.id}: ${item.error}`)
          }

          if (apply && successful.length > 0) {
            const selectedAt = new Date().toISOString()
            const {data: applied, error} = await db.rpc("apply_product_image_selections", {
              selections: successful.map((item) => ({
                id: item.row.id,
                before_url: item.row.image_url,
                after_url: item.images[0],
                source_image_url: item.row.source_image_url ?? item.images[0],
                images: item.images,
                kind: "fallback",
                score: 0,
                version: "ownership-repair-v2",
                candidate_count: item.images.length,
                selected_at: selectedAt,
              })),
            })
            if (error) {
              if (!error.message.includes("permission denied for table product_embeddings")) {
                failed += successful.length
                console.error(`   RPC failed: ${error.message}`)
                continue
              }
              const {data: repaired, error: repairError} = await db.rpc("repair_product_image_assets_v2", {
                repairs: successful.map((item) => ({
                  id: String(item.row.id), before_url: item.row.image_url,
                  replacement_url: item.images[0], source_image_url: item.row.source_image_url ?? item.images[0],
                  images: item.images, bad_urls: [], mark_out_of_stock: false,
                })),
              })
              if (repairError) {
                failed += successful.length
                console.error(`   repair RPC failed: ${repairError.message}`)
                continue
              }
              for (const result of Array.isArray(repaired) ? repaired : []) {
                if (result?.outcome === "applied") appliedIds.add(Number(result.id))
              }
            } else if (typeof applied === "number" && applied !== successful.length) {
              console.warn(`   optimistic apply skipped ${successful.length - applied}/${successful.length} rows`)
              const {data: verified, error: verifyError} = await db
                .from("products")
                .select("id,image_url,image_selection_version")
                .in("id", successful.map((item) => item.row.id))
              if (verifyError) throw new Error(`apply verification failed: ${verifyError.message}`)
              const expected = new Map(successful.map((item) => [item.row.id, item.images[0]]))
              for (const row of verified ?? []) {
                if (
                  row.image_selection_version === "ownership-repair-v2" &&
                  row.image_url === expected.get(row.id)
                ) appliedIds.add(row.id)
              }
            } else if (!error) {
              for (const item of successful) appliedIds.add(item.row.id)
            }
          }

          for (const item of successful) {
            if (apply && !appliedIds.has(item.row.id)) {
              failed++
              console.warn(`   NOT APPLIED ${item.row.id}: optimistic condition or validation rejected update`)
              continue
            }
            const status = sameUrls(item.row.images, item.images) ? "unchanged" : "updated"
            if (status === "updated") updated++
            else unchanged++
            if (apply) {
              const entry: CheckpointEntry = {
                id: item.row.id,
                platform,
                status,
                image_count: item.images.length,
                at: new Date().toISOString(),
              }
              fs.appendFileSync(checkpointPath, `${JSON.stringify(entry)}\n`)
            }
          }
          process.stdout.write(`\r   ${Math.min(index + contexts.length, platformRows.length)}/${platformRows.length}`)
        }
      } finally {
        await Promise.all(contexts.map(({context}) => context.close()))
      }
      process.stdout.write("\n")
    }
  } finally {
    await browser.close()
  }

  console.log(`done: updated=${updated}, unchanged=${unchanged}, failed=${failed}`)
  if (failed > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
