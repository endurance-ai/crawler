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
    category: "Bottom",
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

test("QC infers Cafe24 typo and capsule colors from product text", () => {
  const chacoal = normalizeProductTextFields(product({
    name: "Halter Hood Sleeveless Top - CHACOAL",
    category: "Top",
    color: null,
  }))
  assert.equal(chacoal.action, "auto_fix")
  assert.equal(chacoal.product.color, "Charcoal")

  const camo = normalizeProductTextFields(product({
    name: "Cut-out Shaper Shorts - CAMO",
    category: "Bottom",
    color: null,
  }))
  assert.equal(camo.action, "auto_fix")
  assert.equal(camo.product.color, "Camo")
})

test("QC canonicalizes Cafe24 color typos from option text", () => {
  const charcoal = normalizeProductTextFields(product({color: "Chatrcoal"}))
  assert.equal(charcoal.action, "auto_fix")
  assert.equal(charcoal.product.color, "Charcoal")

  const melange = normalizeProductTextFields(product({name: "Logo Sweat Shirts_Mellange", category: "Top", color: "Mellange"}))
  assert.equal(melange.action, "auto_fix")
  assert.equal(melange.product.color, "Melange")
})

test("QC recovers compact Cafe24 slug color suffixes", () => {
  const mint = normalizeProductTextFields(product({
    name: "Western Washed Long Sleeve T-Shirt",
    category: "Top",
    color: null,
    productUrl: "https://centaur.kr/product/western-washed-long-sleeve-t-shirtmint/7638/category/30/display/1/",
  }))
  assert.equal(mint.action, "auto_fix")
  assert.equal(mint.product.color, "Mint")

  const magenta = normalizeProductTextFields(product({
    name: "TBD Fleece Camp Cap",
    category: "Accessories",
    color: null,
    productUrl: "https://centaur.kr/product/tbd-fleece-camp-capmagenta/6996/category/30/display/1/",
  }))
  assert.equal(magenta.action, "auto_fix")
  assert.equal(magenta.product.color, "Magenta")
})

test("QC rejects non-color Cafe24 option values unless product text recovers color", () => {
  const recovered = normalizeProductTextFields(product({
    name: "Doll gold earring",
    category: "Accessories",
    color: "One",
  }))
  assert.equal(recovered.action, "auto_fix")
  assert.equal(recovered.product.color, "Gold")

  resetProductQcReport()
  const out = applyProductQcGate([
    product({
      name: "Ribbon line earring_L",
      category: "Accessories",
      color: "L 라지",
      productUrl: "https://everybirthday.co.kr/product/detail.html?product_no=274&cate_no=26&display_group=1",
    }),
  ], "everybirthday")
  assert.equal(out.length, 0)
})

test("QC rejects accessory option labels that are not colors", () => {
  const out = applyProductQcGate([
    product({
      name: "Stud snap hairpin <3",
      category: "Accessories",
      color: "Cone Stud, Square Stud",
      productUrl: "https://everybirthday.co.kr/product/detail.html?product_no=506&cate_no=48&display_group=1",
    }),
    product({
      name: "[SAGEGA X EVERYBIRTHDAY] Fur Choker Compact Bag",
      category: "Bag",
      color: "Sagega X Everybirthday",
      productUrl: "https://everybirthday.co.kr/product/detail.html?product_no=516&cate_no=48&display_group=1",
    }),
  ], "everybirthday")
  assert.equal(out.length, 0)
})

test("QC rejects magazine artifacts from accessory buckets", () => {
  const out = applyProductQcGate([
    product({
      name: "1993 THE FACE Magazine KATE MOSS cover",
      category: "ACC",
      color: "White",
      price: 1993,
      productUrl: "https://idvintage.co.kr/product/1993-the-face-magazine-kate-moss-cover/3173/category/104/display/1/",
    }),
  ], "idvintage")
  assert.equal(out.length, 0)
})

test("QC ignores policy text captured as color and falls back to product name", () => {
  const result = normalizeProductTextFields(product({
    name: "[ORDER-MADE] RIBBED SLASH MUSCLE FIT LONG SLEEVE TEE (GRAY)",
    category: "Top",
    color: "전체 주문제작 상품으로 불량을 제외한 단순변심 반품이 불가",
    productUrl: "https://cozytex.co.kr/product/order-made-ribbed-slash-muscle-fit-long-sleeve-tee-gray/63/category/44/display/1/",
  }))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.color, "Grey")
})

test("QC uses product name color when Cafe24 detail returns all option colors", () => {
  const result = normalizeProductTextFields(product({
    name: "Cardi Tank (Mint)",
    category: "Top",
    color: "Black, White, Cream, Mint",
    productUrl: "https://sosa.co.kr/product/detail.html?product_no=53&cate_no=45&display_group=1",
  }))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.color, "Mint")
})

test("QC prefers compact Cafe24 URL color when a single option conflicts", () => {
  const result = normalizeProductTextFields(product({
    name: "[ORDER-MADE] HEAVY SAG PANTS (YELLOW/MELANGE)",
    category: "Bottom",
    color: "Black",
    productUrl: "https://cozytex.co.kr/product/order-made-heavy-sag-pants-yellowmelange/39/category/44/display/1/",
  }))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.color, "Melange")
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
  const result = normalizeProductTextFields(product({name: "Silk Mini Dress", category: "Accessories"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("category_text_conflict"))
})
