import assert from "node:assert/strict"
import test from "node:test"
import {
  crawlerFieldsFromPoc,
  crawlerFieldsToPoc,
  ONBOARD_CRAWLER_METADATA_KEYS_COMPLETE,
} from "../src/lib/onboard-crawler-fields-transport"
import type {Product} from "../src/lib/types"

test("non-transformed crawler fields survive the POC boundary", () => {
  const product = {
    brand: "CRAWLER BRAND",
    name: "Test",
    category: "tops",
    gender: ["women"],
    price: 90_000,
    originalPrice: 100_000,
    salePrice: 90_000,
    priceFormatted: "₩90,000",
    imageUrl: "https://example.com/main.jpg",
    sourceImageUrl: "https://example.com/source.jpg",
    productUrl: "https://example.com/product/1",
    inStock: true,
    platform: "example",
    crawledAt: "2026-08-10T00:00:00.000Z",
    detailFetchedAt: "2026-08-10T00:00:01.000Z",
    material: "cotton",
    imageCollectionVersion: "cafe24-v2",
    imageSelection: {kind: "product", score: 90, version: "v1", candidateCount: 2, selectedAt: "2026-08-10T00:00:02.000Z"},
    sizeInfo: "S, M",
    productCode: "P-1",
    llmEnrichedAt: "2026-08-10T00:00:03.000Z",
    llmModel: "qwen",
    llmInputHash: "abc",
    normalization: {
      status: "succeeded",
      inputHash: "abc",
      policyVersion: "2026-09",
      model: "qwen",
      completedAt: "2026-08-10T00:00:03.000Z",
      category: "tops",
      subcategory: "shirts",
    },
    reviewCount: 1,
    reviews: [{text: "good", author: null, date: null, photoUrls: [], body: null}],
    reviewCollection: {
      status: "succeeded",
      observedAt: "2026-08-10T00:00:04.000Z",
      confirmedEmpty: false,
    },
  } satisfies Product

  const poc = crawlerFieldsToPoc(product)
  assert.deepEqual(crawlerFieldsFromPoc(poc), poc.crawler_metadata)
  assert.equal(poc.crawler_metadata.brand, "CRAWLER BRAND")
  assert.equal(poc.crawler_metadata.productCode, "P-1")
  assert.deepEqual(poc.crawler_metadata.reviews, product.reviews)
  assert.deepEqual(poc.crawler_metadata.normalization, product.normalization)
  assert.deepEqual(poc.crawler_metadata.reviewCollection, product.reviewCollection)
})

test("legacy metadata has no inferred provenance", () => {
  const legacy = {
    llmEnrichedAt: "2026-01-01T00:00:00.000Z",
    llmModel: "legacy-model",
    llmInputHash: "legacy-hash",
    reviews: [],
  }
  const restored = crawlerFieldsFromPoc({crawler_metadata: legacy})
  assert.equal(restored.normalization, undefined)
  assert.equal(restored.reviewCollection, undefined)
  assert.deepEqual(restored.reviews, [])
})

test("Product metadata key coverage is compile-time exhaustive", () => {
  assert.deepEqual(ONBOARD_CRAWLER_METADATA_KEYS_COMPLETE, {})
})
