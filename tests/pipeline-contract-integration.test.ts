import assert from "node:assert/strict"
import test from "node:test"

import {runProductImport, type ProductImportDependencies} from "../src/lib/import-products-orchestrator"
import {crawlerFieldsFromPoc, crawlerFieldsToPoc} from "../src/lib/onboard-crawler-fields-transport"
import {prepareProductForImport} from "../src/lib/prepare-product-for-import"
import type {PreparedProductWrite, PreparedProductWriteResult} from "../src/lib/pipeline-integrity-types"
import type {Product, SiteConfig} from "../src/lib/types"

const config = {key: "official", name: "Official", type: "shopify", baseUrl: "https://shop.example", brand: "raw-brand"} satisfies SiteConfig

function product(overrides: Partial<Product> = {}): Product {
  return {
    brand: "raw-brand", name: "Archive item 001", category: "other", gender: ["women"],
    price: 80_000, originalPrice: 100_000, salePrice: 80_000,
    pricingObservation: {state: "sale", source: "detail", version: 2}, sourceCurrency: "KRW", sourcePrice: 80_000,
    priceFormatted: "₩80,000", imageUrl: "https://cdn.example/jacket.jpg",
    productUrl: "https://shop.example/products/jacket", inStock: true, platform: "official",
    crawledAt: "2026-09-12T00:00:00.123Z", detailFetchedAt: "2026-09-12T00:05:00.456Z",
    ...overrides,
  }
}

test("T07 produces the exact prepared RPC envelope from verified source evidence", async () => {
  const result = await prepareProductForImport({product: product(), config,
    observedAt: "2026-09-12T00:05:00.456Z", expectedUpdatedAt: "2026-09-11T01:02:03.123456+00:00"}, {
    resolveBrand: () => ({status: "existing", brand: "Canonical Brand", brandNodeId: "9007199254740993"}),
    normalize: async () => ({category: "outerwear", subcategory: "jacket", model: "qwen-test", completedAt: "2026-09-12T00:06:00Z"}),
    policyVersion: "policy-test",
  })
  assert.equal(result.status, "prepared")
  if (result.status !== "prepared") return
  assert.deepEqual(result.prepared.normalization, {
    status: "succeeded", input_hash: result.normalization.inputHash, policy_version: "policy-test",
    model: "qwen-test", completed_at: "2026-09-12T00:06:00Z",
  })
  assert.deepEqual(result.prepared.pricing_observation, {state: "sale", source: "detail", version: 2})
  assert.equal(result.prepared.product.brand, "Canonical Brand")
  assert.equal(result.prepared.product.brand_node_id, "9007199254740993")
  assert.equal(result.prepared.product.crawled_at, result.prepared.observed_at)
  assert.equal(result.prepared.observed_at, "2026-09-12T00:05:00.456Z")
  assert.equal(result.prepared.expected_updated_at, "2026-09-11T01:02:03.123456+00:00")
})

test("would-create replay uses one normalization call and the resolved alias ID", async () => {
  let normalizeCalls = 0
  let writes: PreparedProductWrite[] = []
  const dependencies: ProductImportDependencies = {
    resolveBrand: () => ({status: "would_create", brand: "Canonical Brand"}),
    getExistingProduct: () => null,
    createBrand: () => ({status: "existing", brand: "Canonical Brand", brandNodeId: "77"}),
    prepare: prepareProductForImport,
    prepareDependencies: {policyVersion: "policy-test", now: () => "2026-09-12T00:06:00Z",
      normalize: async () => { normalizeCalls++; return {category: "outerwear", subcategory: "jacket", model: "qwen-test"} }},
    writePrepared: async (rows) => { writes = rows; return rows.map((row): PreparedProductWriteResult => ({product_url: row.product.product_url, id: "101", outcome: "inserted"})) },
    replaceReviews: async () => ({outcome: "unchanged", product_id: "101", review_count: 0}),
  }
  const result = await runProductImport([{platform: "official", products: [product()], config}], {mode: "apply"}, dependencies)
  assert.equal(result.report.status, "success")
  assert.equal(normalizeCalls, 1)
  assert.equal(writes[0].product.brand, "Canonical Brand")
  assert.equal(writes[0].product.brand_node_id, "77")
})

test("T10 metadata survives POC transport and maps nullable reviews to the atomic RPC", async () => {
  const source = product({category: "outerwear", subcategory: "jacket",
    reviews: [{text: "Fits well", author: null, date: null, photoUrls: [], body: null}],
    reviewCollection: {status: "succeeded", observedAt: "2026-09-12T00:04:00Z", confirmedEmpty: false}})
  const restored = {...source, ...crawlerFieldsFromPoc(crawlerFieldsToPoc(source))}
  let reviewPayload: Parameters<ProductImportDependencies["replaceReviews"]>[0] | undefined
  const dependencies: ProductImportDependencies = {
    resolveBrand: () => ({status: "existing", brand: "Canonical Brand", brandNodeId: "77"}),
    getExistingProduct: () => null,
    prepare: prepareProductForImport,
    prepareDependencies: {},
    writePrepared: async (rows) => rows.map((row) => ({product_url: row.product.product_url, id: "101", outcome: "inserted"})),
    replaceReviews: async (payload) => { reviewPayload = payload; return {outcome: "applied", product_id: payload.productId, review_count: payload.reviews.length} },
  }
  const result = await runProductImport([{platform: "official", products: [restored], config}], {mode: "apply"}, dependencies)
  assert.equal(result.report.status, "success")
  assert.deepEqual(reviewPayload, {productId: "101", observedAt: "2026-09-12T00:04:00Z",
    reviews: [{text: "Fits well", author: null, review_date: null, photo_urls: [], body_info: null}]})
})
