#!/usr/bin/env npx tsx
/** Apply only gender-scope changes backed by an invariant or official evidence. */
import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"

type Scope = "men" | "women" | "unisex"
type BrandRow = {id: number; brand_name: string; gender_scope: unknown; wiki: Record<string, unknown> | null}
type Update = {brandId: number; after: Scope; reason: string; sources: string[]}

const OFFICIAL_MIXED_IDS = new Set([
  22, 31, 32, 34, 48, 77, 103, 159, 187, 208, 210, 213, 216, 534,
  589, 660, 690, 1138, 1147, 1182, 1211, 1215, 1247, 1340, 1379, 1596,
  1739, 1865, 1908, 2050, 2205, 2762, 3685, 3789, 5189, 5230, 5258, 5381,
  5396, 5417, 5432,
])

const OFFICIAL_SCOPE_UPDATES: Update[] = [
  {brandId: 258, after: "women", reason: "official_about_womens_designer_brand", sources: ["https://yuse.co.kr/shopinfo/company.html"]},
  {brandId: 945, after: "unisex", reason: "official_parent_site_cross_gender_product_line", sources: ["https://www.maisonmargiela.com/ko-kr/"]},
  {brandId: 1292, after: "unisex", reason: "official_parent_site_cross_gender_product_line", sources: ["https://www.maisonmargiela.com/ko-kr/"]},
  {brandId: 1863, after: "unisex", reason: "official_parent_site_men_women", sources: ["https://www.loewe.com/int/en/home"]},
  {brandId: 2745, after: "unisex", reason: "official_parent_site_men_women", sources: ["https://www.dior.com/"]},
  {brandId: 5793, after: "women", reason: "official_store_womens_catalog", sources: ["https://autumnshop.kr/"]},
  {brandId: 5834, after: "men", reason: "official_about_classic_menswear", sources: ["https://www.foretstudio.dk/en-us/pages/about"]},
  {brandId: 5836, after: "unisex", reason: "official_store_men_women", sources: ["https://haversack.jp/en"]},
  {brandId: 5839, after: "unisex", reason: "official_store_men_women", sources: ["https://johnstonsofelgin.com/en-kr"]},
  {brandId: 5840, after: "unisex", reason: "official_gender_neutral_bag_catalog", sources: ["https://maziuntitled.com/"]},
  {brandId: 5842, after: "unisex", reason: "official_brand_designed_for_all", sources: ["https://serviceworks.xyz/"]},
  {brandId: 5847, after: "unisex", reason: "official_gender_neutral_footwear_catalog", sources: ["https://tarvasfootwear.com/"]},
  {brandId: 5848, after: "men", reason: "official_about_menswear", sources: ["https://publicfigure.kr/about"]},
  {brandId: 5852, after: "unisex", reason: "official_store_main_and_women_ranges", sources: ["https://wouldbe.co.kr/category/cut-sew/72/"]},
  {brandId: 5856, after: "unisex", reason: "official_store_men_women", sources: ["https://northseaclothing.com/products"]},
]

const apply = process.argv.includes("--apply")
const brandIdArg = process.argv.find((arg) => arg.startsWith("--brand-id="))
const selectedBrandId = brandIdArg ? Number(brandIdArg.split("=")[1]) : undefined
if (selectedBrandId !== undefined && !Number.isInteger(selectedBrandId)) {
  throw new Error("--brand-id must be an integer")
}
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

const brands: BrandRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db.from("brand_nodes").select("id,brand_name,gender_scope,wiki").order("id").range(offset, offset + 999)
  if (error) throw error
  brands.push(...data as BrandRow[])
  if (!data || data.length < 1000) break
}

const evidencePath = path.resolve("data/brand-gender-full-homepage-evidence.json")
const evidence = fs.existsSync(evidencePath)
  ? JSON.parse(fs.readFileSync(evidencePath, "utf8")).evidence as Array<{brandId: number; finalUrl?: string; url: string; menLinks: string[]; womenLinks: string[]}>
  : []
const evidenceById = new Map(evidence.map((item) => [item.brandId, item]))
const updates = new Map<number, Update>()

for (const brand of brands) {
  if (Array.isArray(brand.gender_scope) && brand.gender_scope.length > 1) {
    updates.set(brand.id, {brandId: brand.id, after: "unisex", reason: "canonical_single_value_invariant", sources: []})
  }
}
for (const brandId of OFFICIAL_MIXED_IDS) {
  const item = evidenceById.get(brandId)
  const sources = item ? [item.finalUrl ?? item.url] : []
  updates.set(brandId, {brandId, after: "unisex", reason: "official_site_men_women_navigation", sources})
}
for (const update of OFFICIAL_SCOPE_UPDATES) updates.set(update.brandId, update)

const planned = [...updates.values()]
  .filter((update) => selectedBrandId === undefined || update.brandId === selectedBrandId)
  .map((update) => {
    const brand = brands.find((item) => item.id === update.brandId)
    if (!brand) throw new Error(`brand not found: ${update.brandId}`)
    return {brand, update}
  })
  .filter(({brand, update}) => JSON.stringify(brand.gender_scope) !== JSON.stringify([update.after]))

console.log(JSON.stringify({mode: apply ? "apply" : "dry-run", changes: planned.length}, null, 2))
for (const {brand, update} of planned) {
  console.log(`${brand.id}\t${brand.brand_name}\t${JSON.stringify(brand.gender_scope)} -> ["${update.after}"]\t${update.reason}`)
  if (!apply) continue
  const verifiedAt = new Date().toISOString()
  const wiki = brand.wiki && typeof brand.wiki === "object" ? brand.wiki : {}
  const nextWiki = {
    ...wiki,
    gender: update.after === "men" ? "남성" : update.after === "women" ? "여성" : "공용",
    gender_verified_at: verifiedAt,
    gender_confidence: 0.99,
    gender_sources: update.sources,
    gender_verification_rule: update.reason,
  }
  const {error} = await db.from("brand_nodes").update({gender_scope: [update.after], wiki: nextWiki}).eq("id", brand.id)
  if (error) throw error
}
