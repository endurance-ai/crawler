/**
 * Attach imported source products to the additive catalog identity layer.
 *
 * This command is intentionally safe for legacy crawls: source rows default
 * to stable singletons. Exact identifier + canonical color matching is only
 * enabled for an explicitly verified `--product-code` via `--auto-match`.
 * Domestic official-shop/retailer matching is pair-scoped and requires
 * shared source-product and image evidence. Ordinary refreshes preserve both.
 */
import {createClient} from "@supabase/supabase-js"
import {identifierProfileFor, makeIdentifier} from "./lib/catalog/identifiers"
import {decideCrossShopMatch, extractSourceProductTokens, type CatalogMatchDecision} from "./lib/catalog/matching"
import type {ProductIdentifier} from "./lib/catalog/types"

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
  primary_color?: string | null
  image_embedding?: number[] | null
  image_selection_version: string | null
  image_selected_at: string | null
}

type SyncOutcome = {
  autoMatchEligible: boolean
  attachedToExistingTarget: boolean
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
const autoMatch = process.argv.includes("--auto-match")
const crossShopAutoMatch = process.argv.includes("--cross-shop-auto-match")
const limit = Number(arg("limit") ?? "0") || 0
const platform = arg("platform")
const productCode = arg("product-code")
const productId = arg("product-id")
const productIds = (arg("product-ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const forceSingleton = process.argv.includes("--force-singleton")
const sourceProductId = arg("source-product-id")
const candidateProductId = arg("candidate-product-id")
if (autoMatch && !productCode) {
  throw new Error("--auto-match requires --product-code=<verified-code>; bulk auto matching stays disabled until precision is approved")
}
if (crossShopAutoMatch && (!sourceProductId || !candidateProductId || sourceProductId === candidateProductId)) {
  throw new Error("--cross-shop-auto-match requires two distinct --source-product-id and --candidate-product-id values")
}
if (crossShopAutoMatch && (platform || productCode || productId || limit > 0)) {
  throw new Error("cross-shop matching is pair-scoped; do not combine it with --platform, --product-code, --product-id, or --limit")
}
if (forceSingleton && (autoMatch || crossShopAutoMatch)) {
  throw new Error("--force-singleton cannot be combined with an automatic match mode")
}
const now = () => new Date().toISOString()

let crossShopDecision: CatalogMatchDecision | null = null
let crossShopIdentity: {productKey: string; variantKey: string; colorKey: string} | null = null

function normalizeKey(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function trustedIdentity(row: SourceRow, identifier: ProductIdentifier | null): {
  productKey: string
  variantKey: string
  colorKey: string
} | null {
  const colorKey = normalizeKey(row.primary_color ?? "")
  if (!autoMatch || !identifier || !colorKey) return null
  if (!["gtin", "mpn", "model_id", "product_group_id"].includes(identifier.kind)) return null
  const minimumTrust = identifier.kind === "gtin" ? 0.99 : 0.8
  if (identifier.trust < minimumTrust) return null
  const brandKey = row.brand_node_id ? `node-${row.brand_node_id}` : normalizeKey(row.brand)
  const productKey = `trusted:${brandKey}:${identifier.kind}:${identifier.namespace}:${identifier.normalized}`
  return {productKey, variantKey: `${productKey}:color:${colorKey}`, colorKey}
}

async function fetchRows(): Promise<SourceRow[]> {
  const rows: SourceRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    let query = db
      .from("products")
      .select("id,brand_node_id,brand,name,category,platform,product_code,product_url,image_url,price,original_price,sale_price,source_price,source_currency,in_stock,size_info,last_seen_at,image_selection_version,image_selected_at")
      .order("id", {ascending: true})
      .range(from, from + pageSize - 1)
    if (platform) query = query.eq("platform", platform)
    if (productCode) query = query.eq("product_code", productCode)
    if (productId) query = query.eq("id", productId)
    if (productIds.length > 0) query = query.in("id", productIds)
    if (crossShopAutoMatch) query = query.in("id", [sourceProductId!, candidateProductId!])
    const {data, error} = await query
    if (error) throw error
    rows.push(...((data ?? []) as SourceRow[]))
    if (!data || data.length < pageSize || (limit > 0 && rows.length >= limit)) break
  }
  const selected = limit > 0 ? rows.slice(0, limit) : rows
  for (let offset = 0; offset < selected.length; offset += 500) {
    const batch = selected.slice(offset, offset + 500)
    const {data, error} = await db
      .from("product_features")
      .select("product_id,feature_metadata")
      .in("product_id", batch.map((row) => row.id))
    if (error) throw error
    const colors = new Map((data ?? []).map((feature) => [
      String(feature.product_id),
      typeof feature.feature_metadata?.primary_color === "string"
        ? feature.feature_metadata.primary_color
        : null,
    ]))
    for (const row of batch) row.primary_color = colors.get(String(row.id)) ?? null
  }
  if (crossShopAutoMatch && selected.length > 0) {
    const {data, error} = await db
      .from("product_embeddings")
      .select("product_id,embedding")
      .in("product_id", selected.map((row) => row.id))
    if (error) throw error
    const embeddings = new Map((data ?? []).map((entry) => [String(entry.product_id), parseEmbedding(entry.embedding)]))
    for (const row of selected) row.image_embedding = embeddings.get(String(row.id)) ?? null
  }
  return selected
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const parsed = value.map(Number)
    return parsed.every(Number.isFinite) ? parsed : null
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (!trimmed) return null
  const parsed = trimmed.split(",").map(Number)
  return parsed.every(Number.isFinite) ? parsed : null
}

async function syncRow(row: SourceRow): Promise<SyncOutcome> {
  const sourceId = String(row.id)
  const singletonProductKey = `source:${sourceId}`
  const profile = identifierProfileFor(row.platform)
  const identifier = row.product_code
    ? makeIdentifier(profile.productCode, row.product_code, {
        namespace: profile.namespace,
        scope: profile.scope,
        level: profile.level,
        provenance: "products.product_code",
        trust: profile.productCode === "source_item_id" ? 0.25 : profile.productCode === "model_id" ? 0.95 : 0.8,
      })
    : null
  let trusted = trustedIdentity(row, identifier)
  if (crossShopIdentity) trusted = crossShopIdentity
  let targetExisted = false
  let existingTargetVariantId: number | string | null = null

  if (trusted) {
    const {data: existingProduct, error: existingProductError} = await db
      .from("catalog_products")
      .select("id,category")
      .eq("identity_key", trusted.productKey)
      .maybeSingle()
    if (existingProductError) throw existingProductError
    if (existingProduct?.category && row.category && normalizeKey(existingProduct.category) !== normalizeKey(row.category)) {
      trusted = null
    } else if (existingProduct) {
      const {data: existingVariant, error: existingVariantError} = await db
        .from("catalog_variants")
        .select("id")
        .eq("identity_key", trusted.variantKey)
        .maybeSingle()
      if (existingVariantError) throw existingVariantError
      if (existingVariant) {
        targetExisted = true
        existingTargetVariantId = existingVariant.id
      }
    }
  }

  if (dryRun) {
    return {autoMatchEligible: Boolean(trusted), attachedToExistingTarget: targetExisted}
  }

  const {data: previousOffer, error: previousOfferError} = await db
    .from("product_offers")
    .select("id,catalog_variant_id")
    .eq("platform", row.platform)
    .eq("source_product_key", row.product_url)
    .eq("source_variant_key", "default")
    .maybeSingle()
  if (previousOfferError) throw previousOfferError

  const {data: previousTarget, error: previousTargetError} = previousOffer?.catalog_variant_id
    ? await db
        .from("catalog_variants")
        .select("id,catalog_product_id,identity_key")
        .eq("id", previousOffer.catalog_variant_id)
        .maybeSingle()
    : {data: null, error: null}
  if (previousTargetError) throw previousTargetError

  // A regular singleton refresh must never undo a trusted match made by a
  // separately approved matching run.
  const preserveTrustedTarget = !forceSingleton && !trusted && (
    previousTarget?.identity_key?.startsWith("trusted:") || previousTarget?.identity_key?.startsWith("cross-shop:")
  )
  const identityKey = trusted?.productKey ?? singletonProductKey
  const seed = crossShopIdentity ? "cross_shop_composite" : trusted ? "trusted_identifier_color" : "source_singleton"

  let catalogProduct: {id: number | string}
  let variant: {id: number | string}

  if (preserveTrustedTarget) {
    catalogProduct = {id: previousTarget!.catalog_product_id}
    variant = {id: previousTarget!.id}
  } else {
    const {data: upsertedProduct, error: productError} = await db
      .from("catalog_products")
      .upsert({
        identity_key: identityKey,
        brand_node_id: row.brand_node_id,
        brand: row.brand,
        canonical_name: row.name,
        model_name: row.name,
        category: row.category,
        metadata: trusted
          ? {seed, identifier_kind: identifier?.kind, identifier_namespace: identifier?.namespace}
          : {seed, source_product_id: row.id},
        updated_at: now(),
        status: "active",
        merged_into_id: null,
      }, {onConflict: "identity_key"})
      .select("id")
      .single()
    if (productError) throw productError
    catalogProduct = upsertedProduct

    const variantKey = trusted?.variantKey ?? `${identityKey}:color:unknown`
    const {data: upsertedVariant, error: variantError} = await db
      .from("catalog_variants")
      .upsert({
        catalog_product_id: catalogProduct.id,
        color_key: trusted?.colorKey ?? null,
        color_label: trusted ? row.primary_color : null,
        images: row.image_url ? [row.image_url] : [],
        identity_key: variantKey,
        metadata: {seed},
        updated_at: now(),
        status: "active",
        merged_into_id: null,
      }, {onConflict: "identity_key"})
      .select("id")
      .single()
    if (variantError) throw variantError
    variant = upsertedVariant
  }

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

  if (identifier) {
    const {error: identifierError} = await db.from("product_identifiers").upsert({
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
    if (identifierError) throw identifierError
  }

  const {error: linkError} = await db.from("products").update({canonical_variant_id: variant.id}).eq("id", row.id)
  if (linkError) throw linkError

  const previousVariantId = previousOffer?.catalog_variant_id
  if (previousVariantId && String(previousVariantId) !== String(variant.id)) {
    const {data: previousVariant, error: previousVariantError} = await db
      .from("catalog_variants")
      .select("catalog_product_id,identity_key")
      .eq("id", previousVariantId)
      .maybeSingle()
    if (previousVariantError) throw previousVariantError
    if (previousVariant?.identity_key?.startsWith("source:")) {
      const {error: mergeVariantError} = await db
        .from("catalog_variants")
        .update({status: "merged", merged_into_id: variant.id, updated_at: now()})
        .eq("id", previousVariantId)
      if (mergeVariantError) throw mergeVariantError
      const {error: mergeProductError} = await db
        .from("catalog_products")
        .update({status: "merged", merged_into_id: catalogProduct.id, updated_at: now()})
        .eq("id", previousVariant.catalog_product_id)
      if (mergeProductError) throw mergeProductError
    }
  }

  const attachedToExistingTarget = Boolean(trusted && targetExisted && String(existingTargetVariantId) === String(variant.id))
  if (attachedToExistingTarget && (!previousVariantId || String(previousVariantId) !== String(variant.id))) {
    const {error: decisionError} = await db.from("catalog_match_decisions").insert({
      source_product_id: row.id,
      candidate_variant_id: variant.id,
      status: "auto",
      confidence: crossShopDecision?.confidence ?? (identifier?.kind === "gtin" ? 1 : 0.995),
      reason: crossShopDecision?.reason ?? "trusted_identifier_and_color_exact",
      evidence: crossShopDecision?.evidence ?? {
          identifier_kind: identifier?.kind,
          identifier_value: identifier?.normalized,
          identifier_namespace: identifier?.namespace,
          color_key: trusted?.colorKey,
        },
      matcher_version: crossShopDecision ? "catalog-cross-shop-v1" : "catalog-exact-v1",
    })
    if (decisionError) throw decisionError
  }

  return {autoMatchEligible: Boolean(trusted), attachedToExistingTarget}
}

async function main(): Promise<void> {
  const rows = await fetchRows()
  if (crossShopAutoMatch) {
    if (rows.length !== 2 || !rows.some((row) => String(row.id) === sourceProductId) || !rows.some((row) => String(row.id) === candidateProductId)) {
      throw new Error("both cross-shop source products must exist")
    }
    const [left, right] = [sourceProductId!, candidateProductId!].map((id) => rows.find((row) => String(row.id) === id)!)
    crossShopDecision = decideCrossShopMatch({
      brandKey: String(left.brand_node_id ?? left.brand), name: left.name, category: left.category,
      colorKey: left.primary_color, platform: left.platform, productUrl: left.product_url, imageEmbedding: left.image_embedding,
      imageReady: Boolean(left.image_selection_version && left.image_selected_at),
    }, {
      brandKey: String(right.brand_node_id ?? right.brand), name: right.name, category: right.category,
      colorKey: right.primary_color, platform: right.platform, productUrl: right.product_url, imageEmbedding: right.image_embedding,
      imageReady: Boolean(right.image_selection_version && right.image_selected_at),
    })
    crossShopDecision = {
      ...crossShopDecision,
      evidence: {
        ...crossShopDecision.evidence,
        sourceProductIds: [left.id, right.id],
        platforms: [left.platform, right.platform],
        colorKey: left.primary_color,
        category: left.category,
      },
    }
    console.log(`cross-shop decision: ${crossShopDecision.status} (${crossShopDecision.reason})`, crossShopDecision.evidence)
    if (crossShopDecision.status !== "auto") {
      if (!dryRun) throw new Error("cross-shop pair did not meet the automatic-match evidence gate; rerun with --dry-run to inspect")
      return
    }
    const sharedToken = String(crossShopDecision.evidence.sharedSourceToken ?? extractSourceProductTokens(left.product_url)[0])
    const brandKey = String(left.brand_node_id ?? normalizeKey(left.brand))
    const productKey = `cross-shop:${brandKey}:${normalizeKey(left.name)}:${normalizeKey(left.category ?? "")}:${sharedToken}`
    const colorKey = normalizeKey(left.primary_color ?? "")
    crossShopIdentity = {productKey, variantKey: `${productKey}:color:${colorKey}`, colorKey}
    rows.sort((a, b) => String(a.id) === sourceProductId ? -1 : String(b.id) === sourceProductId ? 1 : 0)
  }
  console.log(`catalog sync: ${rows.length} source products${dryRun ? " (dry-run)" : ""}`)
  let synced = 0
  let eligible = 0
  let matched = 0
  for (const row of rows) {
    const outcome = await syncRow(row)
    if (outcome.autoMatchEligible) eligible++
    if (outcome.attachedToExistingTarget) matched++
    synced++
    if (synced % 100 === 0 || synced === rows.length) console.log(`  ${synced}/${rows.length}`)
  }
  console.log(`catalog identity: eligible=${eligible} attached_to_existing=${matched} auto_match=${autoMatch || crossShopAutoMatch}`)
}

main().catch((error) => {
  console.error("catalog sync failed", error)
  process.exitCode = 1
})
