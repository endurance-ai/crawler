#!/usr/bin/env npx tsx
/** Read-only representative-image performance/quality canary. Never updates products. */
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

import {createClient} from "@supabase/supabase-js"

import {getSiteConfig} from "../src/configs/platforms"
import {
  compareProductImageCanaryRuns,
  stratifiedProductImageSample,
  type ProductImageCanaryManifest,
  type ProductImageCanaryProductResult,
  type ProductImageCanaryRow,
  type ProductImageCanaryRun,
  type ProductImageManualReview,
} from "../src/lib/product-image-cv-canary"
import {
  LocalProductImageSelector,
  type ProductImageCandidateTiming,
} from "../src/lib/select-product-image"
import type {ProductImageCvTiming} from "../src/lib/product-image-vision-win"
import {PRODUCT_IMAGE_COLLECTION_VERSION} from "../src/lib/product-images"
import type {Product} from "../src/lib/types"

type Flags = Record<string, string | boolean>

function flags(argv: string[]): Flags {
  const result: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq >= 0) result[arg.slice(2, eq)] = arg.slice(eq + 1)
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) result[arg.slice(2)] = argv[++i]
    else result[arg.slice(2)] = true
  }
  return result
}

function textFlag(input: Flags, key: string): string | null {
  const value = input[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function intFlag(input: Flags, key: string, fallback: number): number {
  const value = Number(textFlag(input, key))
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function required(input: Flags, key: string): string {
  const value = textFlag(input, key)
  if (!value) throw new Error(`--${key}=<path> is required`)
  return path.resolve(value)
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), {recursive: true})
  await fs.writeFile(file, JSON.stringify(value, null, 2))
}

function createDb() {
  const url = process.env.DB_URL
  const token = process.env.DB_TOKEN
  if (!url || !token) throw new Error("DB_URL and DB_TOKEN are required")
  return createClient(url, token)
}

async function sample(input: Flags): Promise<void> {
  const out = required(input, "out")
  const limit = intFlag(input, "limit", 300)
  const poolLimit = Math.max(limit, intFlag(input, "pool-limit", 3000))
  const platformTypes = new Set(
    (textFlag(input, "platform-types") ?? "cafe24,shopify,imweb")
      .split(",").map((value) => value.trim()).filter(Boolean),
  )
  const db = createDb()
  const pageSize = 1000
  const candidates: ProductImageCanaryRow[] = []
  for (let offset = 0; offset < poolLimit; offset += pageSize) {
    const {data, error} = await db
      .from("products")
      .select("id,platform,category,product_url,image_url,source_image_url,images")
      .eq("in_stock", true)
      .not("image_url", "is", null)
      .order("crawled_at", {ascending: false})
      .range(offset, Math.min(poolLimit, offset + pageSize) - 1)
    if (error) throw new Error(`sample query failed: ${error.message}`)
    for (const raw of data ?? []) {
      const config = getSiteConfig(String(raw.platform))
      const platformType = config?.type ?? "unknown"
      if (!platformTypes.has(platformType)) continue
      const imageUrl = String(raw.image_url ?? "")
      if (!imageUrl.startsWith("http")) continue
      const images = [...new Set([
        imageUrl,
        ...(Array.isArray(raw.images) ? raw.images.filter((url): url is string => typeof url === "string") : []),
      ])]
      candidates.push({
        id: Number(raw.id),
        platform: String(raw.platform),
        platformType,
        category: String(raw.category ?? "unknown"),
        productUrl: String(raw.product_url),
        imageUrl,
        ...(typeof raw.source_image_url === "string" ? {sourceImageUrl: raw.source_image_url} : {}),
        images,
      })
    }
    if ((data ?? []).length < pageSize) break
  }
  const manifest: ProductImageCanaryManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rows: stratifiedProductImageSample(candidates, limit),
  }
  await writeJson(out, manifest)
  console.log(`sampled ${manifest.rows.length}/${candidates.length} rows -> ${out}`)
}

function asProduct(row: ProductImageCanaryRow): Product {
  return {
    brand: "",
    name: `canary-${row.id}`,
    category: row.category,
    gender: [],
    price: null,
    originalPrice: null,
    salePrice: null,
    priceFormatted: "",
    imageUrl: row.imageUrl,
    sourceImageUrl: row.sourceImageUrl ?? row.imageUrl,
    productUrl: row.productUrl,
    inStock: true,
    platform: row.platform,
    crawledAt: new Date(0).toISOString(),
    images: row.images,
    // The manifest freezes the DB candidate array. Mark it trusted so Linux and
    // Apple analyze the exact same URLs without re-scraping a changing detail page.
    imageCollectionVersion: PRODUCT_IMAGE_COLLECTION_VERSION,
  }
}

async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await worker(items[index])
    }
  }))
  return output
}

