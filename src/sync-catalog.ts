/**
 * Attach imported source products to the additive catalog identity layer.
 *
 * This command is intentionally safe for legacy crawls: every source row gets
 * a stable singleton model/color variant first. A later matcher can merge
 * variants when identifier and color evidence is strong enough.
 */
import {createClient} from "@supabase/supabase-js"
import {identifierProfileFor, makeIdentifier} from "./lib/catalog/identifiers"

type SourceRow = {
  id: number | string
  brand_node_id: number | string | null
  brand: string
  name: string
  category: string | null
  platform: string
  product_code: string | null
  product_url: string
  image_url: string | null
  price: number | null
  original_price: number | null
  sale_price: number | null
  source_price: number | null
  source_currency: string | null
  in_stock: boolean
  size_info: string | null
  last_seen_at: string | null
}

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

const arg = (name: string): string | null => {
  const prefix = `--${name}=`
  const value = process.argv.find((entry) => entry.startsWith(prefix))
  return value ? value.slice(prefix.length) : null
}
const dryRun = process.argv.includes("--dry-run")
const limit = Number(arg("limit") ?? "0") || 0
const platform = arg("platform")
const now = () => new Date().toISOString()

async function fetchRows(): Promise<SourceRow[]> {
  const rows: SourceRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    let query = db
      .from("products")
      .select("id,brand_node_id,brand,name,category,platform,product_code,product_url,image_url,price,original_price,sale_price,source_price,source_currency,in_stock,size_info,last_seen_at")
      .order("id", {ascending: true})
      .range(from, from + pageSize - 1)
    if (platform) query = query.eq("platform", platform)
    const {data, error} = await query
    if (error) throw error
    rows.push(...((data ?? []) as SourceRow[]))
    if (!data || data.length < pageSize || (limit > 0 && rows.length >= limit)) break
  }
  return limit > 0 ? rows.slice(0, limit) : rows
}

async function syncRow(row: SourceRow): Promise<void> {
  const sourceId = String(row.id)
  const identityKey = `source:${sourceId}`
  if (dryRun) return

  const {data: catalogProduct, error: productError} = await db
    .from("catalog_products")
    .upsert({
      identity_key: identityKey,
      brand_node_id: row.brand_node_id,
      brand: row.brand,
      canonical_name: row.name,
      model_name: row.name,
      category: row.category,
      metadata: {seed: "source_singleton", source_product_id: row.id},
      updated_at: now(),
    }, {onConflict: "identity_key"})
    .select("id")
    .single()
  if (productError) throw productError

  const variantKey = `${identityKey}:color:unknown`
  const {data: variant, error: variantError} = await db
    .from("catalog_variants")
    .upsert({
      catalog_product_id: catalogProduct.id,
      color_key: null,
      color_label: null,
      images: row.image_url ? [row.image_url] : [],
      identity_key: variantKey,
      metadata: {seed: "source_singleton"},
      updated_at: now(),
    }, {onConflict: "identity_key"})
    .select("id")
    .single()
  if (variantError) throw variantError

  const {data: offer, error: offerError} = await db
    .from("product_offers")
    .upsert({
      source_product_id: row.id,
      catalog_variant_id: variant.id,
      platform: row.platform,
      source_product_key: row.product_url,
      source_variant_key: "default",
      product_url: row.product_url,
      listed_price: row.price,
      original_price: row.original_price,
      sale_price: row.sale_price,
      source_price: row.source_price,
      source_currency: row.source_currency,
      in_stock: row.in_stock,
      size_info: row.size_info,
      sizes: row.size_info ? [row.size_info] : [],
      last_seen_at: row.last_seen_at,
      updated_at: now(),
    }, {onConflict: "platform,source_product_key,source_variant_key"})
    .select("id")
    .single()
  if (offerError) throw offerError

  if (row.product_code) {
    const profile = identifierProfileFor(row.platform)
    const identifier = makeIdentifier(profile.productCode, row.product_code, {
      namespace: profile.namespace,
      scope: profile.scope,
      level: profile.level,
      provenance: "products.product_code",
      trust: profile.productCode === "source_item_id" ? 0.25 : profile.productCode === "model_id" ? 0.95 : 0.8,
    })
    if (identifier) {
      await db.from("product_identifiers").upsert({
        product_offer_id: offer.id,
        kind: identifier.kind,
        raw_value: identifier.raw,
        normalized_value: identifier.normalized,
        namespace: identifier.namespace,
        scope: identifier.scope,
        level: identifier.level,
        provenance: identifier.provenance,
        trust: identifier.trust,
      }, {onConflict: "dedupe_key"})
    }
  }

  const {error: linkError} = await db.from("products").update({canonical_variant_id: variant.id}).eq("id", row.id)
  if (linkError) throw linkError
}

async function main(): Promise<void> {
  const rows = await fetchRows()
  console.log(`catalog sync: ${rows.length} source products${dryRun ? " (dry-run)" : ""}`)
  let synced = 0
  for (const row of rows) {
    await syncRow(row)
    synced++
    if (synced % 100 === 0 || synced === rows.length) console.log(`  ${synced}/${rows.length}`)
  }
}

main().catch((error) => {
  console.error("catalog sync failed", error)
  process.exitCode = 1
})
