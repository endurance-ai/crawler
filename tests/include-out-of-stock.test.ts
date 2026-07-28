/**
 * 품절 상품 수집 스위치 (--include-out-of-stock) 회귀 테스트.
 *
 * 배경: 품절 상품은 import 플래그(--in-stock-only)가 아니라 **크롤 레이어**에서
 * 버려진다. 2026-06 코호트 재수집 실측 기준 대상 60,634행 중 14,971행(24.7%)이
 * 품절이었고 (mohawk-general/bodega 는 각각 83%), 이 필터를 끄지 못하면 그 행들만
 * 옛 추출 로직 산물로 영구히 남는다.
 *
 * 두 가지를 잠근다:
 *   1. 기본 동작 불변 — 플래그 없이는 종전과 동일하게 품절이 빠진다 (골든 마스터
 *      불변식. shopify-parse.characterization.test.ts 가 이 전제 위에 서 있다).
 *   2. listingOnly 재사용 금지 — cafe24 에서 listingOnly 는 상세 크롤을 끄는
 *      스위치를 겸하므로 재수집에 쓸 수 없다. 별도 플래그여야 한다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {parseShopifyProducts} from "../src/lib/shopify-engine"
import {shouldKeepOutOfStock} from "../src/lib/cafe24-engine"
import fixture from "./fixtures/shopify-products.fixture.json" with {type: "json"}

const BASE_URL = "https://example-shop.com"
const KEY = "example-shop"

// 픽스처의 "Sold Out Wool Coat" 는 모든 variant 가 available:false 인 유일한 상품이다.
const SOLD_OUT_TITLE = "Sold Out Wool Coat"

test("shopify: 기본값은 품절 상품을 제외한다 (골든 마스터 불변)", () => {
  const products = parseShopifyProducts(fixture as never, BASE_URL, KEY, {})
  const titles = products.map((p) => p.name)
  assert.ok(
    !titles.includes(SOLD_OUT_TITLE),
    `기본 파싱에 품절 상품이 섞였다: ${titles.join(", ")}`,
  )
  assert.ok(products.every((p) => p.inStock), "기본 파싱 결과는 전부 재고 보유여야 한다")
})

test("shopify: keepOutOfStock 이면 품절 상품이 남고, 재고 상품 집합은 그대로다", () => {
  const withoutOos = parseShopifyProducts(fixture as never, BASE_URL, KEY, {})
  const withOos = parseShopifyProducts(fixture as never, BASE_URL, KEY, {keepOutOfStock: true})

  const oosTitles = withOos.filter((p) => !p.inStock).map((p) => p.name)
  assert.deepEqual(oosTitles, [SOLD_OUT_TITLE], "품절 상품이 정확히 하나 남아야 한다")

  // 품절을 남기는 것 외에 재고 상품의 파싱 결과는 한 글자도 달라지면 안 된다.
  const inStockNames = (list: typeof withOos) => list.filter((p) => p.inStock).map((p) => p.productUrl)
  assert.deepEqual(
    inStockNames(withOos),
    inStockNames(withoutOos),
    "keepOutOfStock 은 재고 상품 파싱에 영향을 주면 안 된다",
  )
})

test("cafe24: shouldKeepOutOfStock 은 listingOnly 와 includeOutOfStock 을 각각 인정한다", () => {
  assert.equal(shouldKeepOutOfStock({}), false)
  assert.equal(shouldKeepOutOfStock({listingOnly: true}), true)
  assert.equal(shouldKeepOutOfStock({includeOutOfStock: true}), true)
  assert.equal(shouldKeepOutOfStock({listingOnly: true, includeOutOfStock: true}), true)

  // 재수집은 품절까지 상세를 받아야 하므로 listingOnly 로 대체할 수 없다.
  // (crawlCafe24 의 Step 3 상세 크롤 게이트가 !options.listingOnly 이기 때문)
  assert.equal(
    shouldKeepOutOfStock({includeOutOfStock: true}),
    shouldKeepOutOfStock({listingOnly: true}),
    "두 플래그의 품절 판정 결과는 같아야 한다 — 다른 것은 상세 크롤 게이트뿐이다",
  )
})