async function run(input: Flags): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(required(input, "manifest"), "utf8")) as ProductImageCanaryManifest
  const out = required(input, "out")
  const concurrency = Math.min(4, intFlag(input, "concurrency", 2))
  const ocrWorkers = Math.min(4, intFlag(input, "ocr-workers", 2))
  const rows = manifest.rows.slice(0, intFlag(input, "limit", manifest.rows.length))
  const candidateTimings: ProductImageCandidateTiming[] = []
  const cvTimings: ProductImageCvTiming[] = []
  const cacheDir = path.join(path.dirname(out), `.canary-cache-${process.pid}-${Date.now()}`)
  const selector = new LocalProductImageSelector(cacheDir, {
    ocrWorkerPoolSize: ocrWorkers,
    onCandidateTiming: (timing) => candidateTimings.push(timing),
    onCvTiming: (timing) => cvTimings.push(timing),
  })
  let peakRssBytes = process.memoryUsage().rss
  let peakLoad1 = os.loadavg()[0]
  const sampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
    peakLoad1 = Math.max(peakLoad1, os.loadavg()[0])
  }, 250)
  const cpuStarted = process.cpuUsage()
  const startedAt = performance.now()
  let products: ProductImageCanaryProductResult[]
  try {
    products = await mapLimit(rows, concurrency, async (row) => {
      const productStartedAt = performance.now()
      const result = await selector.select(asProduct(row), {force: true, enrichDetail: false})
      return {
        id: row.id,
        platform: row.platform,
        platformType: row.platformType,
        category: row.category,
        productUrl: row.productUrl,
        beforeUrl: result.beforeUrl,
        selectedUrl: result.afterUrl,
        kind: result.kind,
        score: result.score,
        errors: result.errors,
        candidates: result.candidates,
        wallMs: performance.now() - productStartedAt,
      }
    })
  } finally {
    clearInterval(sampler)
    await selector.close()
    await fs.rm(cacheDir, {recursive: true, force: true})
  }
  const cpu = process.cpuUsage(cpuStarted)
  const result: ProductImageCanaryRun = {
    schemaVersion: 1,
    backend: process.platform === "darwin" ? "apple-vision" : "linux-cv",
    generatedAt: new Date().toISOString(),
    concurrency,
    ocrWorkers: process.platform === "darwin" ? null : ocrWorkers,
    products,
    candidateTimings,
    cvTimings,
    metrics: {
      wallMs: performance.now() - startedAt,
      cpuMs: (cpu.user + cpu.system) / 1000,
      peakRssBytes,
      peakLoad1,
    },
  }
  await writeJson(out, result)
  const analyzed = cvTimings.length
  const cvPhaseSeconds = cvTimings.reduce((sum, timing) => ({
    yolo: sum.yolo + timing.yoloMs / 1000,
    ocr: sum.ocr + timing.ocrMs / 1000,
    foreground: sum.foreground + timing.foregroundMs / 1000,
    aesthetics: sum.aesthetics + timing.aestheticsMs / 1000,
  }), {yolo: 0, ocr: 0, foreground: 0, aesthetics: 0})
  console.log(JSON.stringify({
    products: products.length,
    images: analyzed,
    wallSeconds: result.metrics.wallMs / 1000,
    productsPerMinute: products.length / (result.metrics.wallMs / 60_000),
    imagesPerSecond: analyzed / (result.metrics.wallMs / 1000),
    cpuSeconds: result.metrics.cpuMs / 1000,
    peakRssMb: result.metrics.peakRssBytes / 1024 / 1024,
    peakLoad1: result.metrics.peakLoad1,
    phaseSeconds: {
      download: candidateTimings.reduce((sum, timing) => sum + timing.downloadMs / 1000, 0),
      ...cvPhaseSeconds,
    },
  }, null, 2))
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

