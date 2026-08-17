import test from "node:test"
import assert from "node:assert/strict"

import {isLegacyKidsRow, shopifyProductHandle} from "../tools/repair-shopify-legacy-from-collections"

test("Shopify 상품 URL에서 안정적인 handle만 추출한다", () => {
  assert.equal(shopifyProductHandle("https://kith.com/products/ABC-123?variant=1"), "abc-123")
  assert.equal(shopifyProductHandle("https://kith.com/collections/women/products/abc"), null)
  assert.equal(shopifyProductHandle("not a url"), null)
})

test("공식 컬렉션 복구 전에 태그 전용 kids 신호도 제외한다", () => {
  assert.equal(isLegacyKidsRow({
    name: "GS 204L Lace",
    product_url: "https://kith.com/products/gs-204l-lace",
    tags: ["footwear", "kids"],
  }), true)
})
