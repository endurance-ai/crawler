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

// ─── 2026-08-10 jacket 세분화 ────────────────────────────────────────────────

function outer(overrides: Partial<ProductSubcategoryRow> = {}): ProductSubcategoryRow {
  return row({category: "outerwear", name: "", subcategory: null, ...overrides})
}

test("jacket subtypes resolve from the name", () => {
  const cases: Array<[string, string]> = [
    ["Wool Varsity Jacket", "varsity-jacket"],
    ["Letterman Jacket", "varsity-jacket"],
    ["Cropped Biker Jacket", "biker-jacket"],
    ["Suede Blouson", "suede-jacket"],
    ["Shearling Coat", "shearling-jacket"],
    ["Faux Fur Coat", "fur-jacket"],
    ["Quilted Jacket", "quilted-jacket"],
    ["Nylon Coach Jacket", "coach-jacket"],
    ["Velour Track Jacket", "track-jacket"],
    ["M-65 Field Jacket", "field-jacket"],
    ["Cotton Chore Jacket", "chore-jacket"],
    ["Harrington", "harrington"],
    ["Hooded Anorak", "anorak"],
    ["Flannel Shacket", "shirt-jacket"],
    ["Wool Overshirt", "shirt-jacket"],
  ]
  for (const [name, expected] of cases) {
    assert.equal(classifySubcategoryRepair(outer({name})).after, expected, `input: ${name}`)
  }
})

test("existing outerwear types keep their old classification", () => {
  const cases: Array<[string, string]> = [
    ["Wool Coat", "overcoat"],
    ["Belted Trench Coat", "trench-coat"],
    ["Oversized Parka", "parka"],
    ["Nylon Bomber Jacket", "bomber"],
    ["Single Breasted Blazer", "blazer"],
    ["Down Puffer Jacket", "down-jacket"],
    // 명시적 down 단서가 있으면 quilted 로 새지 않는다 (기존 행과 동일한 판정).
    ["Quilted Down Jacket", "down-jacket"],
    ["Padded Jacket", "down-jacket"],
    ["Leather Jacket", "leather-jacket"],
    ["Denim Trucker Jacket", "denim-jacket"],
    ["Shell Jacket", "windbreaker"],
    ["Polar Fleece", "fleece"],
  ]
  for (const [name, expected] of cases) {
    assert.equal(classifySubcategoryRepair(outer({name})).after, expected, `input: ${name}`)
  }
})

test("a name with no style cue stays generic 'jacket' rather than being guessed", () => {
  const d = classifySubcategoryRepair(outer({name: "Signature Jacket"}))
  assert.equal(d.after, "jacket")
  assert.equal(d.bucket, "text_fallback")
})

test("already-stored jacket subtypes are canonical and left untouched", () => {
  for (const value of ["varsity-jacket", "shirt-jacket", "jacket", "bomber"]) {
    const d = classifySubcategoryRepair(outer({subcategory: value, name: "Signature Piece"}))
    assert.equal(d.bucket, "unchanged", `input: ${value}`)
    assert.equal(d.after, null)
  }
})

// ─── 2026-08-10 generic 값 + 미정규화 표기 ───────────────────────────────────

test("plural/spacing variants canonicalize instead of fragmenting", () => {
  const cases: Array<[ProductSubcategoryRow["category"], string, string]> = [
    ["bottoms", "jogger pants", "joggers"],
    ["outerwear", "blazers", "blazer"],
    ["shoes", "cowboy boots", "boots"],
    ["shoes", "high heel", "heels"],
    ["accessories", "mufflers", "scarf"],
    ["dresses", "mini", "mini-dress"],
    ["tops", "hoodies", "hoodie"],
    ["bags", "messenger bags", "messenger"],
    ["headwear", "caps", "cap"],
    ["tops", "polo shirts", "polo"],
    ["tops", "tank tops", "tank-top"],
    ["tops", "bodysuits", "bodysuit"],
    ["knitwear", "vests", "sweater-vest"],
  ]
  for (const [category, before, expected] of cases) {
    const d = classifySubcategoryRepair(row({category, subcategory: before, name: ""}))
    assert.equal(d.after, expected, `input: ${category}/${before}`)
    assert.equal(d.bucket, "canonicalized", `input: ${category}/${before}`)
  }
})

test("bare 'pants' lands on the generic bottoms value, specific cuts still win", () => {
  // "pants" 는 이제 canonical 이므로 재판정이 값을 건드리지 않는다 (unchanged).
  assert.equal(classifySubcategoryRepair(row({subcategory: "pants", name: ""})).bucket, "unchanged")
  assert.equal(classifySubcategoryRepair(row({subcategory: null, name: "Signature Pants"})).after, "pants")
  for (const [name, expected] of [
    ["Wide Leg Pants", "wide-pants"],
    ["Cargo Pants", "cargo-pants"],
    ["Dress Pants", "trousers"],
    ["Sweat Pants", "sweatpants"],
    ["Denim Pants", "jeans"],
  ] as Array<[string, string]>) {
    assert.equal(classifySubcategoryRepair(row({subcategory: null, name})).after, expected, `input: ${name}`)
  }
})

test("bag/shoe/accessory types the DB already carries stay canonical", () => {
  const cases: Array<[ProductSubcategoryRow["category"], string, string]> = [
    ["bags", "mini bags", "mini-bag"],
    ["bags", "hobo bags", "hobo-bag"],
    ["bags", "camera bags", "camera-bag"],
    ["bags", "handbags", "handbag"],
    ["shoes", "flip flops", "flip-flops"],
    ["accessories", "phone cases", "phone-case"],
    ["tops", "asymmetric tops", "asymmetric-top"],
  ]
  for (const [category, before, expected] of cases) {
    assert.equal(
      classifySubcategoryRepair(row({category, subcategory: before, name: ""})).after,
      expected,
      `input: ${category}/${before}`,
    )
  }
  // 실루엣이 먼저다 — "mini crossbody bag" 은 크기 라벨로 새지 않는다.
  assert.equal(classifySubcategoryRepair(row({category: "bags", subcategory: null, name: "Mini Crossbody Bag"})).after, "crossbody")
})

test("values with no canonical home keep dropping to null", () => {
  // 어휘를 늘려 억지로 담지 않는다 — 값이 없는 편이 틀린 값보다 낫다.
  for (const [category, before] of [
    ["accessories", "spatz"],
    ["accessories", "other"],
    // 카테고리 자체가 틀린 행 (sweatshirt 는 tops 소속) — outerwear 어휘로
    // 흡수하면 잘못된 category 를 덮어버린다.
    ["outerwear", "sweatshirts"],
  ] as Array<[ProductSubcategoryRow["category"], string]>) {
    const d = classifySubcategoryRepair(row({category, subcategory: before, name: ""}))
    assert.equal(d.after, null, `input: ${category}/${before}`)
    assert.equal(d.bucket, "dropped_noncanonical")
  }
})
