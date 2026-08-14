#!/usr/bin/env npx tsx
import {createClient} from "@supabase/supabase-js"

const summary = process.argv.includes("--summary")
const ids = process.argv.slice(2).map(Number).filter(Number.isFinite)
if (ids.length === 0) throw new Error("pass one or more brand_node ids")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

const db = createClient(dbUrl, dbToken)
const {data: brands, error: brandError} = await db
  .from("brand_nodes")
  .select("id,brand_name,brand_name_normalized,source_platforms,gender_scope,wiki")
  .in("id", ids)
  .order("id")
if (brandError) throw brandError
const {data, error, count} = await db
  .from("products")
  .select("brand_node_id,name,product_url,platform", {count: "exact"})
  .in("brand_node_id", ids)
  .order("brand_node_id")
  .limit(200)
if (error) throw error
const {data: statuses, error: statusError} = await db
  .from("product_crawl_status")
  .select("brand_node_id,status,platform_key,platform_type,created_at")
  .in("brand_node_id", ids)
if (statusError) throw statusError
if (summary) {
  console.log(JSON.stringify({brands: brands?.map((brand) => ({
    id: brand.id,
    brand_name: brand.brand_name,
    source_platforms: brand.source_platforms,
    gender_scope: brand.gender_scope,
    origin_country: (brand.wiki as Record<string, unknown> | null)?.origin_country,
    instagram_url: (brand.wiki as Record<string, unknown> | null)?.instagram_url,
    instagram_handle: (brand.wiki as Record<string, unknown> | null)?.instagram_handle,
    sources: (brand.wiki as Record<string, unknown> | null)?.sources,
  })), productCount: count, statuses}, null, 2))
} else {
  console.log(JSON.stringify({brands, products: data, statuses}, null, 2))
}
