#!/usr/bin/env npx tsx
/**
 * Repair legacy representative images that are provably shared across brands
 * or are obvious layout/placeholder assets. Dry-run by default.
 *
 * The crawler-provided source_image_url is the only automatic replacement.
 * Ambiguous or unreachable sources are reported but never written. Applying
 * uses apply_product_image_selections, whose before_url check prevents races
 * and whose trigger path invalidates image-derived embeddings/features.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"
import {
  isProductImageUtilityAsset,
  normalizeProductImageUrl,
} from "../src/lib/product-images"

interface ScanRow {
  id: string
  brand: string
  name: string
  platform: string
  product_url: string
  image_url: string | null
  source_image_url: string | null
}

interface FullRow extends ScanRow {
  images: string[] | null
  image_selection_kind: string | null
  image_selection_score: number | null
  image_selection_version: string | null
  image_selection_candidate_count: number | null
  image_selected_at: string | null
}

interface RepairEntry {
  id: string
  brand: string
  name: string
  platform: string
  product_url: string
  reason: "cross-brand-reuse" | "utility-asset"
  before: {
    image_url: string
    source_image_url: string | null
    images: string[]
    kind: string | null
    score: number | null
    version: string | null
    candidate_count: number | null
    selected_at: string | null
  }
  after: {
    image_url: string
    source_image_url: string
    images: string[]
    kind: "fallback"
    score: 0
    version: "ownership-repair-v2"
    candidate_count: 1
    selected_at: string
  }
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

function positiveInt(name: string): number | null {
  const raw = argValue(name)
  if (raw === null) return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
  return value
}

async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({length: Math.min(concurrency, Math.max(1, items.length))}, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      output[index] = await worker(items[index])
    }
  }))
  return output
}

async function remoteImageExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-1023",
        "User-Agent": "Mozilla/5.0 (compatible; kiko-image-repair/2.0)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    })
    const type = response.headers.get("content-type")?.toLowerCase() ?? ""
    await response.body?.cancel()
    return response.ok && (
      type.startsWith("image/") ||
      (type === "application/octet-stream" && /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i.test(url))
    )
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
  const apply = process.argv.includes("--apply")
  const skipRemoteCheck = process.argv.includes("--skip-remote-check")
  const platform = argValue("platform")
  const limit = positiveInt("limit")
  const db = createClient(dbUrl, dbToken)

  const scanRows: ScanRow[] = []
  const pageSize = 1_000
  for (let offset = 0; ; offset += pageSize) {
    let query = db
      .from("products")
      .select("id,brand,name,platform,product_url,image_url,source_image_url")
      .eq("image_selection_version", "mac-vision-v1")
      .order("id")
      .range(offset, offset + pageSize - 1)
    if (platform) query = query.eq("platform", platform)
    const {data, error} = await query
    if (error) throw new Error(`scan failed: ${error.message}`)
    const rows = (data ?? []) as unknown as ScanRow[]
    scanRows.push(...rows)
    if (rows.length < pageSize) break
  }

  const bySelected = new Map<string, ScanRow[]>()
  for (const row of scanRows) {
    if (!row.image_url) continue
    const group = bySelected.get(row.image_url) ?? []
    group.push(row)
    bySelected.set(row.image_url, group)
  }
  const reasons = new Map<string, RepairEntry["reason"]>()
  for (const row of scanRows) {
    if (!row.image_url || row.image_url === row.source_image_url) continue
    if (isProductImageUtilityAsset(row.image_url, row.product_url)) {
      reasons.set(String(row.id), "utility-asset")
      continue
    }
    const group = bySelected.get(row.image_url) ?? []
    if (new Set(group.map((item) => item.brand.trim().toLowerCase())).size > 1) {
      reasons.set(String(row.id), "cross-brand-reuse")
    }
  }

  const targetIds = [...reasons.keys()].slice(0, limit ?? Number.MAX_SAFE_INTEGER)
  const fullRows: FullRow[] = []
  for (let start = 0; start < targetIds.length; start += 100) {
    const ids = targetIds.slice(start, start + 100)
    const {data, error} = await db
      .from("products")
      .select("id,brand,name,platform,product_url,image_url,source_image_url,images,image_selection_kind,image_selection_score,image_selection_version,image_selection_candidate_count,image_selected_at")
      .in("id", ids)
    if (error) throw new Error(`target fetch failed: ${error.message}`)
    fullRows.push(...((data ?? []) as unknown as FullRow[]))
  }

  const candidates = fullRows.flatMap((row) => {
    const source = normalizeProductImageUrl(row.source_image_url, row.product_url)
    if (!row.image_url || !source || source === row.image_url) return []
    return [{row, source}]
  })
  const reachable = skipRemoteCheck
    ? candidates.map(() => true)
    : await mapLimit(candidates, 12, ({source}) => remoteImageExists(source))
  const candidateIds = new Set(candidates.map(({row}) => String(row.id)))
  const skippedRows = [
    ...fullRows
      .filter((row) => !candidateIds.has(String(row.id)))
      .map((row) => ({
        id: String(row.id),
        platform: row.platform,
        product_url: row.product_url,
        reason: reasons.get(String(row.id)),
        status: "invalid-source" as const,
        image_url: row.image_url,
        source_image_url: row.source_image_url,
      })),
    ...candidates.flatMap(({row}, index) => reachable[index] ? [] : [{
      id: String(row.id),
      platform: row.platform,
      product_url: row.product_url,
      reason: reasons.get(String(row.id)),
      status: "unreachable-source" as const,
      image_url: row.image_url,
      source_image_url: row.source_image_url,
    }]),
  ]
  const now = new Date().toISOString()
  const repairs: RepairEntry[] = candidates.flatMap(({row, source}, index) => {
    if (!reachable[index]) return []
    return [{
      id: String(row.id),
      brand: row.brand,
      name: row.name,
      platform: row.platform,
      product_url: row.product_url,
      reason: reasons.get(String(row.id))!,
      before: {
        image_url: row.image_url!,
        source_image_url: row.source_image_url,
        images: row.images ?? [],
        kind: row.image_selection_kind,
        score: row.image_selection_score,
        version: row.image_selection_version,
        candidate_count: row.image_selection_candidate_count,
        selected_at: row.image_selected_at,
      },
      after: {
        image_url: source,
        source_image_url: source,
        images: [source],
        kind: "fallback",
        score: 0,
        version: "ownership-repair-v2",
        candidate_count: 1,
        selected_at: now,
      },
    }]
  })

  const runId = now.replace(/[:.]/g, "-")
  const manifestPath = path.resolve(argValue("manifest") ?? `data/image-contamination-repair-${runId}.json`)
  await fs.mkdir(path.dirname(manifestPath), {recursive: true})
  await fs.writeFile(manifestPath, JSON.stringify({
    generated_at: now,
    mode: apply ? "apply" : "dry-run",
    scanned: scanRows.length,
    suspicious: targetIds.length,
    safe: repairs.length,
    skipped_invalid_or_unreachable_source: skippedRows.length,
    skipped_rows: skippedRows,
    repairs,
  }, null, 2))

  let applied = 0
  if (apply) {
    for (let start = 0; start < repairs.length; start += 100) {
      const batch = repairs.slice(start, start + 100).map((entry) => ({
        id: entry.id,
        before_url: entry.before.image_url,
        after_url: entry.after.image_url,
        source_image_url: entry.after.source_image_url,
        images: entry.after.images,
        kind: entry.after.kind,
        score: entry.after.score,
        version: entry.after.version,
        candidate_count: entry.after.candidate_count,
        selected_at: entry.after.selected_at,
      }))
      const {data, error} = await db.rpc("apply_product_image_selections", {selections: batch})
      if (error) throw new Error(`apply failed: ${error.message}`)
      applied += typeof data === "number" ? data : 0
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scanned: scanRows.length,
    suspicious: targetIds.length,
    safe: repairs.length,
    skipped: targetIds.length - repairs.length,
    applied,
    manifest: manifestPath,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
