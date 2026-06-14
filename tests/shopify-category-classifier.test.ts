/**
 * Unit tests for the Shopify category classifier.
 *
 * Covers:
 *   - product_type → category normalisation (specific types, noise values)
 *   - tag-based fallback when product_type is noisy/empty
 *   - title-based last-resort fallback
 *   - subcategory inference per category
 *   - unrecognised product → empty category (preserves blank behaviour)
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {classifyShopifyCategory} from "../src/lib/shopify-category-classifier"

// ─── product_type → category ─────────────────────────────────────────────────

test("classify_shopify_specific_type_coats_to_outer", () => {
  const {category, subcategory} = classifyShopifyCategory("Coats", "Wool Coat", [])
  assert.equal(category, "Outer")
  assert.equal(subcategory, "overcoat")
})

test("classify_shopify_specific_type_jackets_to_outer", () => {
  const {category} = classifyShopifyCategory("Jackets", "Field Jacket", [])
  assert.equal(category, "Outer")
})

test("classify_shopify_specific_type_shirts_to_top", () => {
  const {category, subcategory} = classifyShopifyCategory("Shirts", "Oxford Cotton Shirt", [])
  assert.equal(category, "Top")
  assert.equal(subcategory, "shirt")
})

test("classify_shopify_specific_type_pants_to_bottom", () => {
  const {category} = classifyShopifyCategory("Pants", "Chino Trouser", [])
  assert.equal(category, "Bottom")
})

test("classify_shopify_specific_type_footwear_to_shoes", () => {
  const {category, subcategory} = classifyShopifyCategory("Footwear", "Trail Running Shoe", [])
  assert.equal(category, "Shoes")
  assert.equal(subcategory, "running-shoes")
})

test("classify_shopify_specific_type_bags_to_bag", () => {
  const {category} = classifyShopifyCategory("Bags", "Canvas Tote", [])
  assert.equal(category, "Bag")
})

test("classify_shopify_specific_type_dress_to_dress", () => {
  const {category} = classifyShopifyCategory("Dresses", "Slip Dress", [])
  assert.equal(category, "Dress")
})

test("classify_shopify_specific_type_accessories_to_accessories", () => {
  const {category} = classifyShopifyCategory("Accessories", "Canvas Belt", [])
  assert.equal(category, "Accessories")
})

// ─── Noise product_type → tag fallback ───────────────────────────────────────

test("classify_shopify_noise_type_clothing_uses_tags", () => {
  const {category} = classifyShopifyCategory("Clothing", "Classic Tee", ["tops", "cotton"])
  assert.equal(category, "Top")
})

test("classify_shopify_noise_type_apparel_uses_tags", () => {
  const {category} = classifyShopifyCategory("Apparel", "Trail Runner", ["footwear", "running"])
  assert.equal(category, "Shoes")
})

test("classify_shopify_empty_type_uses_tags", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Plain Basic Tee", ["tshirt"])
  assert.equal(category, "Top")
  assert.equal(subcategory, "t-shirt")
})

// ─── Tag + title fallback ─────────────────────────────────────────────────────

test("classify_shopify_no_type_no_tags_uses_title", () => {
  const {category} = classifyShopifyCategory("", "Oversized Parka", [])
  assert.equal(category, "Outer")
})

test("classify_shopify_title_hoodie_is_outer", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Heavy Fleece Hoodie", [])
  assert.equal(category, "Outer")
  assert.equal(subcategory, "hoodie")
})

test("classify_shopify_title_turtleneck_is_top", () => {
  const {category, subcategory} = classifyShopifyCategory("", "Cashmere Turtleneck", [])
  assert.equal(category, "Top")
  assert.equal(subcategory, "turtleneck")
})

// ─── Subcategory resolution ───────────────────────────────────────────────────

test("classify_shopify_subcategory_trench_coat", () => {
  const {category, subcategory} = classifyShopifyCategory("Coats", "Belted Trench Coat", [])
  assert.equal(category, "Outer")
  assert.equal(subcategory, "trench-coat")
})

test("classify_shopify_subcategory_bomber", () => {
  const {subcategory} = classifyShopifyCategory("Jackets", "Nylon Bomber Jacket", [])
  assert.equal(subcategory, "bomber")
})

test("classify_shopify_subcategory_chelsea_boot", () => {
  const {category, subcategory} = classifyShopifyCategory("Boots", "Leather Chelsea Boot", [])
  assert.equal(category, "Shoes")
  assert.equal(subcategory, "chelsea-boots")
})

test("classify_shopify_subcategory_cargo_pants", () => {
  const {subcategory} = classifyShopifyCategory("Pants", "Six-Pocket Cargo Pant", [])
  assert.equal(subcategory, "cargo-pants")
})

test("classify_shopify_subcategory_tote_bag", () => {
  const {category, subcategory} = classifyShopifyCategory("Bags", "Large Canvas Tote Bag", [])
  assert.equal(category, "Bag")
  assert.equal(subcategory, "tote")
})

test("classify_shopify_subcategory_midi_dress", () => {
  const {subcategory} = classifyShopifyCategory("Dresses", "Floral Midi Dress", [])
  assert.equal(subcategory, "midi-dress")
})

test("classify_shopify_subcategory_beanie_hat", () => {
  const {category, subcategory} = classifyShopifyCategory("Accessories", "Merino Beanie", [])
  assert.equal(category, "Accessories")
  assert.equal(subcategory, "hat")
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
