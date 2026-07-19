/**
 * listing-refresh.ts unit tests — 리스트-only 갱신의 가격 매핑과 diff.
 *
 * 이 경로는 운영 DB 의 기존 행을 직접 UPDATE 하므로, "바뀐 것만 건드린다"와
 * "불완전한 크롤로 품절 처리하지 않는다"가 핵심 불변식이다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  diffListing,
  productIdentityKey,
  toPriceFields,
  type RefreshableRow,
} from "../src/lib/listing-refresh"
import type {Product} from "../src/lib/types"

const product = (over: Partial<Product> = {}): Product =>
  ({
    brand: "B",
    name: "P",
    category: "tops",
    price: 10000,
    originalPrice: 10000,
    salePrice: null,
    priceFormatted: "₩10,000",
    imageUrl: "https://x/i.jpg",
    productUrl: "https://x/p/1",
    inStock: true,
    gender: ["women"],
    color: "black",
    platform: "cafe24",
    crawledAt: "2026-07-19T00:00:00Z",
    ...over,
  }) as unknown as Product

const row = (over: Partial<RefreshableRow> = {}): RefreshableRow => ({
  product_url: "https://x/p/1",
  price: 10000,
  original_price: 10000,
  sale_price: null,
  in_stock: true,
  ...over,
})

test("toPriceFields: 세일가가 있으면 price 는 세일가, original_price 는 정가", () => {
  const fields = toPriceFields(product({price: 7000, originalPrice: 10000, salePrice: 7000}))
  assert.deepEqual(fields, {price: 7000, original_price: 10000, sale_price: 7000})
})

test("toPriceFields: 세일가가 없으면 sale_price 는 null, price 는 정가", () => {
  const fields = toPriceFields(product({price: 10000, originalPrice: 10000, salePrice: null}))
  assert.deepEqual(fields, {price: 10000, original_price: 10000, sale_price: null})
})

test("toPriceFields: 가격을 못 읽으면 null — 기존 값을 덮어쓰지 않는다", () => {
  assert.equal(toPriceFields(product({price: null, originalPrice: null, salePrice: null})), null)
  assert.equal(toPriceFields(product({price: 0, originalPrice: null, salePrice: null})), null)
})

test("toPriceFields: 미지원 통화는 null — 원본 통화 값이 KRW 컬럼에 새지 않는다", () => {
  assert.equal(toPriceFields(product({price: 99}), "XYZ"), null)
})

test("diffListing: 변한 게 없으면 업데이트 0건", () => {
  const diff = diffListing({
    crawled: [product()],
    existing: [row()],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 0)
  assert.equal(diff.coverage, 1)
})

test("diffListing: 품절 전이를 잡는다", () => {
  const diff = diffListing({
    crawled: [product({inStock: false})],
    existing: [row({in_stock: true})],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 1)
  assert.equal(diff.updates[0].patch.in_stock, false)
  assert.ok(diff.updates[0].reasons.includes("품절"))
})

test("diffListing: 가격 변동을 잡고 세 컬럼을 함께 쓴다", () => {
  const diff = diffListing({
    crawled: [product({price: 7000, originalPrice: 10000, salePrice: 7000})],
    existing: [row({price: 10000, original_price: 10000, sale_price: null})],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 1)
  assert.deepEqual(diff.updates[0].patch, {
    in_stock: true,
    price: 7000,
    original_price: 10000,
    sale_price: 7000,
  })
})

test("diffListing: DB 에 없는 URL 은 unknown 으로 분류하고 적재하지 않는다", () => {
  const diff = diffListing({
    crawled: [product({productUrl: "https://x/p/new"})],
    existing: [row()],
    markMissingOutOfStock: false,
  })
  assert.deepEqual(diff.unknownUrls, ["https://x/p/new"])
  assert.equal(diff.updates.length, 0)
})

test("diffListing: 가드가 꺼져 있으면 사라진 상품을 건드리지 않는다", () => {
  const diff = diffListing({
    crawled: [],
    existing: [row(), row({product_url: "https://x/p/2"})],
    markMissingOutOfStock: false,
  })
  assert.equal(diff.updates.length, 0)
  assert.equal(diff.missingUrls.length, 2)
  assert.equal(diff.coverage, 0)
})

test("diffListing: 가드가 켜지면 사라진 상품을 품절 처리한다 (이미 품절인 건 제외)", () => {
  const diff = diffListing({
    crawled: [],
    existing: [row(), row({product_url: "https://x/p/2", in_stock: false})],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 1)
  assert.equal(diff.updates[0].productUrl, "https://x/p/1")
  assert.equal(diff.updates[0].patch.in_stock, false)
})

test("diffListing: coverage 는 DB 보유분 중 리스트에서 다시 확인된 비율", () => {
  const diff = diffListing({
    crawled: [product()],
    existing: [row(), row({product_url: "https://x/p/2"}), row({product_url: "https://x/p/3"})],
    markMissingOutOfStock: false,
  })
  assert.equal(Math.round(diff.coverage * 100) / 100, 0.33)
})

test("productIdentityKey: imweb idx / cafe24 product_no 를 호스트와 함께 뽑는다", () => {
  assert.equal(productIdentityKey("https://a.kr/66/?idx=402"), "a.kr#idx=402")
  assert.equal(productIdentityKey("https://a.kr/x/?product_no=7"), "a.kr#product_no=7")
  assert.equal(productIdentityKey("https://a.kr/product/foo"), null)
  assert.equal(productIdentityKey("not-a-url"), null)
})

test("productIdentityKey: 호스트가 다르면 키도 다르다 (교차 브랜드 오매칭 방지)", () => {
  assert.notEqual(productIdentityKey("https://a.kr/1/?idx=5"), productIdentityKey("https://b.kr/1/?idx=5"))
})

test("diffListing: imweb 카테고리 경로가 바뀌어도 idx 로 같은 상품을 찾는다", () => {
  // 실측 2026-07-19 differentis: DB /66/?idx=402 vs 재크롤 /wwwdifferentiskr/?idx=402
  const diff = diffListing({
    crawled: [product({productUrl: "https://d.kr/wwwdifferentiskr/?idx=402", inStock: false})],
    existing: [row({product_url: "https://d.kr/66/?idx=402", in_stock: true})],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 1)
  // UPDATE 는 DB 에 저장된 URL 을 대상으로 해야 실제로 행을 찾는다
  assert.equal(diff.updates[0].productUrl, "https://d.kr/66/?idx=402")
  assert.equal(diff.updates[0].patch.in_stock, false)
  assert.deepEqual(diff.unknownUrls, [])
  assert.equal(diff.coverage, 1) // 사라진 것으로 세지 않는다
})

test("diffListing: 같은 idx 를 가진 DB 행이 둘이면 폴백 매칭하지 않는다", () => {
  const diff = diffListing({
    crawled: [product({productUrl: "https://d.kr/new/?idx=402"})],
    existing: [
      row({product_url: "https://d.kr/66/?idx=402"}),
      row({product_url: "https://d.kr/77/?idx=402"}),
    ],
    markMissingOutOfStock: false,
  })
  assert.deepEqual(diff.unknownUrls, ["https://d.kr/new/?idx=402"])
  assert.equal(diff.updates.length, 0)
})

test("diffListing: 정확 URL 매칭이 폴백보다 우선한다", () => {
  const diff = diffListing({
    crawled: [product({productUrl: "https://d.kr/77/?idx=402", inStock: false})],
    existing: [
      row({product_url: "https://d.kr/77/?idx=402", in_stock: true}),
      row({product_url: "https://d.kr/66/?idx=999", in_stock: true}),
    ],
    markMissingOutOfStock: false,
  })
  assert.equal(diff.updates.length, 1)
  assert.equal(diff.updates[0].productUrl, "https://d.kr/77/?idx=402")
})

test("diffListing: 리스트 중복 URL 은 한 번만 반영한다", () => {
  const diff = diffListing({
    crawled: [product({inStock: false}), product({inStock: false})],
    existing: [row({in_stock: true})],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 1)
})
