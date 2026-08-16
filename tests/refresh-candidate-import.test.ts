import assert from "node:assert/strict"
import test from "node:test"

import {
  productToCandidateDbRow,
  REFRESH_FALLBACK_IMAGE_VERSION,
  withFallbackImageSelection,
} from "../src/lib/refresh-candidate-import"
import type {Product, SiteConfig} from "../src/lib/types"

const config: SiteConfig = {
  key: "kith",
  name: "Kith",
  type: "shopify",
  baseUrl: "https://kith.com",
  sourceCurrency: "USD",
}

const product: Product = {
  brand: "KITH",
  name: "New jacket",
  category: "outerwear",
  gender: ["men"],
  genderSource: "engine",
  price: 100,
  originalPrice: 120,
  salePrice: 100,
  sourcePrice: 100,
  pricingObservation: {state: "sale", source: "variant", version: 2},
  priceFormatted: "$100",
  imageUrl: "https://cdn.example/a.jpg",
  productUrl: "https://kith.com/products/new-jacket",
  inStock: true,
  platform: "kith",
  crawledAt: "2026-07-26T00:00:00Z",
  sourceCurrency: "USD",
}

test("remote worker에서도 명시적인 fallback 이미지 선택 메타데이터를 만든다", () => {
  const selected = withFallbackImageSelection(product)
  assert.equal(selected.imageSelection?.version, REFRESH_FALLBACK_IMAGE_VERSION)
  assert.equal(selected.imageSelection?.kind, "fallback")
  assert.equal(selected.imageSelection?.candidateCount, 1)
})
test("fallback 이미지 선택은 10장을 넘는 전체 배열을 보존한다", () => {
  const images = Array.from({length: 12}, (_, i) => `https://cdn.example/${i}.jpg`)
  const selected = withFallbackImageSelection({...product, images})
  assert.equal(selected.images?.length, 13)
  assert.equal(selected.imageSelection?.candidateCount, 13)
})
test("신규상품 fallback은 utility 대표 이미지를 버리고 실제 상품 이미지를 선택한다", () => {
  const utility = "https://img.echosting.cafe24.com/skin/base_ko_KR/common/ico_tip_title.gif"
  const actual = "https://cdn.example/product.jpg"
  const selected = withFallbackImageSelection({
    ...product,
    imageUrl: utility,
    sourceImageUrl: utility,
    images: [utility, actual],
  })
  assert.equal(selected.imageUrl, actual)
  assert.equal(selected.sourceImageUrl, actual)
  assert.deepEqual(selected.images, [actual])
})

test("utility 이미지밖에 없는 신규상품은 DB payload를 만들지 않는다", () => {
  const utility = "https://img.echosting.cafe24.com/skin/base_ko_KR/common/ico_tip_title.gif"
  assert.throws(
    () => productToCandidateDbRow({...product, imageUrl: utility, images: [utility]}, config, 11),
    /candidate has no usable product image/,
  )
})
test("신규상품 DB payload는 기존 brand_node_id와 source platform을 강제한다", () => {
  const row = productToCandidateDbRow(product, config, 11)
  assert.equal(row.brand_node_id, 11)
  assert.equal(row.platform, "kith")
  assert.equal(row.product_url, product.productUrl)
  assert.equal(row.image_selection_version, REFRESH_FALLBACK_IMAGE_VERSION)
  assert.equal(typeof row.price, "number")
})

test("성별이 비어 있으면 신규상품 payload를 만들지 않는다", () => {
  // migration 099 가 기록한 color 사고(210회 연속 INSERT 실패)의 gender 판.
  // 이 경로는 연구실 서버에서 15분마다 돌기 때문에, DB 제약에 도달하기 전
  // 여기서 막아야 한다.
  assert.throws(
    () => productToCandidateDbRow({...product, gender: []}, config, 11),
    /candidate gender is missing/,
  )
})

test("신규상품 payload는 gender와 gender_source를 함께 싣는다", () => {
  const row = productToCandidateDbRow(product, config, 11)
  assert.deepEqual(row.gender, ["men"])
  assert.equal(row.gender_source, "engine")
})

test("미분류 카테고리는 Qwen 호출 전에 other/null로 적재한다", () => {
  const row = productToCandidateDbRow(
    {...product, category: "SALE", subcategory: "unknown navigation"},
    config,
    11,
  )
  assert.equal(row.category, "other")
  assert.equal(row.subcategory, null)
})
