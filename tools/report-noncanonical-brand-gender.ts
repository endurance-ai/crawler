#!/usr/bin/env npx tsx
/** Read-only evidence report for every non-canonical brand gender scope. */
import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"
import {summarizeTrustedBrandGenderEvidence} from "../src/lib/brand-gender-scope"

type BrandRow = {id: number; brand_name: string; gender_scope: unknown; wiki: Record<string, unknown> | null}
type ProductRow = {id: number; brand_node_id: number; gender: unknown; gender_source: string | null}

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function canonical(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && ["men", "women", "unisex"].includes(value[0])
}
function homepage(wiki: BrandRow["wiki"]): string | null {
  for (const key of ["homepage_url", "homepage", "official_url", "website"]) {
    if (typeof wiki?.[key] === "string" && /^https?:\/\//i.test(wiki[key] as string)) return wiki[key] as string
  }
  return null
}

const brands: BrandRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db.from("brand_nodes").select("id,brand_name,gender_scope,wiki").order("id").range(offset, offset + 999)
  if (error) throw error
  brands.push(...data as BrandRow[])
  if (!data || data.length < 1000) break
}
const targets = brands.filter((brand) => !canonical(brand.gender_scope))
const targetIds = new Set(targets.map((brand) => brand.id))
const products: ProductRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db.from("products").select("id,brand_node_id,gender,gender_source").order("id").range(offset, offset + 999)
  if (error) throw error
  products.push(...(data as ProductRow[]).filter((product) => targetIds.has(product.brand_node_id)))
  if (!data || data.length < 1000) break
}
const byBrand = new Map<number, ProductRow[]>()
for (const product of products) byBrand.set(product.brand_node_id, [...(byBrand.get(product.brand_node_id) ?? []), product])
const rows = targets.map((brand) => ({
  brandId: brand.id,
  brandName: brand.brand_name,
  before: brand.gender_scope,
  homepage: homepage(brand.wiki),
  evidence: summarizeTrustedBrandGenderEvidence(byBrand.get(brand.id) ?? []),
  wikiGender: brand.wiki?.gender ?? null,
  description: brand.wiki?.description_ko ?? brand.wiki?.description_original ?? null,
}))
const evidenceShape = (row: typeof rows[number]): string => {
  const e = row.evidence
  if (e.trustedMen && e.trustedWomen) return "men+women"
  if (e.trustedMen) return "men"
  if (e.trustedWomen) return "women"
  if (e.trustedUnisex) return "unisex"
  return "none"
}
const shapeCounts: Record<string, number> = {}
for (const row of rows) shapeCounts[evidenceShape(row)] = (shapeCounts[evidenceShape(row)] ?? 0) + 1
const report = {generatedAt: new Date().toISOString(), totals: {targets: rows.length, products: products.length, evidenceShape: shapeCounts}, rows}
const output = path.resolve("data/noncanonical-brand-gender-evidence.json")
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.totals, null, 2))
console.log(`report: ${output}`)
