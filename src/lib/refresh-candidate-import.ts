import {toPriceFields} from "./listing-refresh"
import type {Product, SiteConfig} from "./types"

export const REFRESH_FALLBACK_IMAGE_VERSION = "refresh-fallback-v1"

export function withFallbackImageSelection(product: Product): Product {
  if (product.imageSelection?.version) return product
  const images = [
    product.imageUrl,
    ...(product.images ?? []),
  ].filter((url, index, rows) => Boolean(url) && rows.indexOf(url) === index).slice(0, 10)
  if (images.length === 0) throw new Error("candidate has no image")
  return {
    ...product,
    sourceImageUrl: product.sourceImageUrl || product.imageUrl,
    imageUrl: images[0],
    images,
    imageSelection: {
      kind: "fallback",
      score: 0,
      version: REFRESH_FALLBACK_IMAGE_VERSION,
      candidateCount: images.length,
      selectedAt: new Date().toISOString(),
    },
  }
}
function productNumber(raw: string): number | null {
  try {
    const url = new URL(raw)
    const query = url.searchParams.get("product_no")
    if (query && /^\d+$/.test(query)) return Number(query)
    const rewritten = url.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)
    return rewritten ? Number(rewritten[1]) : null
  } catch {
    return null
  }
}

export function productToCandidateDbRow(
  product: Product,
  config: SiteConfig,
  brandNodeId: number,
): Record<string, unknown> {
  const selected = withFallbackImageSelection(product)
  const sourceCurrency = selected.sourceCurrency ?? config.sourceCurrency ?? "KRW"
  const prices = toPriceFields(selected, sourceCurrency)
  if (!prices) throw new Error("candidate price is missing or invalid")
  const now = new Date().toISOString()
  return {
    brand: selected.brand,
    name: selected.name,
    category: selected.category,
    price: prices.price,
    original_price: prices.original_price,
    sale_price: prices.sale_price,
    source_currency: sourceCurrency,
    source_price: selected.sourcePrice ?? selected.price,
    product_no: productNumber(selected.productUrl),
    image_url: selected.imageUrl,
    source_image_url: selected.sourceImageUrl ?? selected.imageUrl,
    product_url: selected.productUrl,
    in_stock: selected.inStock,
    platform: config.key,
    brand_node_id: brandNodeId,
    crawled_at: selected.crawledAt,
    subcategory: selected.subcategory ?? null,
    images: selected.images?.slice(0, 10) ?? null,
    image_selection_kind: selected.imageSelection!.kind,
    image_selection_score: selected.imageSelection!.score,
    image_selection_version: selected.imageSelection!.version,
    image_selection_candidate_count: selected.imageSelection!.candidateCount,
    image_selected_at: selected.imageSelection!.selectedAt,
    last_seen_at: now,
    updated_at: now,
  }
}