async function compare(input: Flags): Promise<void> {
  const linux = JSON.parse(await fs.readFile(required(input, "linux"), "utf8")) as ProductImageCanaryRun
  const apple = JSON.parse(await fs.readFile(required(input, "apple"), "utf8")) as ProductImageCanaryRun
  const reviewPath = textFlag(input, "reviews")
  const reviews = reviewPath
    ? JSON.parse(await fs.readFile(path.resolve(reviewPath), "utf8")) as ProductImageManualReview[]
    : []
  const comparison = compareProductImageCanaryRuns(linux, apple, reviews)
  const out = required(input, "out")
  await writeJson(out, comparison)
  const cards = comparison.pairs.map((row) => `
    <article data-id="${row.id}">
      <h2>${escapeHtml(row.platform)} / ${escapeHtml(row.category)} / #${row.id}</h2>
      <div><figure><img src="${escapeHtml(row.linuxUrl)}"><figcaption>Linux · ${row.linuxKind}</figcaption></figure>
      <figure><img src="${escapeHtml(row.appleUrl)}"><figcaption>Apple · ${row.appleKind}</figcaption></figure></div>
      <select><option value="">review</option><option>acceptable</option><option>linux_better</option>
      <option>wrong_non_model</option><option>severe_utility</option><option>severe_broken</option></select>
      <input placeholder="note"><a href="${escapeHtml(row.productUrl)}">product</a>
    </article>`).join("")
  const html = `<!doctype html><meta charset="utf-8"><title>Linux CV canary</title><style>
body{font:14px system-ui;margin:24px;background:#f5f5f5}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px}
article{background:white;padding:12px;border:1px solid #ddd}article>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}figure{margin:0}img{width:100%;aspect-ratio:3/4;object-fit:contain;background:#eee}select,input,a{margin:8px 4px 0 0}</style>
<h1>Linux CV vs Apple Vision</h1><pre>${escapeHtml(JSON.stringify({...comparison, pairs: undefined}, null, 2))}</pre>
<button id="download">Download reviews.json</button><main class="grid">${cards}</main><script>
document.querySelector('#download').onclick=()=>{const rows=[...document.querySelectorAll('article')].flatMap(a=>{const verdict=a.querySelector('select').value;if(!verdict)return[];return[{productId:Number(a.dataset.id),verdict,note:a.querySelector('input').value}]});const u=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));const x=document.createElement('a');x.href=u;x.download='reviews.json';x.click();URL.revokeObjectURL(u)}
</script>`
  await fs.writeFile(out.replace(/\.json$/i, ".html"), html)
  console.log(`compared ${comparison.compared}; agreement=${(comparison.agreementRate * 100).toFixed(1)}%; severe=${(comparison.automatedSevereRate * 100).toFixed(2)}%`)
}

async function report(input: Flags): Promise<void> {
  const run = JSON.parse(await fs.readFile(required(input, "run"), "utf8")) as ProductImageCanaryRun
  const out = required(input, "out")
  const cards = run.products.map((row) => `
    <article class="${row.errors.length ? "error" : ""}">
      <h2>${escapeHtml(row.platform)} / ${escapeHtml(row.category)} / #${row.id}</h2>
      <div><figure><img src="${escapeHtml(row.beforeUrl)}"><figcaption>before</figcaption></figure>
      <figure><img src="${escapeHtml(row.selectedUrl)}"><figcaption>${row.kind} / ${row.score.toFixed(1)}</figcaption></figure></div>
      <p>candidates=${row.candidates.length} / ${(row.wallMs / 1000).toFixed(1)}s / errors=${row.errors.length}</p>
      <a href="${escapeHtml(row.productUrl)}">product</a>
    </article>`).join("")
  const summary = {
    backend: run.backend,
    products: run.products.length,
    images: run.cvTimings.length,
    wallMinutes: run.metrics.wallMs / 60_000,
    cpuAverageCores: run.metrics.cpuMs / run.metrics.wallMs,
    peakRssMb: run.metrics.peakRssBytes / 1024 / 1024,
    model: run.products.filter((row) => row.kind === "model").length,
    product: run.products.filter((row) => row.kind === "product").length,
    fallback: run.products.filter((row) => row.kind === "fallback").length,
    changed: run.products.filter((row) => row.beforeUrl !== row.selectedUrl).length,
    productsWithErrors: run.products.filter((row) => row.errors.length > 0).length,
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Product image canary report</title><style>
body{font:14px system-ui;margin:24px;background:#f5f5f5}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px}
article{background:white;padding:12px;border:1px solid #ddd}article.error{border-color:#d33}article>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}figure{margin:0}img{width:100%;aspect-ratio:3/4;object-fit:contain;background:#eee}</style>
<h1>${escapeHtml(run.backend)} canary</h1><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre><main class="grid">${cards}</main>`
  await fs.mkdir(path.dirname(out), {recursive: true})
  await fs.writeFile(out, html)
  console.log(`report ${run.products.length} products -> ${out}`)
}

async function main(): Promise<void> {
  const [command = "help", ...argv] = process.argv.slice(2)
  const input = flags(argv)
  if (command === "sample") return sample(input)
  if (command === "run") return run(input)
  if (command === "compare") return compare(input)
  if (command === "report") return report(input)
  console.log(`Usage:
  product-image-cv-canary.ts sample --out=manifest.json [--limit=300 --pool-limit=3000]
  product-image-cv-canary.ts run --manifest=manifest.json --out=linux-c2.json --concurrency=2 --ocr-workers=2 [--limit=200]
  product-image-cv-canary.ts report --run=linux-c2.json --out=linux-c2.html
  product-image-cv-canary.ts compare --linux=linux.json --apple=apple.json --out=comparison.json [--reviews=reviews.json]`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
