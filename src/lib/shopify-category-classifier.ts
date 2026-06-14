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
  // Outer
  [/\b(coat|jacket|parka|anorak|blazer|cardigan|vest|bomber|windbreaker|fleece|cape|poncho|shearling|outerwear|overshirt|blouson)\b/, "Outer"],
  // Dress (before Top/Bottom to catch "dress")
  [/\b(dress|dresses|jumpsuit|romper)\b/, "Dress"],
  // Top
  [/\b(shirt|shirts|top|tops|tee|tees|t-shirt|t-shirts|sweater|sweaters|hoodie|hoodies|sweatshirt|sweatshirts|knitwear|knits|blouse|blouses|polo|polos|tank|longsleeve|pullover|jersey|turtleneck|henley|camisole|rugby)\b/, "Top"],
  // Bottom
  [/\b(pant|pants|jean|jeans|trouser|trousers|short|shorts|skirt|skirts|bottom|bottoms|chino|chinos|jogger|joggers|cargo|legging|leggings|culotte|culottes|sweatpant|sweatpants)\b/, "Bottom"],
  // Shoes
  [/\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|sandal|sandals|footwear|mule|mules|heel|heels|flat|flats|slide|slides|oxford|derby|trainer|trainers)\b/, "Shoes"],
  // Bag
  [/\b(bag|bags|tote|totes|backpack|backpacks|clutch|purse|purses|wallet|wallets|messenger|pouch|pouches|satchel)\b/, "Bag"],
  // Accessories
  [/\b(hat|hats|cap|caps|scarf|scarves|belt|belts|sunglass|sunglasses|watch|watches|necklace|bracelet|ring|earring|earrings|tie|ties|glove|gloves|sock|socks|accessories|accessory|jewelry|jewellery|beanie|balaclava)\b/, "Accessories"],
]

// ─── Subcategory keyword maps ─────────────────────────────────────

type SubcategoryMap = [RegExp, string][]

