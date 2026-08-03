/**
 * Repair product genders contaminated by an incorrect brand gender fallback.
 * Only products matching a manually verified brand override's old scope and
 * carrying no trustworthy product-level source are eligible.
 *
 * Dry run:
 *   pnpm exec dotenv -e .env.local -- tsx tools/backfill-product-gender.ts
 * Apply:
 *   pnpm exec dotenv -e .env.local -- tsx tools/backfill-product-gender.ts --apply
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"

type Scope = "men" | "women" | "unisex"

interface Override {
  brandId: number
  brandName: string
  before: Scope[]
  after: Scope[]
}

interface ProductRow {
  id: number
  brand_node_id: number
  gender: unknown
  gender_source: string | null
}

interface BrandSummary {
  brandId: number
  brandName: string
  before: Scope[]
  after: Scope[]
  products: number
  eligible: number
  preservedDifferentGender: number
  preservedTrustedSource: number
  repaired: number
  currentGenderDistribution: Record<string, number>
}

const shouldApply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

const db = createClient(dbUrl, dbToken)
const repo = path.resolve(import.meta.dirname, "..")
const overridePath = path.join(repo, "data", "brand-gender-verified-overrides.json")
const reportPath = path.join(repo, "data", "product-gender-backfill.json")
const overrides = JSON.parse(fs.readFileSync(overridePath, "utf8")) as Override[]
// A completed repair is terminal. Keeping repair_brand_scope eligible makes
// same-scope verification overrides appear pending forever.
const fallbackSources = new Set([null, "unverified_legacy", "brand_scope"])

function sameArray(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isMissingGender(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return true
  return !value.some((item) => ["men", "women", "unisex"].includes(String(item).toLowerCase()))
}

async function loadProducts(brandIds: number[]): Promise<ProductRow[]> {
  const rows: ProductRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const {data, error} = await db
      .from("products")
      .select("id,brand_node_id,gender,gender_source")
      .in("brand_node_id", brandIds)
      .order("id")
      .range(offset, offset + 999)
    if (error) throw error
    rows.push(...(data as ProductRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main(): Promise<void> {
  const byBrand = new Map(overrides.map((item) => [item.brandId, item]))
  const products = await loadProducts([...byBrand.keys()])
  const eligible = products.filter((product) => {
    const override = byBrand.get(product.brand_node_id)
    return override && fallbackSources.has(product.gender_source) &&
      (sameArray(product.gender, override.before) || isMissingGender(product.gender))
  })

  const summaries: BrandSummary[] = overrides.map((override) => {
    const rows = products.filter((product) => product.brand_node_id === override.brandId)
    const currentGenderDistribution = rows.reduce<Record<string, number>>((counts, row) => {
      const key = JSON.stringify(row.gender)
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {})
    return {
      brandId: override.brandId,
      brandName: override.brandName,
      before: override.before,
      after: override.after,
      products: rows.length,
      eligible: rows.filter((row) => fallbackSources.has(row.gender_source) &&
        (sameArray(row.gender, override.before) || isMissingGender(row.gender))).length,
      preservedDifferentGender: rows.filter((row) => fallbackSources.has(row.gender_source) &&
        !sameArray(row.gender, override.before) && !isMissingGender(row.gender)).length,
      preservedTrustedSource: rows.filter((row) => !fallbackSources.has(row.gender_source)).length,
      repaired: rows.filter((row) => row.gender_source === "repair_brand_scope" && sameArray(row.gender, override.after)).length,
      currentGenderDistribution,
    }
  })

  const report = {
    generatedAt: new Date().toISOString(),
    mode: shouldApply ? "apply" : "dry-run",
    totals: {
      brands: overrides.length,
      products: products.length,
      eligible: eligible.length,
      preservedDifferentGender: summaries.reduce((sum, item) => sum + item.preservedDifferentGender, 0),
      preservedTrustedSource: summaries.reduce((sum, item) => sum + item.preservedTrustedSource, 0),
    },
    brands: summaries,
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.totals, null, 2))
  for (const item of summaries.filter((summary) => summary.eligible > 0)) {
    console.log(`${item.brandId}\t${item.brandName}\t${item.before[0]} -> ${item.after[0]}\t${item.eligible}/${item.products}`)
  }
  console.log(`report: ${reportPath}`)
  if (!shouldApply || eligible.length === 0) return

  const byTarget = new Map<string, number[]>()
  for (const product of eligible) {
    const target = byBrand.get(product.brand_node_id)!.after[0]
    const ids = byTarget.get(target) ?? []
    ids.push(product.id)
    byTarget.set(target, ids)
  }

  const updatedAt = new Date().toISOString()
  let updated = 0
  for (const [target, ids] of byTarget) {
    for (let index = 0; index < ids.length; index += 200) {
      const batch = ids.slice(index, index + 200)
      const {error} = await db
        .from("products")
        .update({
          gender: [target],
          gender_source: "repair_brand_scope",
          updated_at: updatedAt,
        })
        .in("id", batch)
      if (error) throw error
      updated += batch.length
    }
  }
  console.log(`updated: ${updated}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
