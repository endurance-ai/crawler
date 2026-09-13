import assert from "node:assert/strict"
import test from "node:test"

import {runProductImport, readStablePages, type ProductImportDependencies} from "../src/lib/import-products-orchestrator"
import {pipelineExitCode} from "../src/lib/pipeline-report"
import type {PreparedProductWrite} from "../src/lib/pipeline-integrity-types"
import type {Product, SiteConfig} from "../src/lib/types"

const config = {key: "shop", name: "Shop", type: "shopify", baseUrl: "https://example.com", brand: "House"} satisfies SiteConfig
function product(index = 1, overrides: Partial<Product> = {}): Product {
  return {brand: "House", name: `Shirt ${index}`, category: "tops", subcategory: "shirt", gender: ["women"],
    price: 1000, originalPrice: 1000, salePrice: null, pricingObservation: {state: "regular", source: "listing", version: 2},
    sourceCurrency: "KRW", sourcePrice: 1000, priceFormatted: "₩1,000", imageUrl: `https://example.com/${index}.jpg`,
    productUrl: `https://example.com/p/${index}`, inStock: true, platform: "shop", crawledAt: "2026-09-12T00:00:00.123456Z", ...overrides}
}

function dependencies(calls: string[], overrides: Partial<ProductImportDependencies> = {}): ProductImportDependencies {
  return {
    resolveBrand: () => ({status: "existing", brand: "House", brandNodeId: "7"}),
    getExistingProduct: () => null,
    prepareDependencies: {},
    prepare: async (input) => {
      calls.push("prepare")
      const normalization = {status: "not_required" as const, inputHash: "hash", policyVersion: "v1", model: null, completedAt: "2026-09-12T00:01:00Z", category: "tops", subcategory: "shirt"}
      const prepared = {product: {product_url: input.product.productUrl, brand_node_id: "7", gender: ["women"], category: "tops", subcategory: "shirt", price: 1000, original_price: 1000, sale_price: null, source_currency: "KRW", source_price: 1000, image_url: input.product.imageUrl}, normalization: {status: "not_required", input_hash: "hash", policy_version: "v1", model: null, completed_at: "2026-09-12T00:01:00Z"}, pricing_observation: {state: "regular", source: "listing", version: 2}, observed_at: input.observedAt, expected_updated_at: input.expectedUpdatedAt} satisfies PreparedProductWrite
      return {status: "prepared", prepared, product: input.product, normalization, brandResolution: {status: "existing", brand: "House", brandNodeId: "7"}}
    },
    writePrepared: async (rows) => { calls.push("write"); return rows.map((row) => ({product_url: row.product.product_url, id: "10", outcome: "inserted"})) },
    replaceReviews: async () => { calls.push("reviews"); return {outcome: "applied", product_id: "10", review_count: 0} },
    writeCheckpoint: () => { calls.push("checkpoint") },
    syncStatus: () => { calls.push("status") },
    ...overrides,
  }
}

test("dry-run performs lookups only and reports a planned file", async () => {
  const calls: string[] = []
  const deps = dependencies(calls, {resolveBrand: () => { calls.push("lookup"); return {status: "would_create", brand: "House"} }, createBrand: () => { calls.push("create"); return {status: "existing", brand: "House", brandNodeId: "7"} }})
  const result = await runProductImport([{platform: "shop", file: "shop.json", products: [product()], config}], {mode: "dry_run", now: () => "2026-09-12T00:00:00Z"}, deps)
  assert.deepEqual(calls, ["lookup"])
  assert.equal(result.report.status, "planned")
  assert.equal(result.report.files[0].status, "planned")
  assert.equal(result.report.counts.planned, 1)
})

test("failed normalization cannot create a product", async () => {
  const calls: string[] = []
  const deps = dependencies(calls, {prepare: async () => ({status: "failed", error: {stage: "normalization", code: "normalization_failed", message: "failed", retryable: true}})})
  const result = await runProductImport([{platform: "shop", products: [product()], config}], {mode: "apply"}, deps)
  assert.equal(calls.includes("write"), false)
  assert.equal(result.report.status, "failed")
  assert.equal(result.report.counts.qc_failed, 1)
})

