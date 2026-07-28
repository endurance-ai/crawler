import {test} from "node:test"
import * as assert from "node:assert/strict"

import type {Product} from "../src/lib/types"
import {
  applyProductQcGate,
  normalizeProductTextFields,
  resetProductQcReport,
} from "../src/lib/product-qc/normalization"

function product(overrides: Partial<Product> = {}): Product {
  return {
    brand: "Brand",
    name: "Black Wide Pants",
    category: "bottoms",
    price: 1000,
    originalPrice: 1000,
    salePrice: null,
    priceFormatted: "KRW 1,000",
    imageUrl: "https://example.com/image.jpg",
    productUrl: "https://example.com/product/1",
    inStock: true,
    gender: ["unisex"],
    platform: "test-shop",
    crawledAt: "2026-07-07T00:00:00.000Z",
    color: "Black",
    subcategory: "wide-pants",
    ...overrides,
  }
}

test("QC canonicalizes multilingual black variants", () => {
  const result = normalizeProductTextFields(product({color: "Noir"}))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.color, "Black")
  assert.deepEqual(result.changes.map((c) => c.field), ["color"])
})

test("QC fixes size captured as color when product text has a clear color", () => {
  const result = normalizeProductTextFields(product({name: "Negro Wide Pants", color: "M"}))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.color, "Black")
  assert.ok(result.reasons.includes("color_noise_text_fallback"))
})

test("QC sends unresolved size-color noise to review and drops it from the gate", () => {
  resetProductQcReport()
  const input = product({
    name: "Wide Pants",
    color: "ONE SIZE",
    productUrl: "https://example.com/product/review",
  })
  const out = applyProductQcGate([input], "test-shop")
  assert.equal(out.length, 0)
})

test("QC keeps unknown real color names instead of over-normalizing", () => {
  const result = normalizeProductTextFields(product({color: "light taupe"}))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.color, "Beige")
})

test("QC holds Korean placeholder color for review (제품명 참조 not loaded)", () => {
  const result = normalizeProductTextFields(product({name: "Archive Bag", color: "제품명 참조"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("color_non_color_unresolved"))
})

test("QC does not mistake a karat/purity number for price noise (14k Gold -> Gold)", () => {
  const result = normalizeProductTextFields(product({name: "Cable Chain Necklace", category: "jewelry", color: "14k Gold"}))
  assert.equal(result.product.color, "Gold")
  assert.ok(result.reasons.includes("color_canonicalized"))
})

test("QC does not mistake a purity number for price noise (925 Sterling Silver -> Silver)", () => {
  const result = normalizeProductTextFields(product({name: "Cage Ring", category: "jewelry", color: "925 Sterling Silver"}))
  assert.equal(result.product.color, "Silver")
  assert.ok(result.reasons.includes("color_canonicalized"))
})

test("QC still treats an actual price adjustment as color noise", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", color: "+5000원"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("color_non_color_unresolved"))
})

test("QC does not mistake a hyphenated product code for a negative price (OG-107 GREEN -> Green)", () => {
  const result = normalizeProductTextFields(product({name: "Flight Jacket", color: "OG-107 GREEN"}))
  assert.equal(result.product.color, "Green")
  assert.ok(result.reasons.includes("color_canonicalized"))
})

test("QC recognizes bare 사이즈 (Korean 'size') as noise, not a real color", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", color: "사이즈"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("color_non_color_unresolved"))
})

test("QC recognizes size-selector widget noise (사이즈 M L Empty M) instead of duplicating it as a color", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", color: "사이즈 M L Empty M"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("color_non_color_unresolved"))
})

test("QC recognizes a quantity-stepper widget label as noise, not a real color", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", color: "Quantity Up Down"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("color_non_color_unresolved"))
})

test("QC canonicalizes Korean 인디고 to Indigo", () => {
  const result = normalizeProductTextFields(product({color: "인디고"}))
  assert.equal(result.product.color, "Indigo")
  assert.ok(result.reasons.includes("color_canonicalized"))
})

test("QC canonicalizes English indigo to Indigo", () => {
  const result = normalizeProductTextFields(product({color: "Indigo Blue"}))
  assert.equal(result.product.color, "Indigo")
})

