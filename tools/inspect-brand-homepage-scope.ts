#!/usr/bin/env npx tsx
/** Read-only context for a bounded brand homepage audit. */
import {createClient} from "@supabase/supabase-js"

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)
const minId = Number(process.argv.find((arg) => arg.startsWith("--min="))?.split("=")[1] ?? 5793)
const maxId = Number(process.argv.find((arg) => arg.startsWith("--max="))?.split("=")[1] ?? Number.MAX_SAFE_INTEGER)

const {data: brands, error} = await db
  .from("brand_nodes")
  .select("id,brand_name,wiki")
  .gte("id", minId)
  .lte("id", maxId)
  .order("id")
if (error) throw error

for (const brand of brands ?? []) {
  const wiki = brand.wiki && typeof brand.wiki === "object" ? brand.wiki as Record<string, unknown> : {}
  const homepage = typeof wiki.homepage_url === "string" ? wiki.homepage_url : null
  const {data: products, error: productError} = await db
    .from("products")
    .select("platform,name,product_url")
    .eq("brand_node_id", brand.id)
    .limit(3)
  if (productError) throw productError
  console.log(JSON.stringify({id: brand.id, brandName: brand.brand_name, homepage, products}))
}
