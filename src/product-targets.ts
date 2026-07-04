#!/usr/bin/env npx tsx
/**
 * Product collection target queue CLI.
 *
 * Examples:
 *   pnpm product-targets -- list --planner-status=product_collection_requested
 *   pnpm product-targets -- add --brand="Matteveil" --url=https://matteveil.kr --gender=women --price-band=mid
 *   pnpm product-targets -- request --id=1
 *   pnpm product-targets -- detect --requested
 *   pnpm product-targets -- qc --id=1
 */

import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

import {
  createProductCollectionClient,
  finishProductRun,
  loadProductTarget,
  startProductRun,
  updateProductTarget,
  type ProductCollectionTarget,
} from "./lib/product-collection"

type Flags = Record<string, string | boolean>

interface DetectResult {
  platform_type: "cafe24" | "shopify" | "custom"
  category_discovery: "manual" | "auto"
  platform_key: string
  categories: Array<Record<string, unknown>>
  detection: Record<string, unknown>
}

interface CrawledProduct {
  category?: unknown
  color?: unknown
  price?: unknown
  imageUrl?: unknown
  images?: unknown
  inStock?: unknown
}

function parseArgs(argv: string[]): {command: string; flags: Flags} {
  const [command = "help", ...rest] = argv
  const flags: Flags = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else {
      const key = arg.slice(2)
      const next = rest[i + 1]
      if (next && !next.startsWith("--")) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    }
  }
  return {command, flags}
}

function stringFlag(flags: Flags, key: string): string | null {
  const value = flags[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberFlag(flags: Flags, key: string): number | null {
  const value = stringFlag(flags, key)
  if (!value) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function splitFlag(flags: Flags, key: string): string[] {
  const value = stringFlag(flags, key)
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []
}

function normalizeHomepageUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--url must be http(s)")
  }
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function keyFromUrl(raw: string): string {
  const host = new URL(raw).hostname.replace(/^www\./, "")
  const first = host.split(".")[0] ?? "brand"
  const key = first.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^[^a-z]+/, "")
  return key.length >= 2 ? key.slice(0, 40) : `brand-${crypto.randomBytes(2).toString("hex")}`
}

async function fetchText(url: string): Promise<{status: number; text: string; finalUrl: string}> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 kiko.ai product target detector",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  })
  return {status: res.status, text: await res.text(), finalUrl: res.url}
}

