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

test("productIdentityKey: cafe24 rewrite URL 에서 상품번호를 뽑는다", () => {
  // 실측 themysterioushotel — 슬러그(상품명)는 바뀔 수 있으므로 숫자 ID 만 본다
  assert.equal(
    productIdentityKey("https://t.com/product/rugby-wrap-skirt/878/category/50/display/1/"),
    "t.com#product_no=878",
  )
  // 같은 상품이 다른 카테고리로 나와도 같은 키
  assert.equal(
    productIdentityKey("https://t.com/product/rugby-wrap-skirt/878/category/87/display/1/"),
    productIdentityKey("https://t.com/product/rugby-wrap-skirt/878/category/50/display/1/"),
  )
  // 슬러그가 바뀌어도 같은 키
  assert.equal(
    productIdentityKey("https://t.com/product/renamed-skirt/878/category/50/display/1/"),
    "t.com#product_no=878",
  )
})

test("productIdentityKey: 쿼리형과 rewrite 형이 같은 네임스페이스를 쓴다", () => {
  assert.equal(
    productIdentityKey("https://c.com/product/detail.html?product_no=63781&cate_no=218"),
    productIdentityKey("https://c.com/product/some-slug/63781/category/218/display/1/"),
  )
})

test("productIdentityKey: 상품번호가 없는 경로는 키를 만들지 않는다", () => {
  assert.equal(productIdentityKey("https://t.com/product/list.html"), null)
  assert.equal(productIdentityKey("https://t.com/product/slug-only/"), null)
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

test("diffListing: 같은 상품이 여러 행으로 중복 적재돼 있으면 전부 함께 갱신한다", () => {
  // 실측 themysterioushotel: 409행 = 상품 103개. 한 행만 고치면 나머지가
  // "사라진 상품" 으로 보여 품절 처리된다 (오탐 101건).
  const diff = diffListing({
    crawled: [product({productUrl: "https://t.com/product/s/878/category/50/display/1/", inStock: false})],
    existing: [
      row({product_url: "https://t.com/product/s/878/category/50/display/1/", in_stock: true}),
      row({product_url: "https://t.com/product/s/878/category/87/display/1/", in_stock: true}),
      row({product_url: "https://t.com/product/s/878/category/28/display/1/", in_stock: true}),
    ],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 3)
  assert.ok(diff.updates.every((u) => u.patch.in_stock === false))
  assert.equal(diff.missingUrls.length, 0) // 중복 행이 사라진 것으로 세지 않는다
  assert.equal(diff.coverage, 1)
})

test("diffListing: 중복 행 중 하나만 상태가 어긋나 있으면 그 행만 업데이트된다", () => {
  const diff = diffListing({
    crawled: [product({productUrl: "https://t.com/product/s/878/category/50/display/1/", inStock: true})],
    existing: [
      row({product_url: "https://t.com/product/s/878/category/50/display/1/", in_stock: true}),
      row({product_url: "https://t.com/product/s/878/category/87/display/1/", in_stock: false}),
    ],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 1)
  assert.equal(diff.updates[0].productUrl, "https://t.com/product/s/878/category/87/display/1/")
  assert.ok(diff.updates[0].reasons.includes("재입고"))
})

test("diffListing: 리스트 중복 URL 은 한 번만 반영한다", () => {
  const diff = diffListing({
    crawled: [product({inStock: false}), product({inStock: false})],
    existing: [row({in_stock: true})],
    markMissingOutOfStock: true,
  })
  assert.equal(diff.updates.length, 1)
})

// ── C1 선행: last_seen_at 을 올릴 대상 (생존 확인) ─────────────────────────────

test("diffListing: confirmedUrls 는 값이 안 바뀐 상품까지 포함한다", () => {
  // updates 는 변경된 행만 담으므로 생존 신호로 쓸 수 없다 — 실측 평균 32행/런.
  // last_seen_at 을 올릴 대상은 confirmedUrls 다.
  const diff = diffListing({
    crawled: [
      {productUrl: "https://s.test/a", price: 1000, inStock: true} as never,
      {productUrl: "https://s.test/b", price: 2000, inStock: true} as never,
    ],
    existing: [
      // a: 완전히 동일 → updates 에 안 들어간다
      {product_url: "https://s.test/a", price: 1000, original_price: 1000, sale_price: null, in_stock: true},
      // b: 가격 변동 → updates 에 들어간다
      {product_url: "https://s.test/b", price: 9999, original_price: 9999, sale_price: null, in_stock: true},
    ],
    markMissingOutOfStock: false,
  })

  assert.deepEqual(diff.updates.map((u) => u.productUrl), ["https://s.test/b"])
  assert.deepEqual(diff.confirmedUrls.sort(), ["https://s.test/a", "https://s.test/b"])
})

test("diffListing: confirmedUrls 와 missingUrls 는 DB 보유분의 정확한 분할이다", () => {
  const existing = [
    {product_url: "https://s.test/a", price: 1, original_price: 1, sale_price: null, in_stock: true},
    {product_url: "https://s.test/gone", price: 1, original_price: 1, sale_price: null, in_stock: true},
  ]
  const diff = diffListing({
    crawled: [{productUrl: "https://s.test/a", price: 1, inStock: true} as never],
    existing,
    markMissingOutOfStock: false,
  })

  assert.deepEqual(diff.confirmedUrls, ["https://s.test/a"])
  assert.deepEqual(diff.missingUrls, ["https://s.test/gone"])
  assert.equal(diff.confirmedUrls.length + diff.missingUrls.length, existing.length)
})

test("diffListing: 카테고리별 중복 적재된 같은 상품 행 전부가 생존 확인된다", () => {
  // 한 행만 확인 처리하면 나머지가 stale 로 남아 sweep 이 멀쩡한 상품을 죽인다.
  const diff = diffListing({
    crawled: [
      {productUrl: "https://s.test/product/x/878/category/50/display/1/", price: 1, inStock: true} as never,
    ],
    existing: [
      {
        product_url: "https://s.test/product/x/878/category/50/display/1/",
        price: 1,
        original_price: 1,
        sale_price: null,
        in_stock: true,
      },
      {
        product_url: "https://s.test/product/x/878/category/99/display/1/",
        price: 1,
        original_price: 1,
        sale_price: null,
        in_stock: true,
      },
    ],
    markMissingOutOfStock: true,
  })

  assert.equal(diff.confirmedUrls.length, 2)
  assert.equal(diff.missingUrls.length, 0)
})
