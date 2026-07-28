import test from "node:test"
import assert from "node:assert/strict"

import {classifySubcategoryRepair, type ProductSubcategoryRow} from "../src/lib/subcategory-repair"

function row(overrides: Partial<ProductSubcategoryRow> = {}): ProductSubcategoryRow {
  return {
    id: 1,
    category: "bottoms",
    subcategory: null,
    name: "Black Wide Pants",
    product_url: "https://shop.example.com/product/detail.html?product_no=1",
    platform: "exampleshop",
    brand: "EXAMPLE",
    brand_node_id: 10,
    ...overrides,
  }
}

test("mini/midi/plural skirt spellings collapse to canonical 'skirt'", () => {
  for (const before of ["midi skirt", "midi skirts", "mini check skirt", "mini skirt", "mini skirts", "miniskirts"]) {
    const d = classifySubcategoryRepair(row({subcategory: before}))
    assert.equal(d.after, "skirt", `input: ${before}`)
    assert.equal(d.bucket, "canonicalized", `input: ${before}`)
    assert.equal(d.before, before)
  }
})

test("already-canonical subcategory is left unchanged", () => {
  const d = classifySubcategoryRepair(row({subcategory: "skirt"}))
  assert.equal(d.bucket, "unchanged")
  assert.equal(d.after, null)
})

test("noise with no keyword signal anywhere drops to null", () => {
  const d = classifySubcategoryRepair(row({name: "Archive Piece 001", subcategory: "New Arrival"}))
  assert.equal(d.bucket, "dropped_noncanonical")
  assert.equal(d.after, null)
})

test("legacy row with an invalid category has no basis for a subcategory", () => {
  const d = classifySubcategoryRepair(row({category: "~50%", subcategory: "skirt"}))
  assert.equal(d.bucket, "dropped_no_category")
  assert.equal(d.after, null)
})

test("missing subcategory is inferred from the product name", () => {
  const d = classifySubcategoryRepair(row({name: "Pleated Midi Skirt", subcategory: null}))
  assert.equal(d.bucket, "text_fallback")
  assert.equal(d.after, "skirt")
})

test("blank/whitespace subcategory with no name signal stays unchanged", () => {
  const d = classifySubcategoryRepair(row({name: "Archive Piece 001", subcategory: "   "}))
  assert.equal(d.bucket, "unchanged")
  assert.equal(d.before, null)
})
