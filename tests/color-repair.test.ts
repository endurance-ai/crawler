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

test("mustard is now a recognized canonical color (2026-07-28 color-vocab sync)", () => {
  // Was "recased, not dropped" before the fix — this is the exact bug the
  // sync closed: COLOR_RULES here didn't recognize "mustard" even though
  // color-normalizer.ts (the parser-layer vocabulary) already did, so it
  // fell through to the title-case passthrough instead of canonicalizing.
  const d = classifyColorRepair(row({color: "mustard"}))
  assert.equal(d.bucket, "canonicalized")
  assert.equal(d.after, "Mustard")
})

test("a real but still-unrecognized color name gets recased, not dropped", () => {
  // "Denim" is deliberately NOT in COLOR_RULES — it's a fabric name spanning
  // many actual colors, too risky as a name-text-fallback trigger (see the
  // comment above the Camo/Leopard entries in normalization.ts). Kept as a
  // live example of the "recased" bucket now that mustard graduated out of it.
  const d = classifyColorRepair(row({color: "denim"}))
  assert.equal(d.bucket, "recased")
  assert.equal(d.after, "Denim")
})

test("unresolvable noise with no color signal anywhere is kept, never nulled", () => {
  const d = classifyColorRepair(row({color: "제품명 참조", name: "Archive Bag"}))
  assert.equal(d.bucket, "unresolved_kept")
  assert.equal(d.after, null)
})
