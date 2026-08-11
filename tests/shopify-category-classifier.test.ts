/**
 * Unit tests for the Shopify category classifier.
 *
 * Covers:
 *   - product_type → category normalisation (specific types, noise values)
 *   - tag-based fallback when product_type is noisy/empty
 *   - title-based last-resort fallback
 *   - subcategory inference per family
 *   - split families (knitwear / eyewear / jewelry / headwear)
 *   - unrecognised product → empty category (preserves blank behaviour)
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {classifyShopifyCategory} from "../src/lib/shopify-category-classifier"

// ─── product_type → category ─────────────────────────────────────────────────

test("classify_shopify_specific_type_coats_to_outerwear", () => {
  const {category, subcategory} = classifyShopifyCategory("Coats", "Wool Coat", [])
  assert.equal(category, "outerwear")
  assert.equal(subcategory, "overcoat")
})

test("classify_shopify_specific_type_jackets_to_outerwear", () => {
  const {category} = classifyShopifyCategory("Jackets", "Nylon Jacket", [])
  assert.equal(category, "outerwear")
})

test("classify_shopify_specific_type_shirts_to_tops", () => {
  const {category, subcategory} = classifyShopifyCategory("Shirts", "Oxford Cotton Shirt", [])
  assert.equal(category, "tops")
  assert.equal(subcategory, "shirt")
})

test("classify_shopify_sweater_type_to_knitwear", () => {
  const {category, subcategory} = classifyShopifyCategory("Sweaters", "Cashmere Sweater", [])
  assert.equal(category, "knitwear")
  assert.equal(subcategory, "sweater")
})

test("구체적인 hoodie 상품명은 generic Sweater 타입보다 우선한다", () => {
  const {category, subcategory} = classifyShopifyCategory("Sweater", "SOFTS ZIP-HOODIE NAVY", [])
  assert.equal(category, "tops")
  assert.equal(subcategory, "hoodie")
})

test("activewear 부서 태그는 generic Sweater 타입보다 우선한다", () => {
  const {category} = classifyShopifyCategory(
    "Sweater",
    "ACTIVEWEAR COMPRESSION LONGSLEEVE BLACK",
    ["activewear", "T-Shirt"],
  )
  assert.equal(category, "activewear")
})

test("구체적인 Footwear 타입은 상품명의 소재 Denim보다 우선한다", () => {
  const {category} = classifyShopifyCategory(
    "FOOTWEAR",
    'AKIMBO LOWS "FORGOTTEN DENIM"',
    ["footwear"],
  )
  assert.equal(category, "shoes")
})

test("classify_shopify_cardigan_type_to_knitwear", () => {
  const {category, subcategory} = classifyShopifyCategory("Cardigans", "Wool Cardigan", [])
  assert.equal(category, "knitwear")
  assert.equal(subcategory, "cardigan")
})

test("classify_shopify_specific_type_pants_to_bottoms", () => {
  const {category} = classifyShopifyCategory("Pants", "Chino Trouser", [])
  assert.equal(category, "bottoms")
})

test("classify_shopify_bikini_bottoms_as_swimwear_before_generic_bottoms", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Printed Bikini Bottoms", [])
  assert.equal(category, "swimwear")
  assert.equal(subcategory, "bikini")
})

test("classify_shopify_specific_type_footwear_to_shoes", () => {
  const {category, subcategory} = classifyShopifyCategory("Footwear", "Trail Running Shoe", [])
  assert.equal(category, "shoes")
  assert.equal(subcategory, "running-shoes")
})

test("classify_shopify_specific_type_bags_to_bags", () => {
  const {category} = classifyShopifyCategory("Bags", "Canvas Tote", [])
  assert.equal(category, "bags")
})

test("classify_shopify_specific_type_dress_to_dresses", () => {
  const {category} = classifyShopifyCategory("Dresses", "Slip Dress", [])
  assert.equal(category, "dresses")
})

test("classify_shopify_specific_type_accessories_to_accessories", () => {
  const {category, subcategory} = classifyShopifyCategory("Accessories", "Canvas Belt", [])
  assert.equal(category, "accessories")
  assert.equal(subcategory, "belt")
})

test("REFOMED bare trunks are shorts, while explicit swim trunks stay swimwear", () => {
  assert.equal(classifyShopifyCategory("", 'REPT-064 | "KINCHAKU" WOOL TRUNKS', []).category, "bottoms")
  assert.equal(classifyShopifyCategory("", "Classic Swim Trunks", []).category, "swimwear")
})

test("REFOMED ambiguous names recover their official product families", () => {
  assert.equal(classifyShopifyCategory("", "RECU-YN01 | WOOL BASE", []).category, "tops")
  assert.equal(classifyShopifyCategory("", 'REPF-003 | FRAGRANCE "NEXT MAN"', []).category, "accessories")
})

test("classify_cafe24_wallet_does_not_treat_zipper_as_a_top", () => {
  const {category} = classifyShopifyCategory("Cat66", "HEART ZIPPER WALLET_silver logo", [])
  assert.equal(category, "accessories")
})

test("classify_cafe24_underscore_colour_keeps_cardigan_as_knitwear", () => {
  const {category, subcategory} = classifyShopifyCategory("Cat66", "RIBBED COLLAR CARDIGAN_black", [])
  assert.equal(category, "knitwear")
  assert.equal(subcategory, "cardigan")
})

test("classify_shearling_wallet_by_product_noun_not_material", () => {
  const {category} = classifyShopifyCategory("Cat66", "SHEARLING ZIPPER WALLET_beige shearling", [])
  assert.equal(category, "accessories")
})

test("classify_knit_vest_as_knitwear_before_generic_vest", () => {
  const {category} = classifyShopifyCategory("Cat66", "TAIL STRIPE KNIT VEST_grey", [])
  assert.equal(category, "knitwear")
})

// ─── Split families (Accessories → eyewear / jewelry / headwear) ─────────────

test("classify_shopify_sunglasses_to_eyewear", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Acetate Sunglasses", [])
  assert.equal(category, "eyewear")
  assert.equal(subcategory, "sunglasses")
})

test("classify_shopify_necklace_to_jewelry", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Silver Chain Necklace", [])
  assert.equal(category, "jewelry")
  assert.equal(subcategory, "necklace")
})

test("classify_shopify_title_beanie_to_headwear", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Merino Wool Beanie", [])
  assert.equal(category, "headwear")
  assert.equal(subcategory, "beanie")
})

// ─── Noise product_type → tag fallback ───────────────────────────────────────

test("classify_shopify_noise_type_clothing_uses_tags", () => {
  const {category} = classifyShopifyCategory("Clothing", "Classic Tee", ["tops", "cotton"])
  assert.equal(category, "tops")
})

test("classify_shopify_noise_type_apparel_uses_tags", () => {
  const {category} = classifyShopifyCategory("Apparel", "Trail Runner", ["footwear", "running"])
  assert.equal(category, "shoes")
})

test("classify_shopify_empty_type_uses_tags", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Plain Basic Tee", ["tshirt"])
  assert.equal(category, "tops")
  assert.equal(subcategory, "t-shirt")
})

test("classify_shopify_supports_twojeys_spanish_product_types", () => {
  assert.equal(classifyShopifyCategory("CAMISETA", "Archive", []).category, "tops")
  assert.equal(classifyShopifyCategory("ANILLO", "Archive", []).category, "jewelry")
  assert.equal(classifyShopifyCategory("GORRA", "Archive", []).category, "headwear")
  assert.equal(classifyShopifyCategory("BAÑADOR", "Archive", []).category, "swimwear")
  assert.equal(classifyShopifyCategory("MECHERO", "Archive", []).category, "accessories")
})

test("classify_shopify_supports_common_jewelry_and_headwear_names", () => {
  assert.equal(classifyShopifyCategory("", "Square Stone Signet", []).category, "jewelry")
  assert.equal(classifyShopifyCategory("", "Venetian Chain", []).category, "jewelry")
  assert.equal(classifyShopifyCategory("", "TJ x Cabrio", []).category, "swimwear")
  assert.equal(classifyShopifyCategory("", "TJ x Cabrio Pinky Ring", []).category, "jewelry")
  assert.equal(classifyShopifyCategory("", "Black Icon Chain Beanie", []).category, "headwear")
  assert.equal(classifyShopifyCategory("", "Icon Trucker", []).category, "headwear")
  assert.equal(classifyShopifyCategory("", "Initials 59Fifty", []).category, "headwear")
})

// ─── Tag + title fallback ─────────────────────────────────────────────────────

test("classify_shopify_no_type_no_tags_uses_title", () => {
  const {category} = classifyShopifyCategory("", "Oversized Parka", [])
  assert.equal(category, "outerwear")
})

test("classify_shopify_title_hoodie_is_tops", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Heavy Cotton Hoodie", [])
  assert.equal(category, "tops")
  assert.equal(subcategory, "hoodie")
})

test("classify_shopify_title_turtleneck_is_knitwear", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Cashmere Turtleneck", [])
  assert.equal(category, "knitwear")
  assert.equal(subcategory, "turtleneck")
})

// ─── Subcategory resolution ───────────────────────────────────────────────────

test("classify_shopify_subcategory_trench_coat", () => {
  const {category, subcategory} = classifyShopifyCategory("Coats", "Belted Trench Coat", [])
  assert.equal(category, "outerwear")
  assert.equal(subcategory, "trench-coat")
})

test("classify_shopify_subcategory_bomber", () => {
  const {subcategory} = classifyShopifyCategory("Jackets", "Nylon Bomber Jacket", [])
  assert.equal(subcategory, "bomber")
})

test("classify_shopify_subcategory_boots", () => {
  const {category, subcategory} = classifyShopifyCategory("Boots", "Leather Chelsea Boot", [])
  assert.equal(category, "shoes")
  assert.equal(subcategory, "boots")
})

test("classify_shopify_subcategory_cargo_pants", () => {
  const {subcategory} = classifyShopifyCategory("Pants", "Six-Pocket Cargo Pant", [])
  assert.equal(subcategory, "cargo-pants")
})

test("classify_shopify_subcategory_tote_bag", () => {
  const {category, subcategory} = classifyShopifyCategory("Bags", "Large Canvas Tote Bag", [])
  assert.equal(category, "bags")
  assert.equal(subcategory, "tote")
})

test("classify_shopify_subcategory_midi_dress", () => {
  const {subcategory} = classifyShopifyCategory("Dresses", "Floral Midi Dress", [])
  assert.equal(subcategory, "midi-dress")
})

// ─── Unrecognised → empty ────────────────────────────────────────────────────

test("classify_shopify_unrecognised_returns_empty_category", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Random Unknown Item XYZ", [])
  assert.equal(category, "")
  assert.equal(subcategory, undefined)
})

test("classify_shopify_noise_type_no_other_signal_returns_empty", () => {
  const {category} = classifyShopifyCategory("Clothing", "XYZ 001 Special Edition", [])
  assert.equal(category, "")
})

test("threetimes Shopify tags recover missing taxonomy categories", () => {
  assert.equal(classifyShopifyCategory("", "Bubblegum iphone case", ["acc", "phonecase"]).category, "accessories")
  assert.equal(classifyShopifyCategory("", "Organic milky thong", ["home-under"]).category, "underwear")
  assert.equal(classifyShopifyCategory("", "Baby shower swim bolero", ["swim"]).category, "swimwear")
  assert.equal(classifyShopifyCategory("", "Evelyn bolero", ["outers"]).category, "outerwear")
})
