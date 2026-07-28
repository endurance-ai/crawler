/**
 * Rule-based category/subcategory classifier for Shopify products.
 *
 * Shopify's `product_type` field is unreliable — stores commonly use
 * "Clothing", "Apparel", or leave it blank. This classifier normalises
 * the raw signal (product_type + title + tags) into the project's
 * standard taxonomy defined in product-enums.ts.
 *
 * Resolution order:
 *   1. product_type  — specific value from store owner (most authoritative)
 *   2. tags          — per-product labels, often contain category hints
 *   3. title         — last resort; keyword scan of the product name
 *
 * Subcategory is inferred from (title + tags) after category is resolved.
 */

import type {Category} from "./enums/product-enums"
import {matchSubcategory} from "./subcategory-classifier"

export interface ClassifyResult {
  category: string
  subcategory: string | undefined
}

// ─── Noise values to ignore in product_type ──────────────────────

const NOISE_TYPES = new Set([
  "clothing", "apparel", "fashion", "product", "item", "goods",
  "garment", "garments", "wear", "womenswear", "menswear", "unisex",
  "new arrivals", "new arrival", "sale", "seasonal", "collection",
  "collab", "collaboration", "limited", "archive",
])

// ─── product_type → Category ──────────────────────────────────────

const TYPE_TO_CATEGORY: [RegExp, Category][] = [
  // Dresses first (so "shirt dress" → dresses, not tops)
  [/\b(dress|dresses|jumpsuit|romper)\b/, "dresses"],
  // Outerwear (cardigan intentionally excluded → knitwear)
  [/\b(coat|jacket|parka|anorak|blazer|vest|bomber|windbreaker|fleece|cape|poncho|shearling|outerwear|overshirt|blouson|trench|overcoat|puffer)\b/, "outerwear"],
  // Knitwear (sweater/knit/cardigan split out of Top)
  [/\b(sweater|sweaters|cardigan|cardigans|knitwear|knits|knit|pullover|turtleneck)\b/, "knitwear"],
  // Tops
  [/\b(shirt|shirts|top|tops|tee|tees|t-shirt|t-shirts|hoodie|hoodies|sweatshirt|sweatshirts|blouse|blouses|polo|polos|tank|longsleeve|jersey|henley|camisole|rugby|crop-top)\b/, "tops"],
  // Bottoms
  [/\b(pant|pants|jean|jeans|trouser|trousers|short|shorts|skirt|skirts|bottom|bottoms|chino|chinos|jogger|joggers|cargo|legging|leggings|culotte|culottes|sweatpant|sweatpants)\b/, "bottoms"],
  // Shoes
  [/\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|sandal|sandals|footwear|mule|mules|heel|heels|flat|flats|slide|slides|oxford|derby|trainer|trainers)\b/, "shoes"],
  // Bags
  [/\b(bag|bags|tote|totes|backpack|backpacks|clutch|purse|purses|wallet|wallets|messenger|pouch|pouches|satchel)\b/, "bags"],
  // Eyewear (before accessories)
  [/\b(sunglass|sunglasses|eyewear|glasses|goggles)\b/, "eyewear"],
  // Jewelry
  [/\b(necklace|bracelet|ring|rings|earring|earrings|jewelry|jewellery|pendant|anklet|bangle)\b/, "jewelry"],
  // Headwear
  [/\b(hat|hats|cap|caps|beanie|balaclava|beret|bucket\s*hat)\b/, "headwear"],
  // Accessories (residual)
  [/\b(scarf|scarves|belt|belts|watch|watches|tie|ties|glove|gloves|sock|socks|accessories|accessory|muffler)\b/, "accessories"],
  // Underwear
  [/\b(underwear|briefs|boxer|boxers|bra|bras|lingerie|panties|panty)\b/, "underwear"],
  // Swimwear
  [/\b(swimsuit|swimwear|bikini|trunks|rashguard|rash\s+guard)\b/, "swimwear"],
  // Activewear
  [/\b(activewear|tracksuit|sportswear|sports\s*bra|athletic|yoga)\b/, "activewear"],
]

// ─── Helpers ──────────────────────────────────────────────────────
// Subcategory keyword maps live in ./subcategory-classifier (shared with the
// QC gate and the repair script — one regex set, no duplication).

function matchCategory(text: string): Category | undefined {
  for (const [re, cat] of TYPE_TO_CATEGORY) {
    if (re.test(text)) return cat
  }
  return undefined
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Classify a Shopify product into the project's standard taxonomy.
 *
 * Returns an empty string for category when no signal is strong enough
 * (preserves the existing blank-category behavior for unrecognised items).
 */
export function classifyShopifyCategory(
  productType: string,
  title: string,
  tags: string[],
): ClassifyResult {
  const typeLower = productType.trim().toLowerCase()
  const titleLower = title.toLowerCase()
  const tagsText = tags.map((t) => t.toLowerCase()).join(" ")
  // combined signal for subcategory and fallback category matching
  const combined = `${titleLower} ${tagsText}`

  // 1. Try product_type (skip noise values)
  let category: Category | undefined
  if (typeLower && !NOISE_TYPES.has(typeLower)) {
    category = matchCategory(typeLower)
  }

  // 2. Try tags
  if (!category && tagsText) {
    category = matchCategory(tagsText)
  }

  // 3. Try title
  if (!category) {
    category = matchCategory(titleLower)
  }

  if (!category) {
    return {category: "", subcategory: undefined}
  }

  const subcategory = matchSubcategory(category, combined)

  return {category, subcategory: subcategory ?? undefined}
}
