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
  // A knit vest is knitwear; generic `vest` below remains outerwear.
  [/\bknit(?:ted)?[-\s]+vest\b/, "knitwear"],
  // Outerwear (cardigan intentionally excluded → knitwear)
  [/\b(coat|jacket|parka|anorak|blazer|vest|bomber|windbreaker|fleece|cape|poncho|happi|outerwear|outers|overshirt|blouson|trench|overcoat|puffer|chaqueta)\b/, "outerwear"],
  // Knitwear (sweater/knit/cardigan split out of Top)
  [/\b(sweater|sweaters|cardigan|cardigans|knitwear|knits|knit|pullover|turtleneck)\b/, "knitwear"],
  // Tops
  [/\b(shirt|shirts|top|tops|tee|tees|t-shirt|t-shirts|hoodie|hoodies|sweatshirt|sweatshirts|blouse|blouses|polo|polos|tank|longsleeve|long[-\s]?sleeve|sleeveless|crewneck|full[-\s]?zip|jersey|henley|camisole|rugby|crop-top|camiseta)\b/, "tops"],
  // Swimwear before bottoms/underwear: explicit swim trunks are swimwear,
  // while fashion brands also use bare "trunks" for tailored shorts.
  [/\b(swim|swimsuit|swimwear|bikini|(?:swim|swimming|bathing)[-\s]+trunks?|rashguard|rash\s+guard|bañador)\b/, "swimwear"],
  // Bottoms
  [/\b(pant|pants|jean|jeans|trouser|trousers|short|shorts|trunk|trunks|skirt|skirts|bottom|bottoms|chino|chinos|jogger|joggers|cargo|legging|leggings|culotte|culottes|sweatpant|sweatpants)\b/, "bottoms"],
  // Shoes
  [/\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|sandal|sandals|footwear|mule|mules|heel|heels|flat|flats|slide|slides|oxford|derby|trainer|trainers)\b/, "shoes"],
  // Bags
  [/\b(bag|bags|tote|totes|backpack|backpacks|clutch|purse|purses|messenger|pouch|pouches|satchel|bolsa)\b/, "bags"],
  // Eyewear (before accessories)
  [/\b(sunglass|sunglasses|eyewear|glasses|goggles)\b/, "eyewear"],
  // Jewelry
  [/\b(necklace|bracelet|ring|rings|earring|earrings|jewelry|jewellery|pendant|anklet|bangle|signet|anillo|collar|pendiente|pulsera|colgante)\b/, "jewelry"],
  // Headwear
  [/\b(hat|hats|cap|caps|beanie|balaclava|beret|bucket\s*hat|trucker|59fifty|gorra)\b/, "headwear"],
  // Accessories (residual)
  [/\b(scarf|scarves|belt|belts|watch|watches|tie|ties|glove|gloves|sock|socks|wallet|wallets|fragrance|perfume|accessories|accessory|acc|leatheracc|phonecase|iphone[-\s]?case|card[-\s]?holder|diary|laptop[-\s]?sleeve|tablet[-\s]?sleeve|rug|home[-\s]?acc|muffler|lighter|towel|money[-\s]?clip|carabiner|keychain|ashtray|golf[-\s]?balls?|steering[-\s]?wheel[-\s]?cover|door[-\s]?latch|stamp|mechero|cenicero|cerrojo|golf)\b/, "accessories"],
  // Underwear
  [/\b(underwear|brief|briefs|boxer|boxers|bra|bras|lingerie|panties|panty|thong|thongs|home[-\s]?under)\b/, "underwear"],
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
  // Cafe24 often joins the product name and colour with an underscore
  // (`CARDIGAN_black`). In JavaScript regexes `_` is a word character, so a
  // normal `\bcardigan\b` rule cannot see the category token unless separators
  // are normalized first.
  const normalizeSeparators = (value: string) => value.toLowerCase().replace(/_/g, " ")
  const typeLower = normalizeSeparators(productType.trim())
  const titleLower = normalizeSeparators(title)
  const tagsText = tags.map((t) => normalizeSeparators(t)).join(" ")
  // combined signal for subcategory and fallback category matching
  const combined = `${titleLower} ${tagsText}`

  // A verified non-fashion storefront may intentionally opt into the
  // canonical catch-all so QC/Qwen can preserve and normalize its products.
  if (typeLower === "other") {
    return {category: "other", subcategory: undefined}
  }

  // 1. Try product_type (skip noise values)
  let category: Category | undefined
  if (typeLower && !NOISE_TYPES.has(typeLower)) {
    category = matchCategory(typeLower)
  }

  // 일부 몰은 후디·액티브웨어를 넓은 Shopify 타입인 "Sweater"로 묶는다.
  // 프로젝트 taxonomy에서는 명시적 Hoodie는 tops, activewear 태그 상품은
  // activewear다. 구체적인 상품명/부서 태그가 generic knitwear 타입을 이긴다.
  if (category === "knitwear" && /\b(zip[-\s]?)?hoodie\b/.test(titleLower)) {
    category = "tops"
  } else if (category === "knitwear" && /\bactivewear\b/.test(tagsText)) {
    category = "activewear"
  }

  // 2. Try tags
  if (!category && tagsText) {
    category = matchCategory(tagsText)
  }

  // 3. Try title
  if (!category) {
    // Twojeys legacy names: a bare "TJ x Cabrio" is the parent swimwear SKU;
    // "Cabrio Pinky Ring" must still resolve from the explicit Ring token.
    if (/^tj x cabr?io$/.test(titleLower.trim())) category = "swimwear"
    // Chain as the final noun denotes the jewelry itself. Do not match names
    // such as "Icon Chain Beanie", where Chain is only a design modifier.
    else if (/\bchain$/.test(titleLower.trim())) category = "jewelry"
    else if (/\bwool\s+base\b/.test(titleLower)) category = "tops"
    else category = matchCategory(titleLower)
  }

  if (!category) {
    return {category: "", subcategory: undefined}
  }

  const subcategory = matchSubcategory(category, combined)

  return {category, subcategory: subcategory ?? undefined}
}
