import assert from "node:assert/strict"
import test from "node:test"

import {prepareImportInputProducts} from "../src/import-products"
import type {Product, SiteConfig} from "../src/lib/types"

const config = {key: "shop", name: "Shop", type: "shopify", baseUrl: "https://example.com"} satisfies SiteConfig

function product(overrides: Partial<Product> = {}): Product {
  return {brand: "House", name: "Shirt", category: "tops", subcategory: "shirt", gender: ["women"],
    price: 1000, originalPrice: 1000, salePrice: null, pricingObservation: {state: "regular", source: "listing", version: 2},
    priceFormatted: "₩1,000", imageUrl: "https://example.com/a.jpg", productUrl: "https://example.com/p/1",
    inStock: true, platform: "shop", crawledAt: "2026-09-12T00:00:00Z", ...overrides}
}

test("input boundary rejects malformed rows before orchestration", () => {
  assert.throws(() => prepareImportInputProducts([null], "shop", config), /must be an object/)
  assert.throws(() => prepareImportInputProducts([{name: "missing fields"}], "shop", config), /validation failed/)
})

test("canonical duplicate identity keeps the newest coherent observation", () => {
  const older = product({name: "Old", inStock: true, crawledAt: "2026-09-11T00:00:00Z"})
  const newer = product({name: "New", inStock: false, crawledAt: "2026-09-12T00:00:00Z"})
  const result = prepareImportInputProducts([older, newer], "shop", config)
  assert.equal(result.length, 1)
  assert.equal(result[0].name, "New")
  assert.equal(result[0].inStock, false)
})
