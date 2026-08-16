#!/usr/bin/env npx tsx
/**
 * Repair verified women products without widening product-name evidence into a
 * mixed brand default. Dry-run by default; pass --apply to write.
 */
import {createClient} from "@supabase/supabase-js"

type ProductRow = {
  id: number
  name: string
  brand_node_id: number
  platform: string
  product_url: string
  gender: unknown
  gender_source: string | null
}
type Decision = ProductRow & {
  reason: "verified-women-brand" | "verified-product-family"
  source: "repair_brand_scope" | "repair_text"
}

const WOMEN_BRANDS = new Map<number, string>([
  [2117, "Odlyworkshop"],
  [2140, "innir"],
])
const FAMILY_RULES: Array<{brandNodeId: number; pattern: RegExp; label: string}> = [
  {brandNodeId: 5223, pattern: /Deux[- ]Eyelet Long Handle Bag/i, label: "BLACKPURPLE Deux-Eyelet Long Handle Bag"},
  {brandNodeId: 5367, pattern: /Cotton Check Pattern/i, label: "MMM Cotton Check Pattern"},
]
const REQUESTED_PATTERNS = [
  /261 Camo Boy Shorts/i,
  /Deux[- ]Eyelet Long/i,
  /Deep Back V Tee/i,
  /Cotton Check Pattern/i,
]

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

const brandIds = [...new Set([...WOMEN_BRANDS.keys(), ...FAMILY_RULES.map((rule) => rule.brandNodeId)])]
const rows: ProductRow[] = []
for (let offset = 0; ; offset += 1000) {
  const {data, error} = await db
    .from("products")
    .select("id,name,brand_node_id,platform,product_url,gender,gender_source")
    .in("brand_node_id", brandIds)
    .order("id")
    .range(offset, offset + 999)
  if (error) throw error
  rows.push(...data as ProductRow[])
  if (!data || data.length < 1000) break
}

const decisions: Decision[] = []
for (const row of rows) {
  if (WOMEN_BRANDS.has(row.brand_node_id) && row.platform === "8division") {
    if (JSON.stringify(row.gender) !== JSON.stringify(["women"])) {
      decisions.push({...row, reason: "verified-women-brand", source: "repair_brand_scope"})
    }
    continue
  }
  const family = FAMILY_RULES.find(
    (rule) => rule.brandNodeId === row.brand_node_id && rule.pattern.test(row.name),
  )
  if (family && JSON.stringify(row.gender) !== JSON.stringify(["women"])) {
    decisions.push({...row, reason: "verified-product-family", source: "repair_text"})
  }
}

const requested = rows.filter((row) => REQUESTED_PATTERNS.some((pattern) => pattern.test(row.name)))
const requestedIds = new Set(requested.map((row) => row.id))
const decidedIds = new Set(decisions.map((row) => row.id))
const unresolvedRequested = requested.filter(
  (row) => JSON.stringify(row.gender) !== JSON.stringify(["women"]) && !decidedIds.has(row.id),
)
if (unresolvedRequested.length > 0) {
  throw new Error(`requested products lack a repair decision: ${unresolvedRequested.map((row) => row.id).join(",")}`)
}
if (requestedIds.size < 11) {
  throw new Error(`requested product precondition failed: expected at least 11 rows, found ${requestedIds.size}`)
}

const byReason = Object.fromEntries(
  [...new Set(decisions.map((row) => row.reason))].map((reason) => [
    reason,
    decisions.filter((row) => row.reason === reason).length,
  ]),
)
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  scanned: rows.length,
  updates: decisions.length,
  byReason,
  requested: requested.map(({id, name, platform, gender, gender_source}) => ({
    id, name, platform, before: gender, before_source: gender_source,
    after: ["women"],
  })),
}, null, 2))

if (apply) {
  const updatedAt = new Date().toISOString()
  let updatedCount = 0
  for (const source of ["repair_brand_scope", "repair_text"] as const) {
    const group = decisions.filter((decision) => decision.source === source)
    for (let index = 0; index < group.length; index += 100) {
      const batch = group.slice(index, index + 100)
      const ids = batch.map((row) => row.id)
      const {data: updated, error} = await db
        .from("products")
        .update({gender: ["women"], gender_source: source, updated_at: updatedAt})
        .in("id", ids)
        .select("id")
      if (error) throw error
      if ((updated?.length ?? 0) !== ids.length) {
        throw new Error(`update count mismatch: expected=${ids.length} actual=${updated?.length ?? 0}`)
      }
      updatedCount += updated.length
    }
  }
  console.log(`updated_products=${updatedCount}`)
}

const {data: verified, error: verifyError} = await db
  .from("products")
  .select("id,name,platform,gender,gender_source")
  .in("id", [...requestedIds])
  .order("id")
if (verifyError) throw verifyError
console.log(JSON.stringify({verified}, null, 2))
