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
  price: 100,
  originalPrice: 120,
  salePrice: 100,
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
test("신규상품 DB payload는 기존 brand_node_id와 source platform을 강제한다", () => {
  const row = productToCandidateDbRow(product, config, 11)
  assert.equal(row.brand_node_id, 11)
  assert.equal(row.platform, "kith")
  assert.equal(row.product_url, product.productUrl)
  assert.equal(row.image_selection_version, REFRESH_FALLBACK_IMAGE_VERSION)
  assert.equal(typeof row.price, "number")
})
