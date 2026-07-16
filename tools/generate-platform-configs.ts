#!/usr/bin/env npx tsx
/**
 * DB → SiteConfig codegen (read-only, never writes to DB).
 *
 * Targets KR-origin brands whose product-collection detect step already
 * identified them as shopify/cafe24 and that don't have a manual config yet
 * in src/configs/platforms.ts. Writes src/configs/platforms.generated.ts.
 *
 * Idempotent self-reference guard: when computing "already configured"
 * hosts/keys, entries produced by a *previous* run of this generator are
 * excluded from the comparison set (only hand-authored PLATFORMS entries
 * count as "manual"). Otherwise every re-run would see its own prior output
 * as a conflict and silently drop candidates.
 *
 * Usage: npx dotenv -e .env.local -- tsx tools/generate-platform-configs.ts
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {createProductCollectionClient} from "../src/lib/product-collection"
import {PLATFORMS} from "../src/configs/platforms"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Keys to force-disable regardless of DB state (curated after validation crawls). */
const DISABLED_KEYS = new Set<string>([])

interface CandidateRow {
  brand_node_id: number
  brand_name: string
  homepage_url: string
  platform_key: string
  platform_type: "shopify" | "cafe24"
  category_discovery: "manual" | "auto"
  categories: Array<{cateNo: number; gender?: string[]}>
}

function normalizeHost(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h.startsWith("www.") ? h.slice(4) : h
  } catch {
    return ""
  }
}

async function loadPreviousGeneratedKeys(): Promise<Set<string>> {
  const outPath = path.join(__dirname, "../src/configs/platforms.generated.ts")
  if (!fs.existsSync(outPath)) return new Set()
  try {
    const mod = await import("../src/configs/platforms.generated")
    return new Set((mod.GENERATED_PLATFORMS as Array<{key: string}>).map((p) => p.key))
  } catch {
    return new Set()
  }
}

async function fetchCandidates(): Promise<CandidateRow[]> {
  const db = createProductCollectionClient()
  const {data, error} = await db
    .from("product_crawl_brands")
    .select("brand_node_id,brand_name,homepage_url,platform_key,platform_type,category_discovery,categories")
    .not("homepage_url", "is", null)
    .eq("wiki->>origin_country", "KR")
    .in("platform_type", ["shopify", "cafe24"])
    .eq("status", "tech_detected")
    .order("brand_node_id")
  if (error) throw new Error(`candidate query failed: ${error.message}`)
  return (data ?? []) as CandidateRow[]
}

function buildEntrySource(row: CandidateRow): string {
  const host = normalizeHost(row.homepage_url)
  const baseUrl = `https://${host}`
  const disabled = DISABLED_KEYS.has(row.platform_key)
  const lines: string[] = []
  lines.push("  {")
  lines.push(`    key: ${JSON.stringify(row.platform_key)},`)
  lines.push(`    name: ${JSON.stringify(row.brand_name)},`)
  lines.push(`    type: ${JSON.stringify(row.platform_type)},`)
  lines.push(`    baseUrl: ${JSON.stringify(baseUrl)},`)
  if (row.platform_type === "cafe24") {
    lines.push("    paginate: true,")
    lines.push("    maxPages: 300,")
    lines.push("    crawlDetails: true,")
    if (row.category_discovery === "manual" && row.categories.length > 0) {
      lines.push("    category: {")
      lines.push('      discovery: "manual",')
      lines.push("      categories: [")
      for (const c of row.categories) {
        const gender = c.gender && c.gender.length > 0 ? c.gender : ["unisex"]
        lines.push(
          `        {name: ${JSON.stringify(`Cat${c.cateNo}`)}, cateNo: ${c.cateNo}, gender: ${JSON.stringify(gender)}},`,
        )
      }
      lines.push("      ],")
      lines.push("    },")
    } else {
      lines.push('    category: {discovery: "auto"},')
    }
  } else {
    lines.push('    sourceCurrency: "KRW",')
    lines.push("    maxPages: 300,")
    lines.push("    crawlDelay: 1500,")
  }
  if (disabled) lines.push("    disabled: true,")
  lines.push(
    `    notes: ${JSON.stringify(`generate-platform-configs.ts — brand_node_id=${row.brand_node_id}, KR origin, auto-generated`)},`,
  )
  lines.push("  },")
  return lines.join("\n")
}

async function main() {
  const previousGeneratedKeys = await loadPreviousGeneratedKeys()
  const manualPlatforms = PLATFORMS.filter((p) => !previousGeneratedKeys.has(p.key))
  const existingHosts = new Set(manualPlatforms.map((p) => normalizeHost(p.baseUrl)))
  const existingKeys = new Set(manualPlatforms.map((p) => p.key))

  const candidates = await fetchCandidates()

  const seenHosts = new Set<string>()
  const kept: CandidateRow[] = []
  let skipManualHost = 0
  let skipManualKey = 0
  let skipDupHost = 0
  let skipNoKey = 0

  for (const row of candidates) {
    if (!row.platform_key) {
      skipNoKey++
      continue
    }
    const host = normalizeHost(row.homepage_url)
    if (!host) continue
    if (existingKeys.has(row.platform_key)) {
      skipManualKey++
      continue
    }
    if (existingHosts.has(host)) {
      skipManualHost++
      continue
    }
    if (seenHosts.has(host)) {
      skipDupHost++
      continue
    }
    seenHosts.add(host)
    kept.push(row)
  }

  const activeCount = kept.filter((r) => !DISABLED_KEYS.has(r.platform_key)).length
  const disabledCount = kept.length - activeCount

  const header = `/**
 * AUTO-GENERATED by tools/generate-platform-configs.ts — DO NOT EDIT BY HAND.
 * Regenerate: npx dotenv -e .env.local -- tsx tools/generate-platform-configs.ts
 *
 * KR-origin shopify/cafe24 brands (status=tech_detected) without a manual
 * config in platforms.ts. Generated ${new Date().toISOString()}.
 * Total: ${kept.length} (active ${activeCount} / disabled ${disabledCount})
 */

import type {SiteConfig} from "../lib/types"

export const GENERATED_PLATFORMS: SiteConfig[] = [
`

  const body = kept.map(buildEntrySource).join("\n")
  const footer = "\n]\n"
  const outPath = path.join(__dirname, "../src/configs/platforms.generated.ts")
  fs.writeFileSync(outPath, header + body + footer)

  console.log(`candidates fetched: ${candidates.length}`)
  console.log(`skip (missing platform_key): ${skipNoKey}`)
  console.log(`skip (manual key match): ${skipManualKey}`)
  console.log(`skip (manual host match): ${skipManualHost}`)
  console.log(`skip (duplicate host among candidates): ${skipDupHost}`)
  console.log(`generated: ${kept.length} (active ${activeCount} / disabled ${disabledCount})`)
  console.log(`written: ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
