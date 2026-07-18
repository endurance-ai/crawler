/**
 * imweb-engine pure-seam tests — parseImwebListItem.
 *
 * Custom-brand pilot (2026-07). The mapping consumes the machine-readable
 * `data-product-properties` JSON captured from rendered `.shop-item`
 * elements (spike: heretic.kr / aubour.com) — DOM text is never used.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {parseImwebListItem, type ImwebListItem} from "../src/lib/imweb-engine"

const CONFIG = {key: "heretic", name: "헤레틱", brand: "HERETIC", defaultGender: ["men"]}

const item = (overrides: Partial<ImwebListItem> = {}): ImwebListItem => ({
  properties: {
    idx: 640,
    code: "s202603271ebacb233f28d",
    name: "BUTTON DETACHABLE JACKET / light beige",
    original_price: 328000,
    price: 262400,
    image_url: "https://cdn-optimized.imweb.me/upload/x.jpg?w=800",
  },
  link: "https://heretic.kr/203/?idx=640",
  soldOutBadge: false,
  ...overrides,
})

test("maps data-product-properties to Product with sale price", () => {
  const p = parseImwebListItem(item(), CONFIG, "OUTER")
  assert.ok(p)
  assert.equal(p.brand, "HERETIC") // config.brand 고정 (단일브랜드 원칙)
  assert.equal(p.name, "BUTTON DETACHABLE JACKET / light beige")
  assert.equal(p.category, "OUTER")
  assert.equal(p.price, 262400)
  assert.equal(p.originalPrice, 328000)
  assert.equal(p.salePrice, 262400) // price < original_price → sale
  assert.equal(p.priceFormatted, "₩262,400")
  assert.equal(p.productUrl, "https://heretic.kr/203/?idx=640")
  assert.equal(p.inStock, true)
  assert.deepEqual(p.gender, ["men"])
  assert.equal(p.platform, "heretic")
  assert.equal(p.productCode, "s202603271ebacb233f28d")
  assert.equal(p.color, "Beige") // "/ light beige" suffix → CANONICAL 정규화
})

test("no sale: salePrice null, originalPrice mirrors price", () => {
  const p = parseImwebListItem(
    item({properties: {...item().properties, original_price: 262400, price: 262400}}),
    CONFIG,
    "",
  )
  assert.ok(p)
  assert.equal(p.salePrice, null)
  assert.equal(p.originalPrice, 262400)
})

test("brand falls back to config.name when config.brand empty", () => {
  const p = parseImwebListItem(item(), {...CONFIG, brand: undefined}, "")
  assert.ok(p)
  assert.equal(p.brand, "헤레틱")
})

test("string prices are coerced; sold-out badge flips inStock", () => {
  const p = parseImwebListItem(
    item({
      properties: {...item().properties, original_price: "328,000", price: "262,400"},
      soldOutBadge: true,
    }),
    CONFIG,
    "",
  )
  assert.ok(p)
  assert.equal(p.price, 262400)
  assert.equal(p.inStock, false)
})

test("rejects items without name, link, or any price", () => {
  assert.equal(parseImwebListItem(item({properties: {...item().properties, name: ""}}), CONFIG, ""), null)
  assert.equal(parseImwebListItem(item({link: null}), CONFIG, ""), null)
  assert.equal(
    parseImwebListItem(item({properties: {idx: 1, code: "x", name: "NO PRICE ITEM"}}), CONFIG, ""),
    null,
  )
})

test("non-https image_url is dropped (empty imageUrl, no images array)", () => {
  const p = parseImwebListItem(
    item({properties: {...item().properties, image_url: "javascript:alert(1)"}}),
    CONFIG,
    "",
  )
  assert.ok(p)
  assert.equal(p.imageUrl, "")
  assert.equal(p.images, undefined)
})
