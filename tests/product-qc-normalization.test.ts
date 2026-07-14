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

