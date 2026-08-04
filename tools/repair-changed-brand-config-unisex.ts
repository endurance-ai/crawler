#!/usr/bin/env npx tsx
/**
 * Re-evaluate changed-brand products that were saved as config_default unisex.
 * Dry-run by default; pass --apply to write. No rows are deleted.
 */
import {createClient} from "@supabase/supabase-js"
import {resolveProductGenderWithSource} from "../src/lib/product-gender"

const CHANGED_BRAND_IDS = [
  22, 31, 32, 34, 48, 77, 103, 135, 159, 187, 208, 210, 213, 216, 394,
  455, 501, 534, 5530, 589, 660, 690, 697, 945, 1103, 1106, 1138, 1147,
  1182, 1211, 1215, 1247, 1292, 1340, 1379, 1401, 1435, 1461, 1581, 1596,
  1739, 1749, 1841, 1863, 1865, 1908, 1936, 1946, 2016, 2050, 2205, 2352,
  2368, 2669, 2745, 2762, 2794, 2808, 3656, 3685, 3765, 3789, 3835, 5189,
  5229, 5230, 5245, 5258, 5290, 5381, 5396, 5417, 5432, 5793, 5834, 5836,
  5839, 5840, 5842, 5847, 5848, 5852, 5856,
] as const

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)
const apply = process.argv.includes("--apply")

const {data, error} = await db
  .from("products")
  .select("id,brand_node_id,platform,name,category,subcategory,tags,product_url,gender,gender_source")
  .in("brand_node_id", [...CHANGED_BRAND_IDS])
  .eq("gender_source", "config_default")
  .contains("gender", ["unisex"])
if (error) throw error

const decisions = (data ?? []).map((row) => {
  const resolved = resolveProductGenderWithSource([], {
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    tags: row.tags,
    productUrl: row.product_url,
  })
  return {
    id: row.id as number,
    brandNodeId: row.brand_node_id as number,
    platform: row.platform as string,
    gender: resolved.gender.length > 0 ? resolved.gender : null,
    source: resolved.source ?? "unverified_legacy",
  }
})

const summary = new Map<string, number>()
for (const decision of decisions) {
  const key = `${decision.platform}\t${decision.gender?.join("+") ?? "null"}\t${decision.source}`
  summary.set(key, (summary.get(key) ?? 0) + 1)
}
console.log(`mode=${apply ? "apply" : "dry-run"} candidates=${decisions.length}`)
for (const [key, count] of [...summary].sort()) console.log(`${key}\t${count}`)

if (apply) {
  const groups = new Map<string, typeof decisions>()
  for (const decision of decisions) {
    const key = `${JSON.stringify(decision.gender)}\u0000${decision.source}`
    const group = groups.get(key) ?? []
    group.push(decision)
    groups.set(key, group)
  }
  let updated = 0
  for (const [key, group] of groups) {
    const [genderJson, source] = key.split("\u0000")
    const gender = JSON.parse(genderJson) as string[] | null
    for (let i = 0; i < group.length; i += 100) {
      const ids = group.slice(i, i + 100).map((item) => item.id)
      const {data: written, error: updateError} = await db
        .from("products")
        .update({gender, gender_source: source, updated_at: new Date().toISOString()})
        .in("id", ids)
        .eq("gender_source", "config_default")
        .contains("gender", ["unisex"])
        .select("id")
      if (updateError) throw updateError
      updated += written?.length ?? 0
    }
  }
  console.log(`updated=${updated}`)
}
