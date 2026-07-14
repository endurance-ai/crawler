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

test("classify_shopify_cardigan_type_to_knitwear", () => {
  const {category, subcategory} = classifyShopifyCategory("Cardigans", "Wool Cardigan", [])
  assert.equal(category, "knitwear")
  assert.equal(subcategory, "cardigan")
})

test("classify_shopify_specific_type_pants_to_bottoms", () => {
  const {category} = classifyShopifyCategory("Pants", "Chino Trouser", [])
  assert.equal(category, "bottoms")
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
