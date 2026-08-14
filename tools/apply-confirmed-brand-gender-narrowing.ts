#!/usr/bin/env npx tsx
/** Apply the two reviewed 2026-08-10 brand gender narrowing decisions only. */
import {createClient} from "@supabase/supabase-js"

type BrandRow = {
  id: number
  brand_name: string
  gender_scope: unknown
  wiki: Record<string, unknown> | null
}

const DECISIONS = [
  {
    id: 1255,
    name: "ZEGNA",
    before: ["unisex"],
    after: ["men"],
    reason: "official_brand_description_luxury_menswear",
    sources: ["https://www.zegnagroup.com/en/zegna/"],
  },
  {
    id: 1740,
    name: "visvim",
    before: ["unisex"],
    after: ["men"],
    reason: "official_womens_line_separated_as_wmv",
    sources: ["https://www.visvim.tv/", "https://www.visvim.tv/wmv/"],
  },
] as const

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

const {data, error} = await db
  .from("brand_nodes")
  .select("id,brand_name,gender_scope,wiki")
  .in("id", DECISIONS.map((decision) => decision.id))
  .order("id")
if (error) throw error

const brands = data as BrandRow[]
if (brands.length !== DECISIONS.length) throw new Error(`expected ${DECISIONS.length} rows, found ${brands.length}`)

for (const decision of DECISIONS) {
  const brand = brands.find((row) => row.id === decision.id)
  if (!brand) throw new Error(`missing brand_node ${decision.id}`)
  if (brand.brand_name !== decision.name) throw new Error(`brand name mismatch for ${decision.id}: ${brand.brand_name}`)
  if (JSON.stringify(brand.gender_scope) !== JSON.stringify(decision.before)) {
    throw new Error(`gender precondition failed for ${decision.id}: ${JSON.stringify(brand.gender_scope)}`)
  }
}

console.log(JSON.stringify({mode: apply ? "apply" : "dry-run", changes: DECISIONS.length}, null, 2))
for (const decision of DECISIONS) {
  console.log(`${decision.id}\t${decision.name}\t${JSON.stringify(decision.before)} -> ${JSON.stringify(decision.after)}`)
  if (!apply) continue

  const brand = brands.find((row) => row.id === decision.id)!
  const verifiedAt = new Date().toISOString()
  const nextWiki = {
    ...(brand.wiki ?? {}),
    gender: "남성",
    gender_verified_at: verifiedAt,
    gender_confidence: 0.99,
    gender_sources: [...decision.sources],
    gender_verification_rule: decision.reason,
  }
  const {data: updated, error: updateError} = await db
    .from("brand_nodes")
    .update({gender_scope: [...decision.after], wiki: nextWiki})
    .eq("id", decision.id)
    .eq("brand_name", decision.name)
    .select("id,brand_name,gender_scope,wiki")
  if (updateError) throw updateError
  if (!updated || updated.length !== 1) throw new Error(`expected one updated row for ${decision.id}`)
  if (JSON.stringify(updated[0].gender_scope) !== JSON.stringify(decision.after)) {
    throw new Error(`postcondition failed for ${decision.id}: ${JSON.stringify(updated[0].gender_scope)}`)
  }
}
