import assert from "node:assert/strict"
import test from "node:test"

import {qwenNormalizationInputHash} from "../src/lib/product-qwen-normalization"
import {normalizeProductForImport, prepareProductForImport} from "../src/lib/prepare-product-for-import"
import {recoverCafe24CandidateDetailPricing} from "../src/lib/candidate-detail-pricing"
import type {Cafe24Page} from "../src/lib/cafe24-page"
import type {Product, SiteConfig} from "../src/lib/types"

const config = {key: "shop", name: "Shop", type: "shopify", baseUrl: "https://example.com"} satisfies SiteConfig

function product(overrides: Partial<Product> = {}): Product {
  return {
    brand: "FCE", name: "Cotton shirt", category: "tops", subcategory: "shirt",
    gender: ["women"], price: 90_000, originalPrice: 100_000, salePrice: 90_000,
    pricingObservation: {state: "sale", source: "listing", version: 2},
    sourceCurrency: "KRW", sourcePrice: 90_000, priceFormatted: "₩90,000",
    imageUrl: "https://example.com/image.jpg", productUrl: "https://example.com/p/1",
    inStock: true, platform: "shop", crawledAt: "2026-09-12T00:00:00Z", ...overrides,
  }
}

const existingBrand = () => ({status: "existing" as const, brand: "F/ce", brandNodeId: "42"})

test("prepares a confirmed product with not_required normalization", async () => {
  const result = await prepareProductForImport(
    {product: product(), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: existingBrand, now: () => "2026-09-12T00:01:00Z"},
  )
  assert.equal(result.status, "prepared")
  if (result.status !== "prepared") return
  assert.equal(result.normalization.status, "not_required")
  assert.equal(result.prepared.product.brand_node_id, "42")
  assert.equal(result.prepared.pricing_observation.version, 2)
})

test("excludes verified non-fashion merchandise before brand or Qwen work", async () => {
  let calls = 0
  const result = await prepareProductForImport(
    {
      product: product({name: "APPLE WATCH SPORT STRAP", category: "accessories"}),
      config,
      observedAt: "2026-09-12T00:00:00Z",
      expectedUpdatedAt: null,
    },
    {
      resolveBrand: () => { calls++; return existingBrand() },
      normalize: async () => { calls++; return {category: "other", subcategory: null, model: "qwen"} },
    },
  )
  assert.equal(result.status, "policy_excluded")
  assert.equal(calls, 0)
})

test("uses a verified platform brand alias in the prepared write", async () => {
  const slowsteady = {...config, key: "slowsteadyclub"}
  let resolvedBrand = ""
  const result = await prepareProductForImport(
    {
      product: product({brand: "FRESH SERVICE PRODUCT", platform: "slowsteadyclub"}),
      config: slowsteady,
      observedAt: "2026-09-12T00:00:00Z",
      expectedUpdatedAt: null,
    },
    {
      resolveBrand: ({brand}) => {
        resolvedBrand = brand
        return {status: "existing", brand, brandNodeId: "42"}
      },
    },
  )
  assert.equal(result.status, "prepared")
  assert.equal(resolvedBrand, "FRESH SERVICE")
})

