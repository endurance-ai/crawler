#!/usr/bin/env npx tsx
/**
 * Detach products incorrectly assigned to SCULPTOR by the former sculpstore
 * platform-level brand fallback. Products are preserved for later brand-level
 * re-resolution; only the false brand_node association is cleared.
 */
import {createClient} from "@supabase/supabase-js"

const BRAND_NODE_ID = 834
const PLATFORM_KEY = "sculpstore"
const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

const {count, error: countError} = await db
  .from("products")
  .select("id", {count: "exact", head: true})
  .eq("brand_node_id", BRAND_NODE_ID)
  .eq("platform", PLATFORM_KEY)
if (countError) throw countError

const {data: brand, error: brandError} = await db
  .from("brand_nodes")
  .select("id,brand_name,wiki")
  .eq("id", BRAND_NODE_ID)
  .single()
if (brandError) throw brandError
if (brand.brand_name !== "SCULPTOR") throw new Error(`unexpected node ${BRAND_NODE_ID}: ${brand.brand_name}`)

const {data: status, error: statusError} = await db
  .from("product_crawl_status")
  .select("brand_node_id,status,platform_key")
  .eq("brand_node_id", BRAND_NODE_ID)
  .maybeSingle()
if (statusError) throw statusError
if (status?.platform_key && status.platform_key !== PLATFORM_KEY) {
  throw new Error(`refusing to replace unexpected platform mapping: ${status.platform_key}`)
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  brandNodeId: BRAND_NODE_ID,
  brandName: brand.brand_name,
  platform: PLATFORM_KEY,
  contaminatedProducts: count ?? 0,
  status,
  action: "preserve products; set products.brand_node_id=null; detach retailer status mapping",
}, null, 2))

if (apply) {
  const repairedAt = new Date().toISOString()
  const {error: productError} = await db
    .from("products")
    .update({brand_node_id: null})
    .eq("brand_node_id", BRAND_NODE_ID)
    .eq("platform", PLATFORM_KEY)
  if (productError) throw productError

  if (status) {
    const {error} = await db
      .from("product_crawl_status")
      .update({
        status: "qc_failed",
        platform_key: null,
        last_error: `Detached invalid multi-brand retailer mapping '${PLATFORM_KEY}' on ${repairedAt}; ${count ?? 0} product associations cleared for re-resolution.`,
      })
      .eq("brand_node_id", BRAND_NODE_ID)
      .eq("platform_key", PLATFORM_KEY)
    if (error) throw error
  }

  const wiki = brand.wiki && typeof brand.wiki === "object" ? brand.wiki : {}
  const {error: wikiError} = await db
    .from("brand_nodes")
    .update({wiki: {
      ...wiki,
      product_brand_contamination_repaired_at: repairedAt,
      product_brand_contamination_platform: PLATFORM_KEY,
      product_brand_contamination_detached_count: count ?? 0,
      product_brand_contamination_note:
        "SCULPSTORE is a multi-brand retailer. Products assigned through its former fixed SCULPTOR fallback were detached, preserved, and left for product-level brand re-resolution.",
    }})
    .eq("id", BRAND_NODE_ID)
  if (wikiError) throw wikiError
}

