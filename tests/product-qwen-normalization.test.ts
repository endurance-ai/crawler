import assert from "node:assert/strict"
import test from "node:test"

import {
  buildQwenNormalizationPatch,
  needsQwenNormalization,
  qwenNormalizationInputHash,
  type ProductNormalizationInput,
} from "../src/lib/product-qwen-normalization"

function product(overrides: Partial<ProductNormalizationInput> = {}): ProductNormalizationInput {
  return {
    productUrl: "https://example.com/p/1",
    name: "Logo Hoodie",
    brand: "Brand",
    category: "other",
    subcategory: null,
    tags: ["hoodie"],
    ...overrides,
  }
}

test("targets only other or canonical rows missing a subcategory", () => {
  assert.equal(needsQwenNormalization(product()), true)
  assert.equal(needsQwenNormalization(product({category: "tops"})), true)
  assert.equal(needsQwenNormalization(product({category: "tops", subcategory: "hoodie"})), false)
  assert.equal(needsQwenNormalization(product({category: "legacy sale"})), false)
})

test("allows Qwen to replace other with a validated category pair", () => {
  assert.deepEqual(
    buildQwenNormalizationPatch(product(), {category: "tops", subcategory: "hoodie"}),
    {category: "tops", subcategory: "hoodie"},
  )
  assert.deepEqual(
    buildQwenNormalizationPatch(product(), {category: "tops", subcategory: "boots"}),
    {category: "tops", subcategory: null},
  )
})

test("does not count other/null to other/null as a successful enrichment", () => {
  assert.equal(
    buildQwenNormalizationPatch(product(), {category: "other", subcategory: null}),
    null,
  )
})

test("protects an existing canonical category", () => {
  const existing = product({category: "tops"})
  assert.equal(
    buildQwenNormalizationPatch(existing, {category: "bottoms", subcategory: "jeans"}),
    null,
  )
  assert.deepEqual(
    buildQwenNormalizationPatch(existing, {category: "tops", subcategory: "hoodie"}),
    {category: "tops", subcategory: "hoodie"},
  )
  assert.equal(
    buildQwenNormalizationPatch(existing, {category: "tops", subcategory: null}),
    null,
  )
})

test("produces a stable hash and changes it when classification input changes", () => {
  assert.equal(qwenNormalizationInputHash(product()), qwenNormalizationInputHash(product()))
  assert.notEqual(
    qwenNormalizationInputHash(product()),
    qwenNormalizationInputHash(product({name: "Zip Hoodie"})),
  )
})
