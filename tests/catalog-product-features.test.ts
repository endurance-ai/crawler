import assert from "node:assert/strict"
import test from "node:test"

import {
  featureRetrievalText,
  productFeaturePrompt,
  productFeatureSchema,
} from "../src/lib/catalog/product-features"

test("product feature schema accepts only canonical color families", () => {
  assert.equal(productFeatureSchema.parse({primary_color: "NAVY"}).primary_color, "NAVY")
  assert.throws(() => productFeatureSchema.parse({primary_color: "dark navy"}))
})

test("product feature schema bounds repeated metadata", () => {
  assert.throws(() => productFeatureSchema.parse({
    primary_color: "BLACK",
    secondary_colors: ["WHITE", "GREY", "BLUE", "BROWN", "CREAM"],
  }))
})

test("retrieval text and prompt retain product context and visual output", () => {
  const row = {brand: "EASTLOGUE", name: "Field Jacket", category: "outerwear", subcategory: "jacket"}
  const feature = productFeatureSchema.parse({
    primary_color: "KHAKI",
    material: "cotton",
    style_tags: ["military"],
  })
  assert.match(productFeaturePrompt(row), /Field Jacket/)
  assert.equal(
    featureRetrievalText(row, feature),
    "EASTLOGUE Field Jacket outerwear jacket KHAKI cotton military",
  )
})