const SUBCATEGORY_BY_CATEGORY: Record<Category, SubcategoryMap> = {
  Outer: [
    [/\bovercoat\b|\bwool\s+coat\b|\btopcoat\b|\btop\s+coat\b/, "overcoat"],
    [/\btrench\b/, "trench-coat"],
    [/\bparka\b/, "parka"],
    [/\banorak\b/, "anorak"],
    [/\bbomber\b|ma-?1\b/, "bomber"],
    [/\bblazer\b/, "blazer"],
    [/\bcardigan\b/, "cardigan"],
    [/\bvest\b|\bgilet\b/, "vest"],
    [/\bleather\s+(jacket|coat)\b/, "leather-jacket"],
    [/\bdenim\s+jacket\b|\bjean\s+jacket\b|\btrucker\b/, "denim-jacket"],
    [/\bwindbreaker\b|\bwind\s+jacket\b|\bshell\s+jacket\b/, "windbreaker"],
    [/\bcape\b/, "cape"],
    [/\bponcho\b/, "poncho"],
    [/\bshearling\b|\bsheepskin\b/, "shearling"],
    [/\bdown\s+(jacket|coat|puffer)\b|\bpuffer\b|\bpadded\s+jacket\b|\bquilted\s+jacket\b/, "down-jacket"],
    [/\bfield\s+jacket\b|\bm-?65\b|\bm51\b/, "field-jacket"],
    [/\bchore\b|\bwork\s+(jacket|coat)\b/, "chore-jacket"],
    [/\bovershirt\b|\bshirt\s+jacket\b|\bflannel\s+jacket\b/, "overshirt"],
    [/\bhoodie\b/, "hoodie"],
    [/\bfleece\b|\bpolar\b|\bsherpa\b/, "fleece"],
  ],
  Top: [
    [/\bturtleneck\b|\bmock[\s-]neck\b|\broll[\s-]neck\b/, "turtleneck"],
    [/\bhoodie\b|\bzip[\s-]up\b/, "hoodie"],
    [/\bsweatshirt\b/, "sweatshirt"],
    [/\brugby\b/, "rugby-shirt"],
    [/\bcamisole\b|\bslip\s+top\b/, "camisole"],
    [/\bcrop[\s-]top\b|\bcropped\s+top\b/, "crop-top"],
    [/\btank[\s-]top\b|\btank\b|\bsleeveless\b/, "tank-top"],
    [/\bhenley\b/, "henley"],
    [/\bpolo\b/, "polo"],
    [/\bblouse\b/, "blouse"],
    [/\bknit[\s-]top\b|\bknit\b/, "knit-top"],
    [/\bsweater\b|\bpullover\b|\bcrewneck\b|\bcrew[\s-]neck\b/, "sweater"],
    [/\bt[\s-]shirt\b|\btee\b/, "t-shirt"],
    [/\bshirt\b/, "shirt"],
  ],
  Bottom: [
    [/\bskirt\b/, "skirt"],
    [/\blegging\b/, "leggings"],
    [/\bculotte\b|\bwide[\s-]leg\s+crop\b/, "culottes"],
    [/\bsweatpant\b|\bfleece\s+pant\b/, "sweatpants"],
    [/\bjogger\b|\btrack\s+pant\b/, "joggers"],
    [/\bcargo\b/, "cargo-pants"],
    [/\bwide[\s-](pant|leg|trousers)\b|\bpalazzo\b/, "wide-pants"],
    [/\bshort\b/, "shorts"],
    [/\bchino\b|\bkhaki\s+pant\b/, "chinos"],
    [/\bjean\b|\bdenim\s+pant\b/, "jeans"],
    [/\btrouser\b|\bdress\s+pant\b|\bformal\s+pant\b/, "trousers"],
  ],
  Shoes: [
    [/\bchelsea\b/, "chelsea-boots"],
    [/\bcombat\b|\blug[\s-]sole\b|\bwork\s+boot\b/, "combat-boots"],
    [/\brunning\b|\btrail\b|\brunner\b/, "running-shoes"],
    [/\bsandal\b/, "sandals"],
    [/\bslide\b/, "slides"],
    [/\bmule\b|\bclog\b/, "mules"],
    [/\bpump\b|\bheel\b/, "heels"],
    [/\bballet\s+flat\b|\bflat\s+shoe\b|\bflat\b/, "flats"],
    [/\bloafer\b|\bpenny\b|\bhorsebit\b/, "loafers"],
    [/\bderby\b|\bbrogue\b/, "derby"],
    [/\boxford\s+shoe\b/, "oxford"],
    [/\bboot\b/, "boots"],
    [/\bsneaker\b|\btrainer\b/, "sneakers"],
  ],
  Bag: [
    [/\bbackpack\b|\brucksack\b/, "backpack"],
    [/\bbelt[\s-]bag\b|\bfanny\b|\bbum\s+bag\b|\bwaist\s+bag\b/, "belt-bag"],
    [/\bmessenger\b|\bsatchel\b/, "messenger"],
    [/\bbucket\b/, "bucket-bag"],
    [/\bbriefcase\b|\bdocument\s+bag\b|\blaptop\s+bag\b/, "briefcase"],
    [/\bclutch\b|\bpouch\b/, "clutch"],
    [/\bcrossbody\b|\bcross[\s-]body\b|\bshoulder\s+strap\b/, "crossbody"],
    [/\bshoulder[\s-]bag\b/, "shoulder-bag"],
    [/\btote\b/, "tote"],
  ],
  Dress: [
    [/\bshirt[\s-]dress\b/, "shirt-dress"],
    [/\bwrap[\s-]dress\b/, "wrap-dress"],
    [/\bslip[\s-]dress\b/, "slip-dress"],
    [/\bknit[\s-]dress\b/, "knit-dress"],
    [/\bmini[\s-]dress\b|\bmini\b/, "mini-dress"],
    [/\bmidi[\s-]dress\b|\bmidi\b/, "midi-dress"],
    [/\bmaxi[\s-]dress\b|\bmaxi\b/, "maxi-dress"],
  ],
  Accessories: [
    [/\bsunglass\b|\beyewear\b|\bglasses\b/, "sunglasses"],
    [/\bwatch\b/, "watch"],
    [/\bbeanie\b|\bbalaclava\b|\bbucket\s+hat\b|\bhat\b/, "hat"],
    [/\bcap\b|\bbaseball\s+cap\b|\bsnapback\b|\bdad\s+hat\b/, "cap"],
    [/\bscarf\b|\bmuffler\b/, "scarf"],
    [/\bbelt\b/, "belt"],
    [/\bnecklace\b|\bchain\b|\bpendant\b/, "necklace"],
    [/\bbracelet\b|\bbangle\b|\bcuff\b/, "bracelet"],
    [/\bearing\b/, "earrings"],
    [/\bring\b/, "ring"],
    [/\btie\b|\bnecktie\b|\bbow\s+tie\b/, "tie"],
    [/\bglove\b|\bmitten\b/, "gloves"],
    [/\bsock\b|\bhosiery\b/, "socks"],
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────

function matchCategory(text: string): Category | undefined {
  for (const [re, cat] of TYPE_TO_CATEGORY) {
    if (re.test(text)) return cat
  }
  return undefined
}

function matchSubcategory(category: Category, text: string): string | undefined {
  for (const [re, sub] of SUBCATEGORY_BY_CATEGORY[category]) {
    if (re.test(text)) return sub
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
