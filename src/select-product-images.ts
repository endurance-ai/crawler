#!/usr/bin/env npx tsx
/**
 * 모델컷/제품컷 판별로 `products.image_url` 을 고르는 도구.
 *
 * 수동 실행 전용이다. 어떤 배치·타이머·스케줄에도 자동 배선되어 있지 않으며,
 * macOS 로컬 작업자가 명시적으로 실행한다. DB 적용은 migration 102의 RPC를 통해
 * 대표 이미지가 바뀐 상품의 기존 embedding/VLM feature를 함께 무효화한다.
 *
 * ## 실행 전제
 * - **macOS 전용.** 이미지 분류를 Apple Vision 으로 한다
 *   (`tools/product-image-vision/main.m`, `IMAGE_SELECTION_VERSION="mac-vision-v1"`).
 *   먼저 컴파일해야 하고, 배치 서버(연구실 리눅스)에서는 돌지 않는다.
 *   네이티브 테스트는 `{skip: process.platform !== "darwin"}` 로 가드되어 있어
 *   리눅스 CI 에서는 자동 스킵된다.
 *
 * `image_url` 이 바뀌면 `product_embeddings`와 `product_features`의 해당 행을
 * 삭제해 기존 pending 조회 경로가 다시 처리하도록 한다. 이미지 배열 자체는
 * 수집된 전체 후보를 유지하며 대표 이미지 순서로만 재정렬한다.
 */

import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as path from "node:path"
import {createClient, type SupabaseClient} from "@supabase/supabase-js"
import {chromium, type Browser} from "playwright"

import type {Product} from "./lib/types"
import {IMAGE_SELECTION_VERSION} from "./lib/product-image-selection"
import {
  isProductImageUtilityAsset,
  mergeProductImages,
  normalizeProductImageUrl,
} from "./lib/product-images"
import {
  LocalProductImageSelector,
  type ProductImageSelectionResult,
} from "./lib/select-product-image"
import {validateRemoteUrl} from "./lib/safe-remote-image"

type Flags = Record<string, string | boolean>

interface DbProductRow {
  id: string
  brand: string
  name: string
  category: string
  price: number | null
  original_price: number | null
  sale_price: number | null
  source_price: number | null
  source_currency: string | null
  image_url: string | null
  source_image_url: string | null
  product_url: string
  in_stock: boolean
  platform: string
  crawled_at: string | null
  images: string[] | null
  image_selection_kind: string | null
  image_selection_score: number | null
  image_selection_version: string | null
  image_selection_candidate_count: number | null
  image_selected_at: string | null
}

interface SelectionManifestRow {
  id?: string
  product_url: string
  platform: string
  before_url: string
  after_url: string
  source_image_url: string
  images: string[]
  kind: string
  score: number
  version: string
  candidate_count: number
  selected_at: string
  errors: string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]
    if (!value.startsWith("--")) continue
    const eq = value.indexOf("=")
    if (eq >= 0) {
      flags[value.slice(2, eq)] = value.slice(eq + 1)
    } else {
      const key = value.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) {
        flags[key] = next
        i += 1
      } else {
        flags[key] = true
      }
    }
  }
  return flags
}