test("Cafe24 unknown pricing is recovered before brand and payload preparation", async () => {
  const calls: string[] = []
  const cafe = {...config, key: "cafe", type: "cafe24" as const}
  const result = await prepareProductForImport(
    {product: product({platform: "cafe", pricingObservation: {state: "unknown", source: "listing", version: 2}}), config: cafe, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {
      recoverDetailPricing: async (value) => { calls.push("price"); return {...value, pricingObservation: {state: "regular", source: "detail", version: 2}, price: 100_000, originalPrice: 100_000, salePrice: null, sourcePrice: 100_000} },
      resolveBrand: () => { calls.push("brand"); return existingBrand() },
    },
  )
  assert.equal(result.status, "prepared")
  assert.deepEqual(calls, ["price", "brand"])
})

test("unknown pricing cannot produce a prepared envelope", async () => {
  const result = await prepareProductForImport(
    {product: product({pricingObservation: {state: "unknown", source: "listing", version: 2}}), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: existingBrand},
  )
  assert.equal(result.status, "failed")
  if (result.status === "failed") assert.equal(result.error.code, "pricing_unverified")
})

test("reuses a matching successful normalization checkpoint", async () => {
  const value = product({category: "other", subcategory: undefined})
  const input = {productUrl: value.productUrl, name: value.name, brand: "F/ce", category: value.category, subcategory: value.subcategory, tags: value.tags}
  const checkpoint = {status: "unchanged" as const, inputHash: qwenNormalizationInputHash(input), policyVersion: "p1", model: "qwen", completedAt: "2026-09-11T00:00:00Z", category: "other", subcategory: null}
  let calls = 0
  const result = await prepareProductForImport(
    {product: value, config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null, normalizationCheckpoint: checkpoint},
    {resolveBrand: existingBrand, policyVersion: "p1", normalize: async () => { calls++; throw new Error("should not run") }},
  )
  assert.equal(result.status, "prepared")
  assert.equal(calls, 0)
})

test("stale checkpoint invokes Qwen and preserves a valid unchanged response", async () => {
  let calls = 0
  const result = await prepareProductForImport(
    {product: product({name: "Mystery garment", category: "other", subcategory: undefined}), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null,
      normalizationCheckpoint: {status: "unchanged", inputHash: "old", policyVersion: "p1", model: "qwen", completedAt: "2026-09-11T00:00:00Z", category: "other", subcategory: null}},
    {resolveBrand: existingBrand, policyVersion: "p1", normalize: async () => { calls++; return {category: "other", subcategory: null, model: "qwen"} }},
  )
  assert.equal(result.status, "prepared")
  assert.equal(calls, 1)
  if (result.status === "prepared") assert.equal(result.normalization.status, "unchanged")
})

test("would-create and quarantined brands never produce write payloads", async () => {
  const wouldCreate = await prepareProductForImport(
    {product: product(), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: ({brand}) => ({status: "would_create", brand})},
  )
  assert.equal(wouldCreate.status, "would_create")
  const quarantined = await prepareProductForImport(
    {product: product(), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: ({brand}) => ({status: "quarantined", brand, reason: "untrusted retailer label"})},
  )
  assert.equal(quarantined.status, "quarantined")
})

test("normalizer failures are explicit and cannot produce a payload", async () => {
  const result = await prepareProductForImport(
    {product: product({name: "Mystery garment", category: "other", subcategory: undefined}), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: existingBrand, normalize: async () => { throw new Error("timeout") }},
  )
  assert.equal(result.status, "failed")
  if (result.status === "failed") {
    assert.equal(result.error.code, "normalization_failed")
    assert.equal(result.error.retryable, true)
  }
})

test("Cafe24 detail adapter applies structured fixture pricing without mutating input", async () => {
  const source = product({pricingObservation: {state: "unknown", source: "listing", version: 2}})
  const page = {
    evaluate: async () => ({
      names: ["Cotton shirt"], priceText: "판매가 100,000원 할인판매가 80,000원",
      metaPrice: "100000", metaSalePrice: "80000", metaCurrency: "KRW",
      jsonLdPrice: "", jsonLdCurrency: "", scriptProductPrice: "", scriptSalePrice: "",
      detailPriceText: "", descFirstLine: "Cotton shirt", descText: "Cotton shirt", categoryNames: ["TOP"],
    }),
  } as unknown as Cafe24Page
  const recovered = await recoverCafe24CandidateDetailPricing(source, page,
    () => "2026-09-12T01:02:03.456Z")
  assert.equal(source.pricingObservation?.state, "unknown")
  assert.equal(recovered.pricingObservation?.state, "sale")
  assert.equal(recovered.price, 80_000)
  assert.equal(recovered.originalPrice, 100_000)
  assert.equal(recovered.detailFetchedAt, "2026-09-12T01:02:03.456Z")
})

test("detail recovery timestamp becomes the prepared observation timestamp", async () => {
  const cafe = {...config, key: "cafe", type: "cafe24" as const}
  const result = await prepareProductForImport({product: product({platform: "cafe",
    pricingObservation: {state: "unknown", source: "listing", version: 2}}), config: cafe,
    observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null}, {
    resolveBrand: existingBrand,
    recoverDetailPricing: async (value) => ({...value, detailFetchedAt: "2026-09-12T01:02:03.456Z",
      pricingObservation: {state: "regular", source: "detail", version: 2}, price: 100_000,
      originalPrice: 100_000, salePrice: null, sourcePrice: 100_000}),
  })
  assert.equal(result.status, "prepared")
  if (result.status === "prepared") {
    assert.equal(result.prepared.observed_at, "2026-09-12T01:02:03.456Z")
    assert.equal(result.prepared.product.crawled_at, "2026-09-12T01:02:03.456Z")
  }
})

test("rejects malformed Qwen responses instead of stamping unchanged", async () => {
  const result = await prepareProductForImport(
    {product: product({name: "Mystery garment", category: "other", subcategory: undefined}), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: existingBrand, normalize: async () => ({category: "invented", subcategory: null, model: ""})},
  )
  assert.equal(result.status, "failed")
  if (result.status === "failed") assert.equal(result.error.code, "normalization_schema_failed")
})

test("does not reuse forged not_required checkpoints when normalization is needed", async () => {
  const value = product({name: "Mystery garment", category: "other", subcategory: undefined})
  const hash = qwenNormalizationInputHash({productUrl: value.productUrl, name: value.name, brand: "F/ce", category: "other", subcategory: undefined, tags: undefined})
  let calls = 0
  const result = await prepareProductForImport(
    {product: value, config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null,
      normalizationCheckpoint: {status: "not_required", inputHash: hash, policyVersion: "p1", model: null, completedAt: "2026-09-11T00:00:00Z", category: "other", subcategory: null}},
    {resolveBrand: existingBrand, policyVersion: "p1", normalize: async () => { calls++; return {category: "other", subcategory: null, model: "qwen"} }},
  )
  assert.equal(result.status, "prepared")
  assert.equal(calls, 1)
})

test("rejects invalid boundary timestamps and decimal brand IDs", async () => {
  const invalidTime = await prepareProductForImport(
    {product: product(), config, observedAt: "not-a-date", expectedUpdatedAt: null},
    {resolveBrand: existingBrand},
  )
  assert.equal(invalidTime.status, "failed")
  if (invalidTime.status === "failed") assert.equal(invalidTime.error.code, "observed_at_invalid")

  const invalidBrand = await prepareProductForImport(
    {product: product(), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: () => ({status: "existing", brand: "F/ce", brandNodeId: "9007199254740992.0"})},
  )
  assert.equal(invalidBrand.status, "failed")
  if (invalidBrand.status === "failed") assert.equal(invalidBrand.error.code, "brand_node_id_invalid")
})

test("turns brand resolver exceptions into structured retryable failure", async () => {
  const result = await prepareProductForImport(
    {product: product(), config, observedAt: "2026-09-12T00:00:00Z", expectedUpdatedAt: null},
    {resolveBrand: async () => { throw new Error("database secret") }},
  )
  assert.equal(result.status, "failed")
  if (result.status === "failed") {
    assert.equal(result.error.code, "brand_resolution_failed")
    assert.equal(result.error.message, "brand resolution failed")
  }
})

test("normalization-only API reuses an existing-row checkpoint without pricing provenance", async () => {
  const input = {productUrl: "https://example.com/existing", name: "Mystery garment", brand: "House", category: "other", subcategory: null, tags: []}
  const checkpoint = {status: "unchanged" as const, inputHash: qwenNormalizationInputHash(input), policyVersion: "p1", model: "qwen", completedAt: "2026-09-12T00:00:00Z", category: "other", subcategory: null}
  let calls = 0
  const result = await normalizeProductForImport(input, checkpoint, {policyVersion: "p1", normalize: async () => { calls++; throw new Error("unexpected") }})
  assert.deepEqual(result, checkpoint)
  assert.equal(calls, 0)
})
