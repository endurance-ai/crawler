import assert from "node:assert/strict"
import test from "node:test"

import {planPlatformTypeBackfill} from "../src/lib/platform-type-backfill"

const base = {brand_node_id: 1, platform_key: "acme", platform_type: "unknown"}

test("products.platform 실측이 하나로 모이면 그 값으로 채운다", () => {
  const plan = planPlatformTypeBackfill([
    {...base, productPlatforms: ["shopify", "shopify", "shopify"], inStockProducts: 42},
  ])
  assert.deepEqual(plan.changes, [
    {
      brand_node_id: 1,
      platform_key: "acme",
      from: "unknown",
      to: "shopify",
      inStockProducts: 42,
      needsCategoryDetection: false,
    },
  ])
})

test("이미 타입이 있으면 건드리지 않는다", () => {
  const plan = planPlatformTypeBackfill([
    {...base, platform_type: "cafe24", productPlatforms: ["cafe24"]},
  ])
  assert.equal(plan.changes.length, 0)
  assert.deepEqual(plan.skipped, [{platform_key: "acme", reason: "already-typed:cafe24"}])
})

test("한 브랜드가 두 엔진 라벨로 갈리면 판단을 보류한다", () => {
  // 어느 쪽이 맞는지 모르는데 찍으면 잘못된 엔진으로 크롤이 돌아간다.
  const plan = planPlatformTypeBackfill([
    {...base, productPlatforms: ["cafe24", "shopify"]},
  ])
  assert.equal(plan.changes.length, 0)
  assert.deepEqual(plan.skipped, [{platform_key: "acme", reason: "ambiguous:cafe24|shopify"}])
})

test("근거가 없거나 지원하지 않는 엔진은 보류한다", () => {
  const plan = planPlatformTypeBackfill([
    {...base, platform_key: "no-evidence", productPlatforms: []},
    {...base, platform_key: "imweb-ish", productPlatforms: ["custom"]},
  ])
  assert.equal(plan.changes.length, 0)
  assert.deepEqual(plan.skipped, [
    {platform_key: "no-evidence", reason: "no-product-evidence"},
    {platform_key: "imweb-ish", reason: "unsupported:custom"},
  ])
})

test("cafe24 는 categories 가 비어 있으면 cateNo 재탐지 필요로 표시한다", () => {
  // config 만 생겨도 카테고리 번호가 없으면 크롤이 0건이다 — 실측된 함정
  // (DISABLED_KEYS 의 batch1~3 이 전부 이 사유).
  const plan = planPlatformTypeBackfill([
    {...base, platform_key: "c24-nocat", productPlatforms: ["cafe24"], categoryCount: 0},
    {...base, platform_key: "c24-ok", productPlatforms: ["cafe24"], categoryCount: 7},
    {...base, platform_key: "shop-nocat", productPlatforms: ["shopify"], categoryCount: 0},
  ])
  assert.deepEqual(
    plan.changes.map((c) => [c.platform_key, c.needsCategoryDetection]),
    [
      ["c24-nocat", true],
      ["c24-ok", false],
      // shopify 는 products.json 으로 열거하므로 categories 가 필요 없다
      // (실측: 생성된 shopify config 38개 중 categories 보유 0개).
      ["shop-nocat", false],
    ],
  )
})

test("재고 상품 수 내림차순으로 정렬한다", () => {
  const plan = planPlatformTypeBackfill([
    {...base, platform_key: "small", productPlatforms: ["shopify"], inStockProducts: 5},
    {...base, platform_key: "big", productPlatforms: ["shopify"], inStockProducts: 900},
  ])
  assert.deepEqual(plan.changes.map((c) => c.platform_key), ["big", "small"])
})