function stringFlag(flags: Flags, key: string): string | null {
  const value = flags[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function intFlag(flags: Flags, key: string, fallback: number): number {
  const value = Number(stringFlag(flags, key))
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({length: Math.min(concurrency, Math.max(1, items.length))}, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

class RenderedDetailCollector {
  #browser: Browser | null = null

  async html(url: string): Promise<string> {
    await validateRemoteUrl(url)
    this.#browser ??= await chromium.launch({headless: true})
    const context = await this.#browser.newContext()
    await context.route("**/*", async (route) => {
      const type = route.request().resourceType()
      if (["image", "media", "font", "stylesheet"].includes(type)) return route.abort()
      try {
        await validateRemoteUrl(route.request().url())
        return route.continue()
      } catch {
        return route.abort()
      }
    })
    const page = await context.newPage()
    try {
      await page.goto(url, {waitUntil: "domcontentloaded", timeout: 20_000})
      return await page.content()
    } finally {
      await context.close()
    }
  }

  async close(): Promise<void> {
    await this.#browser?.close()
  }
}

function productFromDb(row: DbProductRow): Product {
  const currency = row.source_currency
  return {
    brand: row.brand,
    name: row.name,
    category: row.category,
    // 이 스크립트는 이미지 선별만 하고 gender 를 읽지도 쓰지도 않는다.
    // Product 타입을 만족시키기 위한 자리끼움 — DB 행의 gender 는 건드리지 않는다.
    gender: [],
    price: row.price,
    originalPrice: row.original_price,
    salePrice: row.sale_price,
    priceFormatted: "",
    imageUrl: row.image_url ?? "",
    sourceImageUrl: row.source_image_url ?? row.image_url ?? "",
    productUrl: row.product_url,
    inStock: row.in_stock,
    platform: row.platform,
    crawledAt: row.crawled_at ?? new Date(0).toISOString(),
    images: row.images ?? undefined,
    sourceCurrency:
      currency === "USD" || currency === "EUR" || currency === "GBP" || currency === "KRW"
        ? currency
        : undefined,
    sourcePrice: row.source_price ?? undefined,
    imageSelection:
      row.image_selection_version && row.image_selected_at
        ? {
            kind:
              row.image_selection_kind === "model" || row.image_selection_kind === "product"
                ? row.image_selection_kind
                : "fallback",
            score: row.image_selection_score ?? 0,
            version: row.image_selection_version,
            candidateCount: row.image_selection_candidate_count ?? 1,
            selectedAt: row.image_selected_at,
          }
        : undefined,
  }
}

function dbRowHasUtilityAsset(row: DbProductRow): boolean {
  return [row.image_url, row.source_image_url, ...(row.images ?? [])].some((url) =>
    isProductImageUtilityAsset(url, row.product_url),
  )
}

function manifestHasUtilityAsset(row: SelectionManifestRow): boolean {
  return [row.after_url, row.source_image_url, ...row.images].some((url) =>
    isProductImageUtilityAsset(url, row.product_url),
  )
}

function utilityCleanupManifest(row: DbProductRow): SelectionManifestRow {
  const afterUrl = normalizeProductImageUrl(row.image_url, row.product_url)
  if (!afterUrl) throw new Error(`utility cleanup requires a valid representative: ${row.id}`)
  const images = mergeProductImages(afterUrl, row.product_url, row.images)
  const sourceImageUrl = normalizeProductImageUrl(row.source_image_url, row.product_url) ?? afterUrl
  const kind = row.image_selection_kind === "model" || row.image_selection_kind === "product"
    ? row.image_selection_kind
    : "fallback"
  return {
    id: row.id,
    product_url: row.product_url,
    platform: row.platform,
    before_url: afterUrl,
    after_url: afterUrl,
    source_image_url: sourceImageUrl,
    images,
    kind,
    score: Math.max(0, Math.min(100, row.image_selection_score ?? 0)),
    version: "utility-cleanup-v1",
    candidate_count: images.length,
    selected_at: new Date().toISOString(),
    errors: [],
  }
}

function manifestRow(
  result: ProductImageSelectionResult,
  id?: string,
): SelectionManifestRow {
  const selection = result.product.imageSelection!
  return {
    ...(id ? {id} : {}),
    product_url: result.product.productUrl,
    platform: result.product.platform,
    before_url: result.beforeUrl,
    after_url: result.afterUrl,
    source_image_url: result.product.sourceImageUrl ?? result.beforeUrl,
    images: result.product.images ?? [result.afterUrl],
    kind: selection.kind,
    score: selection.score,
    version: selection.version,
    candidate_count: selection.candidateCount,
    selected_at: selection.selectedAt,
    errors: result.errors,
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function writeReport(
  reportBase: string,
  rows: SelectionManifestRow[],
  skipped: number,
  totals?: {
    processed: number
    changed: number
    model: number
    product: number
    fallback: number
    errors: number
  },
): Promise<void> {
  const summary = {
    version: IMAGE_SELECTION_VERSION,
    processed: totals?.processed ?? rows.length,
    skipped,
    changed: totals?.changed ?? rows.filter((row) => row.before_url !== row.after_url).length,
    model: totals?.model ?? rows.filter((row) => row.kind === "model").length,
    product: totals?.product ?? rows.filter((row) => row.kind === "product").length,
    fallback: totals?.fallback ?? rows.filter((row) => row.kind === "fallback").length,
    errors: totals?.errors ?? rows.reduce((sum, row) => sum + row.errors.length, 0),
    generated_at: new Date().toISOString(),
  }
  await fsp.writeFile(`${reportBase}.json`, JSON.stringify(summary, null, 2))
  const cards = rows.slice(0, 200).map((row) => `
    <article>
      <div class="images">
        <figure><img src="${escapeHtml(row.before_url)}"><figcaption>before</figcaption></figure>
        <figure><img src="${escapeHtml(row.after_url)}"><figcaption>after</figcaption></figure>
      </div>
      <p>${escapeHtml(row.platform)} · ${escapeHtml(row.kind)} · ${row.score.toFixed(2)}</p>
      <a href="${escapeHtml(row.product_url)}">${escapeHtml(row.product_url)}</a>
    </article>
  `).join("")
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Product image selection report</title>
<style>
body{font:14px system-ui;margin:24px;background:#f5f5f5}header{margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
article{background:white;padding:12px;border:1px solid #ddd}.images{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0}img{width:100%;aspect-ratio:3/4;object-fit:cover;background:#eee}figcaption{text-align:center}
a{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555}
</style>
<header><h1>Product image selection</h1><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre></header>
<main class="grid">${cards}</main>`
  await fsp.writeFile(`${reportBase}.html`, html)
}

async function processProducts(
  products: Product[],
  selector: LocalProductImageSelector,
  renderer: RenderedDetailCollector,
  flags: Flags,
  onProgress?: (done: number, total: number) => void,
): Promise<{products: Product[]; rows: SelectionManifestRow[]; skipped: number}> {
  const force = flags.force === true
  const concurrency = Math.min(intFlag(flags, "concurrency", 2), 4)
  let done = 0
  let skipped = 0
  const rows: SelectionManifestRow[] = []
  const updated = await mapLimit(products, concurrency, async (product) => {
    if (!force && product.imageSelection?.version === IMAGE_SELECTION_VERSION) {
      skipped += 1
      return product
    }
    try {
      const result = await selector.select(product, {
        force,
        enrichDetail: flags["no-detail"] !== true,
        renderDetail:
          flags["no-browser-fallback"] === true ? undefined : (url) => renderer.html(url),
      })
      rows.push(manifestRow(result))
      return result.product
    } catch (error) {
      const selectedAt = new Date().toISOString()
      const candidateCount = Math.max(1, product.images?.length ?? (product.imageUrl ? 1 : 0))
      const fallbackProduct: Product = {
        ...product,
        sourceImageUrl: product.sourceImageUrl ?? product.imageUrl,
        images: product.images ?? [product.imageUrl].filter(Boolean),
        imageSelection: {
          kind: "fallback",
          score: 0,
          version: IMAGE_SELECTION_VERSION,
          candidateCount,
          selectedAt,
        },
      }
      rows.push({
        product_url: product.productUrl,
        platform: product.platform,
        before_url: product.imageUrl,
        after_url: product.imageUrl,
        source_image_url: fallbackProduct.sourceImageUrl ?? product.imageUrl,
        images: fallbackProduct.images ?? [],
        kind: "fallback",
        score: 0,
        version: IMAGE_SELECTION_VERSION,
        candidate_count: candidateCount,
        selected_at: selectedAt,
        errors: [error instanceof Error ? error.message : String(error)],
      })
      return fallbackProduct
    } finally {
      done += 1
      onProgress?.(done, products.length)
    }
  })
  return {products: updated, rows, skipped}
}

async function runFileMode(flags: Flags, selector: LocalProductImageSelector, renderer: RenderedDetailCollector) {
  const site = stringFlag(flags, "site")
  if (!site) throw new Error("file mode requires --site=<platform-key>")
  const dataDir = path.join(process.cwd(), "data")
  const file = path.join(dataDir, `${site}-products.json`)
  if (!fs.existsSync(file)) throw new Error(`crawl artifact not found: ${file}`)
  const products = JSON.parse(await fsp.readFile(file, "utf8")) as Product[]
  const limit = intFlag(flags, "limit", products.length)
  const selected = products.slice(0, limit)
  const untouched = products.slice(limit)
  const result = await processProducts(selected, selector, renderer, flags, (done, total) => {
    process.stdout.write(`\r🖼️  ${site}: ${done}/${total}`)
  })
  process.stdout.write("\n")

  const runId = new Date().toISOString().replace(/[:.]/g, "-")
  const reportBase = path.join(dataDir, `${site}-image-selection-${runId}`)
  await fsp.writeFile(
    `${reportBase}.jsonl`,
    result.rows.map((row) => JSON.stringify(row)).join("\n") + (result.rows.length ? "\n" : ""),
  )
  await writeReport(reportBase, result.rows, result.skipped)

  if (flags["dry-run"] !== true) {
    const temp = `${file}.image-selection.tmp`
    await fsp.writeFile(temp, JSON.stringify([...result.products, ...untouched], null, 2))
    await fsp.rename(temp, file)
    console.log(`✅ 대표 이미지 반영: ${file}`)
  } else {
    console.log("🔎 dry-run: 상품 JSON은 변경하지 않았습니다.")
  }
  console.log(`📊 리포트: ${reportBase}.html`)
}

function createDb(): SupabaseClient {
  const url = process.env.DB_URL
  const token = process.env.DB_TOKEN
  if (!url || !token) throw new Error("DB_URL and DB_TOKEN are required for --from-db")
  return createClient(url, token)
}

const DB_SELECT = [
  "id", "brand", "name", "category", "price", "original_price", "sale_price",
  "source_price", "source_currency", "image_url", "source_image_url", "product_url",
  "in_stock", "platform", "crawled_at", "images",
  "image_selection_kind", "image_selection_score", "image_selection_version",
  "image_selection_candidate_count", "image_selected_at",
].join(",")

async function runDbMode(flags: Flags, selector: LocalProductImageSelector, renderer: RenderedDetailCollector) {
  const db = createDb()
  const site = stringFlag(flags, "site")
  if (!site && flags.all !== true) throw new Error("--from-db requires --site=<key> or --all")
  const limit = intFlag(flags, "limit", Number.MAX_SAFE_INTEGER)
  const pageSize = Math.min(500, limit)
  const dataDir = path.join(process.cwd(), "data")
  const runId = new Date().toISOString().replace(/[:.]/g, "-")
  const label = site ?? "all"
  const reportBase = path.join(dataDir, `${label}-db-image-selection-${runId}`)
  await fsp.mkdir(dataDir, {recursive: true})

  let offset = 0
  let processed = 0
  let skipped = 0
  const reportRows: SelectionManifestRow[] = []
  const totals = {processed: 0, changed: 0, model: 0, product: 0, fallback: 0, errors: 0}
  while (processed < limit) {
    let query = db.from("products").select(DB_SELECT).order("id").range(offset, offset + pageSize - 1)
    if (site) query = query.eq("platform", site)
    const {data, error} = await query
    if (error) throw new Error(`failed to fetch products: ${error.message}`)
    const rows = (data ?? []) as unknown as DbProductRow[]
    if (rows.length === 0) break
    const candidates = flags["utility-only"] === true
      ? rows.filter(dbRowHasUtilityAsset)
      : rows
    const remaining = candidates.slice(0, limit - processed)
    if (remaining.length === 0) {
      offset += rows.length
      if (rows.length < pageSize) break
      continue
    }
    const cleanupRows = flags["utility-only"] === true
      ? remaining.filter((row) => !isProductImageUtilityAsset(row.image_url, row.product_url))
      : []
    const selectionRows = flags["utility-only"] === true
      ? remaining.filter((row) => isProductImageUtilityAsset(row.image_url, row.product_url))
      : remaining
    const products = selectionRows.map(productFromDb)
    const result = await processProducts(products, selector, renderer, flags, (done, total) => {
      process.stdout.write(`\r🖼️  DB ${label}: ${processed + done}/${Math.min(limit, processed + total)}`)
    })
    const manifests = [
      ...cleanupRows.map(utilityCleanupManifest),
      ...result.rows.map((row) => {
        const dbRow = selectionRows.find((item) => item.product_url === row.product_url)
        return {...row, ...(dbRow ? {id: dbRow.id} : {})}
      }),
    ]
    if (manifests.length > 0) {
      await fsp.appendFile(
        `${reportBase}.jsonl`,
        manifests.map((row) => JSON.stringify(row)).join("\n") + "\n",
      )
    }
    reportRows.push(...manifests.slice(0, Math.max(0, 200 - reportRows.length)))
    totals.processed += manifests.length
    totals.changed += manifests.filter((row) => row.before_url !== row.after_url).length
    totals.model += manifests.filter((row) => row.kind === "model").length
    totals.product += manifests.filter((row) => row.kind === "product").length
    totals.fallback += manifests.filter((row) => row.kind === "fallback").length
    totals.errors += manifests.reduce((sum, row) => sum + row.errors.length, 0)
    skipped += result.skipped

    if (flags.apply === true && flags["dry-run"] !== true && manifests.length > 0) {
      const APPLY_BATCH = 100
      const byPlatform = new Map<string, SelectionManifestRow[]>()
      for (const manifest of manifests) {
        const group = byPlatform.get(manifest.platform) ?? []
        group.push(manifest)
        byPlatform.set(manifest.platform, group)
      }
      for (const [platform, group] of byPlatform) {
        const applicable = flags["utility-only"] === true
          ? group.filter((row) => !manifestHasUtilityAsset(row))
          : group
        const rejected = group.length - applicable.length
        if (rejected > 0) {
          console.warn(`\n⚠️  ${platform}: utility asset가 남은 ${rejected}건은 DB 반영에서 제외합니다.`)
        }
        if (applicable.length === 0) continue
        const hardFailures = applicable.filter(
          (row) => row.kind === "fallback" && row.errors.length > 0,
        ).length
        if (hardFailures / applicable.length > 0.2) {
          console.warn(
            `\n⚠️  ${platform}: 이미지 처리 실패율 ${((hardFailures / applicable.length) * 100).toFixed(1)}% > 20% — 이 배치는 DB 반영하지 않습니다.`,
          )
          continue
        }
        for (let i = 0; i < applicable.length; i += APPLY_BATCH) {
          const selections = applicable.slice(i, i + APPLY_BATCH)
          const {data: applied, error: applyError} = await db.rpc(
            "apply_product_image_selections",
            {selections},
          )
          if (applyError) throw new Error(`failed to apply image selections: ${applyError.message}`)
          if (typeof applied === "number" && applied !== selections.length) {
            console.warn(
              `\n⚠️  optimistic apply skipped ${selections.length - applied}/${selections.length} changed rows`,
            )
          }
        }
      }
    }

    processed += remaining.length
    offset += rows.length
    if (rows.length < pageSize) break
  }
  process.stdout.write("\n")
  await writeReport(reportBase, reportRows, skipped, totals)
  console.log(
    flags.apply === true && flags["dry-run"] !== true
      ? `✅ DB 대표 이미지 반영 완료: ${processed}건`
      : `🔎 DB dry-run 완료: ${processed}건 (--apply 없이는 DB를 변경하지 않습니다)`,
  )
  console.log(`📊 리포트: ${reportBase}.html`)
}

async function runRollback(flags: Flags, manifestPath: string): Promise<void> {
  const rows = (await fsp.readFile(path.resolve(manifestPath), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SelectionManifestRow)
  if (rows.length === 0) throw new Error("rollback manifest is empty")

  if (flags["from-db"] === true) {
    if (flags.apply !== true) {
      console.log(`🔎 rollback dry-run: ${rows.length}건 (--apply 없이는 DB를 변경하지 않습니다)`)
      return
    }
    const db = createDb()
    const rollbackRows = rows
      .filter((row): row is SelectionManifestRow & {id: string} => typeof row.id === "string")
      .map((row) => ({
        id: row.id,
        before_url: row.after_url,
        after_url: row.before_url,
        source_image_url: row.source_image_url,
        images: [row.before_url, ...row.images.filter((url) => url !== row.before_url)],
        kind: "fallback",
        score: 0,
        version: `${IMAGE_SELECTION_VERSION}-rollback`,
        candidate_count: Math.max(1, row.candidate_count),
        selected_at: new Date().toISOString(),
      }))
    for (let i = 0; i < rollbackRows.length; i += 100) {
      const batch = rollbackRows.slice(i, i + 100)
      const {error} = await db.rpc("apply_product_image_selections", {selections: batch})
      if (error) throw new Error(`rollback failed: ${error.message}`)
    }
    console.log(`↩️  DB 대표 이미지 롤백 완료: ${rollbackRows.length}건`)
    return
  }

  const site = stringFlag(flags, "site")
  if (!site) throw new Error("file rollback requires --site=<platform-key>")
  const file = path.join(process.cwd(), "data", `${site}-products.json`)
  const products = JSON.parse(await fsp.readFile(file, "utf8")) as Product[]
  const byUrl = new Map(rows.map((row) => [row.product_url, row]))
  let restored = 0
  const updated = products.map((product) => {
    const row = byUrl.get(product.productUrl)
    if (!row || product.imageUrl !== row.after_url) return product
    restored += 1
    return {
      ...product,
      imageUrl: row.before_url,
      sourceImageUrl: row.source_image_url,
      images: [row.before_url, ...row.images.filter((url) => url !== row.before_url)],
      imageSelection: {
        kind: "fallback" as const,
        score: 0,
        version: `${IMAGE_SELECTION_VERSION}-rollback`,
        candidateCount: Math.max(1, row.candidate_count),
        selectedAt: new Date().toISOString(),
      },
    }
  })
  if (flags["dry-run"] === true) {
    console.log(`🔎 file rollback dry-run: ${restored}건`)
    return
  }
  const temp = `${file}.image-selection-rollback.tmp`
  await fsp.writeFile(temp, JSON.stringify(updated, null, 2))
  await fsp.rename(temp, file)
  console.log(`↩️  파일 대표 이미지 롤백 완료: ${restored}건`)
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  if (flags.help === true) {
    console.log(`
Product representative-image selection (macOS 15+ / Apple Vision)

  pnpm select:product-images --site=<key> [--limit=N] [--dry-run] [--force]
  pnpm select:product-images --from-db --site=<key> [--apply] [--limit=N]
  pnpm select:product-images --from-db --all [--apply] [--limit=N]
  pnpm select:product-images --from-db --all --utility-only [--apply] [--force]
  pnpm select:product-images --site=<key> --rollback=<manifest.jsonl>
  pnpm select:product-images --from-db --apply --rollback=<manifest.jsonl>

Options:
  --no-detail             analyze existing imageUrl/images only
  --no-browser-fallback   use static detail HTML only
  --utility-only          process only rows containing known UI/icon assets
  --concurrency=N         product concurrency, default 2 and maximum 4
`)
    return
  }
  const rollback = stringFlag(flags, "rollback")
  if (rollback) {
    await runRollback(flags, rollback)
    return
  }
  const cacheDir = path.join(process.cwd(), "data", ".image-selection")
  const selector = new LocalProductImageSelector(cacheDir)
  const renderer = new RenderedDetailCollector()
  try {
    if (flags["from-db"] === true) {
      await runDbMode(flags, selector, renderer)
    } else {
      await runFileMode(flags, selector, renderer)
    }
  } finally {
    await renderer.close()
    await selector.close()
  }
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
