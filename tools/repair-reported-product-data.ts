#!/usr/bin/env npx tsx

/**
 * Repair the reported product-level gender values and safe 8DIVISION brand
 * aliases. This tool never deletes products or brand nodes; unknown vendor
 * labels remain untouched until a canonical node is verified.
 *
 * Usage:
 *   tsx tools/repair-reported-product-data.ts
 *   tsx tools/repair-reported-product-data.ts --apply
 */
import {createClient} from "@supabase/supabase-js"

type Row = {
  id: number
  name: string
  brand: string | null
  platform: string
  brand_node_id: number
  gender: unknown
  gender_source: string | null
}

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)
const apply = process.argv.includes("--apply")

function key(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9가-힣]/g, "")
}

async function loadAll<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const {data, error} = await db.from(table).select(columns).range(offset, offset + 999)
    if (error) throw error
    rows.push(...(data ?? []) as T[])
    if ((data ?? []).length < 1000) return rows
  }
}

const products = await loadAll<Row>(
  "products",
  "id,name,brand,platform,brand_node_id,gender,gender_source",
)
const brandNodes = await loadAll<{id: number; brand_name: string; brand_name_normalized: string | null}>(
  "brand_nodes",
  "id,brand_name,brand_name_normalized",
)

const owners = new Map<string, number | null>()
for (const node of brandNodes) {
  for (const raw of [node.brand_name, node.brand_name_normalized].filter(Boolean) as string[]) {
    const k = key(raw)
    const previous = owners.get(k)
    owners.set(k, previous === undefined ? node.id : previous === node.id ? previous : null)
  }
}

// These are the retailer's own labels, not vendor brands. The canonical
// 8DIVISION node is already verified in brand_nodes (id 5794).
owners.set(key("8DIVISION"), 5794)
owners.set(key("8DIVISION RTW"), 5794)
owners.set(key("8디비전"), 5794)

const changes: Array<{id: number; field: string; before: unknown; after: unknown; reason: string}> = []

for (const row of products) {
  if (row.platform === "8division" && row.brand_node_id === 2120 && row.brand) {
    const canonicalId = owners.get(key(row.brand))
    if (canonicalId !== undefined && canonicalId !== null && canonicalId !== 2120) {
      changes.push({id: row.id, field: "brand_node_id", before: row.brand_node_id, after: canonicalId, reason: `canonical-brand:${row.brand}`})
    }
  }

  const name = row.name
  const reportedWomen =
    /^(Fitted Basic Shirt|Rhinestone Raglan Tee|Cross Paper Long Sleeve|Insane Vintage|SIDE TIE BIKINI)/i.test(name)
  if (reportedWomen && JSON.stringify(row.gender) !== JSON.stringify(["women"])) {
    changes.push({id: row.id, field: "gender", before: row.gender, after: ["women"], reason: "reported-women-product"})
  }
  if (reportedWomen && row.gender_source !== "repair_text") {
    changes.push({id: row.id, field: "gender_source", before: row.gender_source, after: "repair_text", reason: "reported-women-product"})
  }
}

const grouped = new Map<string, typeof changes>()
for (const change of changes) {
  const list = grouped.get(`${change.field}:${JSON.stringify(change.after)}`) ?? []
  list.push(change)
  grouped.set(`${change.field}:${JSON.stringify(change.after)}`, list)
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  scanned_products: products.length,
  scanned_brand_nodes: brandNodes.length,
  changes: changes.length,
  by_field: Object.fromEntries([...grouped].map(([name, rows]) => [name, rows.length])),
  samples: changes.slice(0, 25),
}, null, 2))

if (!apply) process.exit(0)

const updatedAt = new Date().toISOString()
let updated = 0
for (const [groupName, rows] of grouped) {
  const field = groupName.split(":", 1)[0]
  const value = rows[0].after
  for (let offset = 0; offset < rows.length; offset += 100) {
    const ids = rows.slice(offset, offset + 100).map((row) => row.id)
    const {data, error} = await db
      .from("products")
      .update({[field]: value, updated_at: updatedAt})
      .in("id", ids)
      .select("id")
    if (error) throw error
    if ((data ?? []).length !== ids.length) throw new Error(`update count mismatch for ${field}`)
    updated += data?.length ?? 0
  }
}

console.log(`updated_products=${updated}`)

const ids = [...new Set(changes.map((change) => change.id))]
const {data: verified, error} = await db
  .from("products")
  .select("id,name,brand,brand_node_id,gender,gender_source")
  .in("id", ids)
if (error) throw error
const expected = new Map<number, Row>()
for (const row of products) expected.set(row.id, row)
for (const row of verified ?? []) {
  const original = expected.get(row.id)
  if (!original) continue
  const wantedGender = /^(Fitted Basic Shirt|Rhinestone Raglan Tee|Cross Paper Long Sleeve|Insane Vintage|SIDE TIE BIKINI)/i.test(row.name)
  if (wantedGender && (JSON.stringify(row.gender) !== JSON.stringify(["women"]) || row.gender_source !== "repair_text")) {
    throw new Error(`verification failed for product ${row.id}`)
  }
}
console.log(`verified_products=${verified?.length ?? 0}`)