async function probeShopifyProductsJson(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/products.json?limit=1", baseUrl)
    const res = await fetch(url, {
      headers: {"User-Agent": "Mozilla/5.0 kiko.ai product target detector", Accept: "application/json"},
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return false
    const json = (await res.json()) as {products?: unknown[]}
    return Array.isArray(json.products)
  } catch {
    return false
  }
}

async function detectTarget(target: ProductCollectionTarget): Promise<DetectResult> {
  const homepage = normalizeHomepageUrl(target.homepage_url)
  const [htmlResult, shopifyJsonOk] = await Promise.all([
    fetchText(homepage),
    probeShopifyProductsJson(homepage),
  ])
  const html = htmlResult.text
  const lower = html.toLowerCase()

  const cafe24Signals = [
    lower.includes("cafe24"),
    lower.includes("ec-image"),
    lower.includes("cate_no="),
    /\/product\/list\.html\?cate_no=/i.test(html),
  ]
  const shopifySignals = [
    shopifyJsonOk,
    /\/cdn\/shop\//i.test(html),
    /shopify\.com|cdn\.shopify|Shopify\.theme/i.test(html),
  ]

  let platformType: DetectResult["platform_type"] = "custom"
  if (cafe24Signals.some(Boolean)) platformType = "cafe24"
  else if (shopifySignals.some(Boolean)) platformType = "shopify"

  const cateNos = [...html.matchAll(/cate_no=(\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n))
  const uniqueCateNos = [...new Set(cateNos)].slice(0, 80)
  const categories = uniqueCateNos.map((cateNo) => ({
    cateNo,
    gender: target.gender_scope.length > 0 ? target.gender_scope : undefined,
  }))

  const categoryDiscovery = platformType === "cafe24" && categories.length > 0 ? "manual" : "auto"
  return {
    platform_type: platformType,
    category_discovery: categoryDiscovery,
    platform_key: target.platform_key ?? keyFromUrl(homepage),
    categories,
    detection: {
      detected_at: new Date().toISOString(),
      homepage_status: htmlResult.status,
      final_url: htmlResult.finalUrl,
      html_bytes: html.length,
      signals: {
        cafe24: cafe24Signals,
        shopify: shopifySignals,
        shopify_products_json: shopifyJsonOk,
      },
      cate_no_count: uniqueCateNos.length,
    },
  }
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.length > 0
  return value != null
}

function analyzeArtifact(filePath: string): {metrics: Record<string, unknown>; passed: boolean; sha256: string} {
  const text = fs.readFileSync(filePath, "utf-8")
  const sha256 = crypto.createHash("sha256").update(text).digest("hex")
  const products = JSON.parse(text) as CrawledProduct[]
  if (!Array.isArray(products)) throw new Error("artifact JSON must be an array")

  const total = products.length
  const categoryPresent = products.filter((p) => hasValue(p.category)).length
  const colorPresent = products.filter((p) => hasValue(p.color)).length
  const pricePresent = products.filter((p) => hasValue(p.price)).length
  const imagePresent = products.filter((p) => hasValue(p.imageUrl) || hasValue(p.images)).length
  const inStock = products.filter((p) => p.inStock !== false).length

  const pct = (count: number): number => (total === 0 ? 0 : Math.round((10000 * count) / total) / 100)
  const metrics = {
    total,
    category_present: categoryPresent,
    color_present: colorPresent,
    price_present: pricePresent,
    image_present: imagePresent,
    in_stock: inStock,
    category_fill_rate: pct(categoryPresent),
    color_fill_rate: pct(colorPresent),
    price_fill_rate: pct(pricePresent),
    image_fill_rate: pct(imagePresent),
  }
  return {
    metrics,
    passed: total > 0 && categoryPresent === total && colorPresent === total,
    sha256,
  }
}

async function selectTargets(flags: Flags): Promise<ProductCollectionTarget[]> {
  const db = createProductCollectionClient()
  const id = numberFlag(flags, "id")
  if (id) {
    const target = await loadProductTarget(db, id)
    return target ? [target] : []
  }

  let query = db.from("product_collection_targets").select("*").order("priority", {ascending: true})
  if (flags.requested) query = query.eq("planner_status", "product_collection_requested")
  const plannerStatus = stringFlag(flags, "planner-status")
  const techStatus = stringFlag(flags, "tech-status")
  if (plannerStatus) query = query.eq("planner_status", plannerStatus)
  if (techStatus) query = query.eq("tech_status", techStatus)
  const limit = numberFlag(flags, "limit")
  if (limit) query = query.limit(limit)

  const {data, error} = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ProductCollectionTarget[]
}

async function addTarget(flags: Flags): Promise<void> {
  const brand = stringFlag(flags, "brand")
  const url = stringFlag(flags, "url")
  if (!brand || !url) throw new Error("add requires --brand and --url")

  const db = createProductCollectionClient()
  const {data, error} = await db
    .from("product_collection_targets")
    .insert({
      brand_name: brand,
      homepage_url: normalizeHomepageUrl(url),
      gender_scope: splitFlag(flags, "gender"),
      price_band: stringFlag(flags, "price-band") ?? "unknown",
      priority: numberFlag(flags, "priority") ?? 3,
      planner_status: stringFlag(flags, "planner-status") ?? "planner_classified",
      planner_notes: stringFlag(flags, "notes"),
      created_by: "crawler-cli",
      updated_by: "crawler-cli",
    })
    .select("id, brand_name")
    .single()
  if (error) throw new Error(error.message)
  console.log(`created target #${(data as {id: number}).id} ${(data as {brand_name: string}).brand_name}`)
}

async function listTargets(flags: Flags): Promise<void> {
  const targets = await selectTargets(flags)
  for (const target of targets) {
    console.log(
      [
        `#${target.id}`,
        target.brand_name,
        target.planner_status,
        target.tech_status,
        target.platform_type,
        target.platform_key ?? "-",
        target.homepage_url,
      ].join(" | "),
    )
  }
  console.log(`total=${targets.length}`)
}

async function requestTarget(flags: Flags): Promise<void> {
  const id = numberFlag(flags, "id")
  if (!id) throw new Error("request requires --id")
  const db = createProductCollectionClient()
  await updateProductTarget(db, id, {
    planner_status: "product_collection_requested",
    requested_at: new Date().toISOString(),
  })
  console.log(`target #${id} requested`)
}

async function detectTargets(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  const targets = await selectTargets(flags)
  for (const target of targets) {
    const startedAt = Date.now()
    const runId = await startProductRun(db, {
      targetId: target.id,
      stage: "detect",
      platformKey: target.platform_key,
    })
    try {
      const result = await detectTarget(target)
      await updateProductTarget(db, target.id, {
        platform_key: result.platform_key,
        platform_type: result.platform_type,
        category_discovery: result.category_discovery,
        categories: result.categories,
        detection: result.detection,
        tech_status: "tech_detected",
        config_status: "needed",
        detected_at: new Date().toISOString(),
        last_error: null,
      })
      await finishProductRun(db, runId, {
        status: "success",
        metrics: {
          platform_type: result.platform_type,
          platform_key: result.platform_key,
          category_discovery: result.category_discovery,
          cate_no_count: result.categories.length,
        },
        startedAt,
      })
      console.log(`#${target.id} ${target.brand_name}: ${result.platform_type} (${result.platform_key})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await updateProductTarget(db, target.id, {tech_status: "blocked", last_error: message})
      await finishProductRun(db, runId, {status: "failed", errorMessage: message, startedAt})
      console.error(`#${target.id} ${target.brand_name}: ${message}`)
    }
  }
}

async function qcTarget(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  const id = numberFlag(flags, "id")
  const site = stringFlag(flags, "site")
  const target = id ? await loadProductTarget(db, id) : null
  const platformKey = site ?? target?.platform_key
  if (!platformKey) throw new Error("qc requires --site or target with platform_key")
  const targetId = target?.id ?? id
  if (!targetId) throw new Error("qc requires --id when --site is not linked to a target")

  const artifactPath = stringFlag(flags, "file") ?? path.join(process.cwd(), "data", `${platformKey}-products.json`)
  const startedAt = Date.now()
  const runId = await startProductRun(db, {
    targetId,
    stage: "qc",
    platformKey,
  })
  try {
    const {metrics, passed, sha256} = analyzeArtifact(artifactPath)
    await updateProductTarget(db, targetId, {
      latest_artifact_path: path.relative(process.cwd(), artifactPath),
      latest_artifact_sha256: sha256,
      qc_summary: {...metrics, passed},
      tech_status: passed ? "import_ready" : "qc_failed",
      last_error: passed ? null : "QC failed: category/color fill must be 100%",
    })
    await finishProductRun(db, runId, {
      status: passed ? "success" : "failed",
      metrics: {...metrics, passed},
      artifactPath: path.relative(process.cwd(), artifactPath),
      errorMessage: passed ? null : "category/color fill below threshold",
      startedAt,
    })
    console.log(`${platformKey}: qc ${passed ? "passed" : "failed"} ${JSON.stringify(metrics)}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateProductTarget(db, targetId, {tech_status: "qc_failed", last_error: message})
    await finishProductRun(db, runId, {status: "failed", errorMessage: message, startedAt})
    throw err
  }
}

async function markTarget(flags: Flags): Promise<void> {
  const id = numberFlag(flags, "id")
  if (!id) throw new Error("mark requires --id")
  const patch: Record<string, unknown> = {}
  for (const [flag, column] of [
    ["planner-status", "planner_status"],
    ["tech-status", "tech_status"],
    ["config-status", "config_status"],
    ["platform-key", "platform_key"],
    ["platform-type", "platform_type"],
    ["blocked-reason", "blocked_reason"],
    ["error", "last_error"],
    ["tech-notes", "tech_notes"],
  ] as const) {
    const value = stringFlag(flags, flag)
    if (value !== null) patch[column] = value
  }
  if (Object.keys(patch).length === 0) throw new Error("mark requires at least one update flag")
  const db = createProductCollectionClient()
  const runId = await startProductRun(db, {targetId: id, stage: "manual", status: "running"})
  await updateProductTarget(db, id, patch)
  await finishProductRun(db, runId, {status: "success", metrics: {patch}, startedAt: Date.now()})
  console.log(`target #${id} updated`)
}

async function listRuns(flags: Flags): Promise<void> {
  const db = createProductCollectionClient()
  let query = db
    .from("product_collection_runs")
    .select("*")
    .order("created_at", {ascending: false})
    .limit(numberFlag(flags, "limit") ?? 30)
  const id = numberFlag(flags, "id")
  if (id) query = query.eq("target_id", id)
  const {data, error} = await query
  if (error) throw new Error(error.message)
  for (const run of data ?? []) {
    console.log(
      [
        `#${run.id}`,
        `target=${run.target_id ?? "-"}`,
        run.stage,
        run.status,
        run.platform_key ?? "-",
        run.error_message ?? "",
      ].join(" | "),
    )
  }
}

function printHelp(): void {
  console.log(`
Product collection target queue

Commands:
  add       --brand=NAME --url=URL [--gender=women,men] [--price-band=mid] [--priority=3]
  list      [--planner-status=...] [--tech-status=...] [--limit=50]
  request   --id=ID
  detect    --id=ID | --requested [--limit=20]
  qc        --id=ID [--site=KEY] [--file=data/KEY-products.json]
  mark      --id=ID [--planner-status=...] [--tech-status=...] [--platform-key=...]
  runs      [--id=ID] [--limit=30]
`)
}

async function main(): Promise<void> {
  const {command, flags} = parseArgs(process.argv.slice(2))
  if (command === "help" || command === "--help") return printHelp()
  if (command === "add") return addTarget(flags)
  if (command === "list") return listTargets(flags)
  if (command === "request") return requestTarget(flags)
  if (command === "detect") return detectTargets(flags)
  if (command === "qc") return qcTarget(flags)
  if (command === "mark") return markTarget(flags)
  if (command === "runs") return listRuns(flags)
  throw new Error(`unknown command: ${command}`)
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
