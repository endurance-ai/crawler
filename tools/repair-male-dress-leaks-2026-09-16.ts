#!/usr/bin/env npx tsx
/**
 * Repair the 16 reported products leaking into the men's Dresses result.
 *
 * Dry-run by default. Pass --apply to update the 13 adult products and remove
 * the 3 Kith Kids products, which cannot be represented in the adult-only
 * men/women/unisex product schema.
 */
import {createClient} from "@supabase/supabase-js"

type ProductRow = {
  id: number
  name: string
  category: string
  subcategory: string | null
  gender: string[]
  gender_source: string | null
}

type UpdateFix = {
  id: number
  name: RegExp
  category: string
  subcategory: string | null
  gender?: "women"
}

const UPDATE_FIXES: UpdateFix[] = [
  {id: 887740, name: /DRESS COVER/i, category: "other", subcategory: null},
  {id: 887854, name: /BATH ROBE/i, category: "other", subcategory: null},
  {id: 542928, name: /dress #063/i, category: "shoes", subcategory: "boots"},
  {id: 453623, name: /MXR.*Dress Blues/i, category: "shoes", subcategory: "sneakers"},
  {id: 456040, name: /Skywalk GTX.*Dress Blues/i, category: "shoes", subcategory: "boots"},
  {id: 457610, name: /Skywalk GTX.*Dress Blues/i, category: "shoes", subcategory: "boots"},
  {id: 534908, name: /Lausanne Mesh Dress/i, category: "dresses", subcategory: null, gender: "women"},
  {id: 534193, name: /Iris Mini Dress/i, category: "dresses", subcategory: "mini-dress", gender: "women"},
  {id: 534194, name: /Bianca Mini Dress/i, category: "dresses", subcategory: "mini-dress", gender: "women"},
  {id: 478826, name: /Sleeveless Maxi Dress/i, category: "dresses", subcategory: "maxi-dress", gender: "women"},
  {id: 478507, name: /Twisted Long Dress/i, category: "dresses", subcategory: null, gender: "women"},
  {id: 478534, name: /Strap Dress/i, category: "dresses", subcategory: null, gender: "women"},
  {id: 478444, name: /Vest Dress/i, category: "dresses", subcategory: null, gender: "women"},
]

const DELETE_FIXES = [
  {id: 452506, name: /Kith Baby.*Dress/i},
  {id: 453399, name: /Kith Kids.*Jumpsuit/i},
  {id: 456615, name: /Kith Kids.*Camryn Dress/i},
]

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)
const allIds = [...UPDATE_FIXES, ...DELETE_FIXES].map((fix) => fix.id)

async function readRows(): Promise<ProductRow[]> {
  const {data, error} = await db
    .from("products")
    .select("id,name,category,subcategory,gender,gender_source")
    .in("id", allIds)
    .order("id")
  if (error) throw error
  return (data ?? []) as ProductRow[]
}

const before = await readRows()
const byId = new Map(before.map((row) => [row.id, row]))
for (const fix of UPDATE_FIXES) {
  const row = byId.get(fix.id)
  if (!row) throw new Error(`precondition failed: product ${fix.id} is missing`)
  if (!fix.name.test(row.name)) {
    throw new Error(`precondition failed: product ${fix.id} name=${JSON.stringify(row.name)}`)
  }
}
for (const fix of DELETE_FIXES) {
  const row = byId.get(fix.id)
  if (row && !fix.name.test(row.name)) {
    throw new Error(`precondition failed: product ${fix.id} name=${JSON.stringify(row.name)}`)
  }
}

console.log(JSON.stringify({mode: apply ? "apply" : "dry-run", before}, null, 2))

if (apply) {
  const updatedAt = new Date().toISOString()
  for (const fix of UPDATE_FIXES) {
    const row = byId.get(fix.id)!
    const payload: Record<string, unknown> = {
      category: fix.category,
      subcategory: fix.subcategory,
      updated_at: updatedAt,
    }
    if (fix.gender) {
      payload.gender = [fix.gender]
      payload.gender_source = "repair_text"
    }
    const {data, error} = await db
      .from("products")
      .update(payload)
      .eq("id", fix.id)
      .eq("name", row.name)
      .select("id")
    if (error) throw error
    if (data?.length !== 1) throw new Error(`update count mismatch for ${fix.id}`)
  }

  const deleteIds = DELETE_FIXES.filter((fix) => byId.has(fix.id)).map((fix) => fix.id)
  if (deleteIds.length > 0) {
    const {data: deleted, error: deleteError} = await db
      .from("products")
      .delete()
      .in("id", deleteIds)
      .select("id")
    if (deleteError) throw deleteError
    if (deleted?.length !== deleteIds.length) {
      throw new Error(`delete count mismatch: expected=${deleteIds.length} actual=${deleted?.length ?? 0}`)
    }
  }
}

const after = await readRows()
if (apply) {
  if (after.length !== UPDATE_FIXES.length) {
    throw new Error(`verification row count mismatch: expected=${UPDATE_FIXES.length} actual=${after.length}`)
  }
  const afterById = new Map(after.map((row) => [row.id, row]))
  for (const fix of UPDATE_FIXES) {
    const row = afterById.get(fix.id)
    if (!row || row.category !== fix.category || row.subcategory !== fix.subcategory) {
      throw new Error(`category verification failed for ${fix.id}`)
    }
    if (fix.gender && (JSON.stringify(row.gender) !== '["women"]' || row.gender_source !== "repair_text")) {
      throw new Error(`gender verification failed for ${fix.id}`)
    }
  }
  for (const fix of DELETE_FIXES) {
    if (afterById.has(fix.id)) throw new Error(`delete verification failed for ${fix.id}`)
  }
}

console.log(JSON.stringify({after}, null, 2))
