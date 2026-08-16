#!/usr/bin/env npx tsx
/**
 * Repair additional verified women products. Another Office is repaired from
 * its official department URL, women-only brands from their audited scope,
 * and mixed-brand exceptions from an exact product-family rule.
 * Dry-run by default; pass --apply to write.
 */
import {createClient} from "@supabase/supabase-js"

type Gender = "men" | "women"
type RepairSource = "repair_url" | "repair_brand_scope" | "repair_text"
type ProductRow = {
  id: number
  name: string
  brand_node_id: number
  platform: string
  product_url: string
  gender: unknown
  gender_source: string | null
}
type Decision = ProductRow & {after: Gender; source: RepairSource; reason: string}

const BRAND_IDS = {
  anotherOffice: 4819,
  chiyagi: 5265,
  itti: 5166,
  ballew: 5724,
} as const
const ANOTHER_OFFICE_CATEGORIES = new Map<number, Gender>([
  [44, "men"], [45, "men"], [46, "men"], [47, "men"],
  [80, "women"], [81, "women"], [82, "women"], [95, "women"],
])
const REQUESTED_PATTERNS = [
  /Agae Top -/i,
  /Inside Out Tote S/i,
  /w\. Tourist Shirt/i,
  /traveling bag/i,
]

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

function categoryNo(productUrl: string): number | null {
  try {
    const url = new URL(productUrl)
    const value = url.searchParams.get("cate_no")
      ?? url.pathname.match(/\/category\/(\d+)(?:\/|$)/i)?.[1]
    return value ? Number(value) : null
  } catch {
    return null
  }
}

const rows: ProductRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db
    .from("products")
    .select("id,name,brand_node_id,platform,product_url,gender,gender_source")
    .in("brand_node_id", Object.values(BRAND_IDS))
    .order("id")
    .range(offset, offset + 999)
  if (error) throw error
  rows.push(...data as ProductRow[])
  if (!data || data.length < 1000) break
}

const decisions: Decision[] = []
for (const row of rows) {
  let decision: Pick<Decision, "after" | "source" | "reason"> | null = null
  if (row.brand_node_id === BRAND_IDS.anotherOffice) {
    const category = categoryNo(row.product_url)
    const gender = category === null ? undefined : ANOTHER_OFFICE_CATEGORIES.get(category)
    if (gender) decision = {after: gender, source: "repair_url", reason: `official-category-${category}`}
  } else if (row.brand_node_id === BRAND_IDS.ballew || row.brand_node_id === BRAND_IDS.chiyagi) {
    decision = {after: "women", source: "repair_brand_scope", reason: "verified-women-brand"}
  } else if (row.brand_node_id === BRAND_IDS.itti && /Inside Out Tote S/i.test(row.name)) {
    decision = {after: "women", source: "repair_text", reason: "verified-product-family"}
  }

  if (decision && JSON.stringify(row.gender) !== JSON.stringify([decision.after])) {
    decisions.push({...row, ...decision})
  }
}

const requested = rows.filter((row) => REQUESTED_PATTERNS.some((pattern) => pattern.test(row.name)))
const decidedIds = new Set(decisions.map((row) => row.id))
const unresolvedRequested = requested.filter(
  (row) => JSON.stringify(row.gender) !== JSON.stringify(["women"]) && !decidedIds.has(row.id),
)
if (requested.length < 10) {
  throw new Error(`requested product precondition failed: expected at least 10 rows, found ${requested.length}`)
}
if (unresolvedRequested.length > 0) {
  throw new Error(`requested products lack a repair decision: ${unresolvedRequested.map((row) => row.id).join(",")}`)
}

const counts = Object.fromEntries(
  [...new Set(decisions.map((row) => `${row.after}:${row.source}`))].map((key) => {
    const [gender, source] = key.split(":")
    return [key, decisions.filter((row) => row.after === gender && row.source === source).length]
  }),
)
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  scanned: rows.length,
  updates: decisions.length,
  counts,
  requested: requested.map(({id, name, platform, gender, gender_source}) => ({
    id, name, platform, before: gender, before_source: gender_source, after: ["women"],
  })),
}, null, 2))

if (apply) {
  const updatedAt = new Date().toISOString()
  let updatedCount = 0
  for (const gender of ["men", "women"] as const) {
    for (const source of ["repair_url", "repair_brand_scope", "repair_text"] as const) {
      const group = decisions.filter((decision) => decision.after === gender && decision.source === source)
      for (let index = 0; index < group.length; index += 100) {
        const ids = group.slice(index, index + 100).map((row) => row.id)
        if (ids.length === 0) continue
        const {data: updated, error} = await db
          .from("products")
          .update({gender: [gender], gender_source: source, updated_at: updatedAt})
          .in("id", ids)
          .select("id")
        if (error) throw error
        if ((updated?.length ?? 0) !== ids.length) {
          throw new Error(`update count mismatch: expected=${ids.length} actual=${updated?.length ?? 0}`)
        }
        updatedCount += updated.length
      }
    }
  }
  console.log(`updated_products=${updatedCount}`)
}

const {data: verified, error: verifyError} = await db
  .from("products")
  .select("id,name,platform,gender,gender_source")
  .in("id", requested.map((row) => row.id))
  .order("id")
if (verifyError) throw verifyError
console.log(JSON.stringify({verified}, null, 2))