test("creates a trusted brand only after validated preparation", async () => {
  const calls: string[] = []
  const normalization = {status: "not_required" as const, inputHash: "hash", policyVersion: "v1", model: null, completedAt: "2026-09-12T00:01:00Z", category: "tops", subcategory: "shirt"}
  let preparations = 0
  const deps = dependencies(calls, {
    resolveBrand: () => ({status: "would_create", brand: "House"}),
    prepare: async (input, injected) => {
      calls.push(`prepare${++preparations}`)
      if (preparations === 1) return {status: "would_create", brandResolution: {status: "would_create", brand: "House"}, product: input.product, normalization}
      return dependencies(calls).prepare(input, injected)
    },
    createBrand: () => { calls.push("create"); return {status: "existing", brand: "House", brandNodeId: "7"} },
  })
  const result = await runProductImport([{platform: "shop", products: [product()], config}], {mode: "apply"}, deps)
  assert.deepEqual(calls.slice(0, 3), ["prepare1", "create", "prepare2"])
  assert.equal(result.report.status, "success")
})

test("quarantined retailer brand is always excluded", async () => {
  const calls: string[] = []
  const retailer = {...config, brand: undefined, multiBrand: true}
  const deps = dependencies(calls, {resolveBrand: () => ({status: "quarantined", brand: "garbage", reason: "untrusted"})})
  const result = await runProductImport([{platform: "shop", products: [product()], config: retailer}], {mode: "apply"}, deps)
  assert.equal(result.report.counts.policy_excluded, 1)
  assert.equal(calls.includes("write"), false)
  assert.equal(result.report.status, "success")
})

test("preserves existing updated_at precision for CAS", async () => {
  const calls: string[] = []
  const timestamp = "2026-09-11T10:20:30.123456+00:00"
  const deps = dependencies(calls, {
    getExistingProduct: () => ({id: "2", productUrl: product().productUrl, updatedAt: timestamp, observedAt: null}),
    prepare: async (input, injected) => {
      assert.equal(input.expectedUpdatedAt, timestamp)
      return dependencies(calls).prepare(input, injected)
    },
  })
  const result = await runProductImport([{platform: "shop", products: [product()], config}], {mode: "apply"}, deps)
  assert.equal(result.report.status, "success")
})

test("prepared RPC partial failure produces partial report and nonzero exit", async () => {
  const calls: string[] = []
  let writes = 0
  const deps = dependencies(calls, {writePrepared: async (rows) => {
    writes++
    if (writes === 2) throw new Error("db unavailable")
    return [{product_url: rows[0].product.product_url, id: "10", outcome: "inserted"}]
  }})
  const result = await runProductImport([{platform: "shop", file: "shop.json", products: [product(1), product(2)], config}], {mode: "apply"}, deps)
  assert.equal(result.report.status, "partial")
  assert.equal(result.report.files[0].status, "partial")
  assert.equal(result.report.counts.inserted, 1)
  assert.equal(result.report.counts.failed, 1)
  assert.equal(pipelineExitCode(result.report), 1)
})

test("partial reviews are retained and mark the import incomplete", async () => {
  const calls: string[] = []
  const withPartial = product(1, {reviews: [{text: "old", author: null, date: null, photoUrls: [], body: null}], reviewCollection: {status: "partial", observedAt: "2026-09-12T00:00:00Z", confirmedEmpty: false}})
  const result = await runProductImport([{platform: "shop", products: [withPartial], config}], {mode: "apply"}, dependencies(calls))
  assert.equal(calls.includes("reviews"), false)
  assert.equal(result.report.status, "partial")
  assert.equal(result.report.errors.some((error) => error.code === "review_collection_incomplete"), true)
})

test("rejects malformed successful product and review RPC results", async () => {
  const badProduct = await runProductImport([{platform: "shop", products: [product()], config}], {mode: "apply"}, dependencies([], {
    writePrepared: async (rows) => [{product_url: rows[0].product.product_url, id: null, outcome: "inserted"}],
  }))
  assert.equal(badProduct.report.errors.some((error) => error.code === "prepared_rpc_failed"), true)

  const reviewed = product(2, {reviews: [{text: "ok", author: null, date: null, photoUrls: [], body: null}], reviewCollection: {status: "succeeded", observedAt: "2026-09-12T00:00:00Z", confirmedEmpty: false}})
  const badReview = await runProductImport([{platform: "shop", products: [reviewed], config}], {mode: "apply"}, dependencies([], {
    replaceReviews: async () => ({outcome: "applied", product_id: "999", review_count: 0}),
  }))
  assert.equal(badReview.report.errors.some((error) => error.code === "review_rpc_failed"), true)
})

test("stable reader exhausts pages and rejects non-monotonic IDs", async () => {
  const pages = [[{id: "1"}, {id: "2"}], [{id: "3"}], []]
  const rows = await readStablePages(async () => pages.shift() ?? [], 2)
  assert.deepEqual(rows.map((row) => row.id), ["1", "2", "3"])
  await assert.rejects(() => readStablePages(async () => [{id: "2"}, {id: "1"}], 2), /strictly increasing/)
})