test("QC does not duplicate a SKU-style color when a size suffix strips down to an already-listed part", () => {
  const result = normalizeProductTextFields(product({name: "Earrings", color: "Fjs82itym07834, Fjs82itym07834 109"}))
  assert.equal(result.product.color, "Fjs82itym07834, Fjs82itym07834 109")
})

test("QC canonicalizes gender aliases", () => {
  const result = normalizeProductTextFields(product({gender: ["male"]}))
  assert.equal(result.action, "auto_fix")
  assert.deepEqual(result.product.gender, ["men"])
})

test("QC infers missing gender from text", () => {
  const result = normalizeProductTextFields(product({name: "Women's Navy Coat", category: "Outer", gender: []}))
  assert.equal(result.action, "auto_fix")
  assert.deepEqual(result.product.gender, ["women"])
})

test("QC reviews category conflicts instead of overwriting them", () => {
  const result = normalizeProductTextFields(product({name: "Silk Mini Dress", category: "accessories"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("category_text_conflict"))
})

test("QC folds non-canonical mappable category to canonical family (sweater -> knitwear)", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", category: "sweater"}))
  assert.equal(result.product.category, "knitwear")
  assert.ok(result.reasons.includes("category_canonicalized"))
})

test("QC passes a canonical family through unchanged (knitwear stays knitwear)", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", category: "knitwear"}))
  assert.equal(result.product.category, "knitwear")
  assert.ok(!result.reasons.includes("category_canonicalized"))
})

test("QC holds non-canonical noise category for review (not loaded) when name gives no signal", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", category: "~50%"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("category_noncanonical_dropped"))
})

test("QC recovers canonical from name when category is noise (모두 보기 -> dresses)", () => {
  const result = normalizeProductTextFields(product({name: "Silk Mini Dress", category: "모두 보기"}))
  assert.equal(result.product.category, "dresses")
  assert.ok(result.reasons.includes("category_noise_text_fallback"))
})

// ─── subcategory ───────────────────────────────────────────────────────────

test("QC collapses mini/midi/plural skirt variants to canonical 'skirt'", () => {
  for (const raw of ["midi skirt", "midi skirts", "mini check skirt", "mini skirt", "mini skirts", "miniskirts"]) {
    const result = normalizeProductTextFields(product({subcategory: raw}))
    assert.equal(result.product.subcategory, "skirt", `input: ${raw}`)
    assert.ok(result.reasons.includes("subcategory_canonicalized"), `input: ${raw}`)
  }
})

test("QC leaves an already-canonical subcategory untouched", () => {
  const result = normalizeProductTextFields(product({subcategory: "skirt"}))
  assert.equal(result.product.subcategory, "skirt")
  assert.ok(!result.reasons.includes("subcategory_canonicalized"))
})

test("QC drops a subcategory with no keyword match instead of leaking raw noise", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", subcategory: "New Arrival"}))
  assert.equal(result.product.subcategory, null)
  assert.ok(result.reasons.includes("subcategory_noncanonical_dropped"))
  assert.equal(result.action, "auto_fix")
})

test("QC infers subcategory from the product name when the field is missing", () => {
  const result = normalizeProductTextFields(product({name: "Pleated Midi Skirt", subcategory: undefined}))
  assert.equal(result.product.subcategory, "skirt")
  assert.ok(result.reasons.includes("subcategory_missing_text_fallback"))
})

test("QC nulls subcategory when category itself was dropped as non-canonical", () => {
  const result = normalizeProductTextFields(
    product({name: "Archive Piece 001", category: "~50%", subcategory: "skirt"}),
  )
  assert.equal(result.action, "review")
  assert.equal(result.product.subcategory, null)
  assert.ok(result.reasons.includes("subcategory_no_category"))
})

test("QC resolves subcategory against the canonicalized category, not the raw alias", () => {
  const result = normalizeProductTextFields(product({category: "sweater", name: "Wool Turtleneck", subcategory: null}))
  assert.equal(result.product.category, "knitwear")
  assert.equal(result.product.subcategory, "turtleneck")
})

