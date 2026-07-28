import test from "node:test"
import assert from "node:assert/strict"

import {classifyColorRepair, type ProductColorRow} from "../src/lib/color-repair"

function row(overrides: Partial<ProductColorRow> = {}): ProductColorRow {
  return {
    id: 1,
    color: "Black",
    name: "Black Wide Pants",
    description: null,
    subcategory: "wide-pants",
    tags: null,
    product_url: "https://shop.example.com/product/detail.html?product_no=1",
    platform: "exampleshop",
    brand: "EXAMPLE",
    brand_node_id: 10,
    ...overrides,
  }
}

test("multilingual color variants canonicalize", () => {
  const d = classifyColorRepair(row({color: "Noir"}))
  assert.equal(d.bucket, "canonicalized")
  assert.equal(d.after, "Black")
})

test("already-canonical color is left unchanged", () => {
  const d = classifyColorRepair(row({color: "Black"}))
  assert.equal(d.bucket, "unchanged")
  assert.equal(d.after, null)
})

test("size/stock noise with a clear color in the name falls back to text", () => {
  const d = classifyColorRepair(row({color: "ONE SIZE", name: "Negro Wide Pants"}))
  assert.equal(d.bucket, "text_fallback")
  assert.equal(d.after, "Black")
})

test("a real but non-canonical color name gets recased, not dropped", () => {
  const d = classifyColorRepair(row({color: "mustard"}))
  assert.equal(d.bucket, "recased")
  assert.equal(d.after, "Mustard")
})

test("unresolvable noise with no color signal anywhere is kept, never nulled", () => {
  const d = classifyColorRepair(row({color: "제품명 참조", name: "Archive Bag"}))
  assert.equal(d.bucket, "unresolved_kept")
  assert.equal(d.after, null)
})
