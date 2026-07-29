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
    platform: "test-shop",
    crawledAt: "2026-07-07T00:00:00.000Z",
    subcategory: "wide-pants",
    ...overrides,
  }
}

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

