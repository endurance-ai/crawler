#!/usr/bin/env npx tsx
/** Read-only inventory for a full brand_nodes gender audit. Never writes DB. */
import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"

type Scope = "men" | "women" | "unisex"
interface BrandRow {
  id: number
  brand_name: string
  gender_scope: unknown
  wiki: Record<string, unknown> | null
}

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function homepage(wiki: BrandRow["wiki"]): string | null {
  for (const key of ["homepage_url", "homepage", "official_url", "website"]) {
    const value = wiki?.[key]
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value
  }
  return null
}

function exactCanonical(value: unknown): Scope | null {
  if (!Array.isArray(value) || value.length !== 1) return null
  return value[0] === "men" || value[0] === "women" || value[0] === "unisex" ? value[0] : null
}

const brands: BrandRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db.from("brand_nodes").select("id,brand_name,gender_scope,wiki").order("id").range(offset, offset + 999)
  if (error) throw error
  brands.push(...(data as BrandRow[]))
  if (!data || data.length < 1000) break
}

const tokenCounts: Record<string, number> = {}
const shapeCounts: Record<string, number> = {}
for (const brand of brands) {
  const values = Array.isArray(brand.gender_scope) ? brand.gender_scope : []
  const shape = brand.gender_scope === null ? "null" : !Array.isArray(brand.gender_scope) ? typeof brand.gender_scope : `array:${values.length}`
  shapeCounts[shape] = (shapeCounts[shape] ?? 0) + 1
  for (const token of values) {
    const key = JSON.stringify(token)
    tokenCounts[key] = (tokenCounts[key] ?? 0) + 1
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    brands: brands.length,
    exactCanonical: brands.filter((brand) => exactCanonical(brand.gender_scope)).length,
    nonCanonical: brands.filter((brand) => !exactCanonical(brand.gender_scope)).length,
    homepagePresent: brands.filter((brand) => homepage(brand.wiki)).length,
    homepageMissing: brands.filter((brand) => !homepage(brand.wiki)).length,
  },
  shapeCounts,
  tokenCounts: Object.fromEntries(Object.entries(tokenCounts).sort((a, b) => b[1] - a[1])),
  nonCanonical: brands.filter((brand) => !exactCanonical(brand.gender_scope)).map((brand) => ({
    id: brand.id,
    brandName: brand.brand_name,
    genderScope: brand.gender_scope,
    homepage: homepage(brand.wiki),
  })),
}
const output = path.resolve("data/brand-gender-full-inventory.json")
fs.mkdirSync(path.dirname(output), {recursive: true})
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({...report.totals, shapeCounts: report.shapeCounts, tokenCounts: report.tokenCounts}, null, 2))
console.log(`report: ${output}`)
