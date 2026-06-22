/**
 * Reproduction tests for the category-extraction failure path.
 *
 * Bug: validateAndNormalize used to force `category: "Accessories"` whenever the
 * VLM returned an invalid/empty category, silently mislabelling products and
 * polluting the analysis table. The fix returns null instead, so the batch
 * runner treats it as a failure (retry, then skip — no DB write).
 *
 * Runs via: npm test (node --test --import tsx ./tests/*.test.ts)
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {validateAndNormalize} from "../src/lib/product-analyzer"

test("invalid category returns null instead of forcing Accessories", () => {
  assert.equal(validateAndNormalize({category: "Jacket"}), null)
  assert.equal(validateAndNormalize({category: "상의"}), null)
  assert.equal(validateAndNormalize({}), null)
  assert.equal(validateAndNormalize({category: ""}), null)
})

test("a real Accessories category is still accepted (not a false-positive reject)", () => {
  const r = validateAndNormalize({category: "Accessories", subcategory: "hat"})
  assert.notEqual(r, null)
  assert.equal(r?.category, "Accessories")
  assert.equal(r?.subcategory, "hat")
})

test("valid category passes through and subcategory is validated against it", () => {
  // sneakers belongs to Shoes, not Top → must be dropped to null
  const wrong = validateAndNormalize({category: "Top", subcategory: "sneakers"})
  assert.equal(wrong?.category, "Top")
  assert.equal(wrong?.subcategory, null)

  // t-shirt belongs to Top → kept
  const right = validateAndNormalize({category: "Top", subcategory: "t-shirt"})
  assert.equal(right?.subcategory, "t-shirt")
})
