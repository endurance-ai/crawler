import type {SupabaseClient} from "@supabase/supabase-js"

import type {EditShopListingPlacement, Product} from "./types"

export const EDIT_SHOP_PLATFORMS = new Set([
  "slowsteadyclub",
  "8division",
  "etcseoul",
  "fr8ight",
  "kith",
])

export interface ListingSnapshotItem {
  product_no: number
  source_rank: number
}

export interface CategoryListingSnapshot {
  listKey: string
  displayName: string
  capturedAt: string
  items: ListingSnapshotItem[]
}

export function productNoFromUrl(productUrl: string): number | null {
  try {
    const url = new URL(productUrl)
    const queryValue = url.searchParams.get("product_no")
    if (queryValue && /^\d+$/.test(queryValue)) return Number(queryValue)
  } catch {
    // Fall through to path matching for relative or malformed legacy URLs.
  }
  const match = productUrl.match(/\/product\/[^/]+\/(\d+)(?:\/|$)/)
  return match ? Number(match[1]) : null
}

export function extractWhat100ProductNos(html: string): number[] {
  const ordered: number[] = []
  const seen = new Set<number>()
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1]!.replaceAll("&amp;", "&")
    let url: URL
    try {
      url = new URL(href, "https://m.slowsteadyclub.com")
    } catch {
      continue
    }
    if (url.searchParams.get("display_group") !== "9") continue
    const raw = url.searchParams.get("product_no")
    if (!raw || !/^\d+$/.test(raw)) continue
    const productNo = Number(raw)
    if (seen.has(productNo)) continue
    seen.add(productNo)
    ordered.push(productNo)
  }
  return ordered
}

export function validateWhat100ProductNos(productNos: readonly number[]): void {
  const unique = new Set(productNos)
  if (productNos.length !== 100 || unique.size !== 100 || productNos.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error(`what100 incomplete: expected 100 unique positive products, got ${unique.size}`)
  }
}

export function collectCategoryListingSnapshots(
  products: Array<Pick<Product, "productUrl" | "listingPlacements">>,
): CategoryListingSnapshot[] {
  const grouped = new Map<string, {displayName: string; capturedAt: string; rows: Array<{no: number; placement: EditShopListingPlacement}>}>()
  for (const product of products) {
    const productNo = productNoFromUrl(product.productUrl)
    if (productNo === null) continue
    for (const placement of product.listingPlacements ?? []) {
      const current = grouped.get(placement.listKey) ?? {
        displayName: placement.displayName,
        capturedAt: placement.capturedAt,
        rows: [],
      }
      current.displayName = placement.displayName
      if (placement.capturedAt > current.capturedAt) current.capturedAt = placement.capturedAt
      current.rows.push({no: productNo, placement})
      grouped.set(placement.listKey, current)
    }
  }

  return [...grouped.entries()].map(([listKey, group]) => {
    const firstByProduct = new Map<number, number>()
    for (const row of group.rows) {
      const previous = firstByProduct.get(row.no)
      if (previous === undefined || row.placement.sourceRank < previous) {
        firstByProduct.set(row.no, row.placement.sourceRank)
      }
    }
    const items = [...firstByProduct.entries()]
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .map(([product_no, source_rank]) => ({product_no, source_rank}))
    return {listKey, displayName: group.displayName, capturedAt: group.capturedAt, items}
  })
}

export async function persistCategoryListingSnapshots(
  db: SupabaseClient,
  platform: string,
  products: Array<Pick<Product, "productUrl" | "listingPlacements">>,
): Promise<number> {
  if (!EDIT_SHOP_PLATFORMS.has(platform)) return 0
  const snapshots = collectCategoryListingSnapshots(products).filter((snapshot) => snapshot.items.length > 0)
  for (const snapshot of snapshots) {
    const {error} = await db.rpc("replace_edit_shop_listing_snapshot", {
      p_platform: platform,
      p_list_type: "category",
      p_list_key: snapshot.listKey,
      p_display_name: snapshot.displayName,
      p_captured_at: snapshot.capturedAt,
      p_items: snapshot.items,
    })
    if (error) throw new Error(`edit-shop category snapshot ${platform}/${snapshot.listKey}: ${error.message}`)
  }
  return snapshots.length
}

