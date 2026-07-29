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

