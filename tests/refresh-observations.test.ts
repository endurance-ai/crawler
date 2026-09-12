import assert from "node:assert/strict"
import {test} from "node:test"
import {enqueueRefreshCandidates, type ProductRefreshClient} from "../src/lib/product-refresh"
import {buildRefreshCandidateInputs, candidateIdentity} from "../src/lib/refresh-source"
import type {Product, SiteConfig} from "../src/lib/types"

const config: SiteConfig = {key: "test", name: "Test", baseUrl: "https://test.example", type: "shopify", multiBrand: true}
const brands = [{id: 5, brand_name: "Brand", brand_name_normalized: "brand"}]
const product = (url = "https://test.example/products/one"): Product => ({
  brand: "Brand", name: "Cotton shirt", category: "tops", subcategory: "shirt", gender: ["unisex"],
  productUrl: url, imageUrl: "https://test.example/one.jpg", platform: "test", inStock: true,
  price: 10000, originalPrice: 10000, salePrice: null, priceFormatted: "₩10,000",
  pricingObservation: {state: "regular", source: "listing", version: 2}, crawledAt: "2026-09-12T01:00:00Z",
})
const outcome = {inserted: 0, updated: 1, unchanged: 0, stale: 0, conflicted: 0, rematched: 1}

test("observation RPC carries real source timestamps/string IDs and reports actual results", async () => {
  const calls: Array<{name: string; args: unknown}> = []
  const db = {rpc: (name: string, args: unknown) => {
    calls.push({name, args})
    return {abortSignal: async () => ({data: outcome, error: null})}
  }} as unknown as ProductRefreshClient
  const result = await enqueueRefreshCandidates(db, {products: [product()], config, brands})
  assert.deepEqual(result, {...outcome, brandUnmatched: 0})
  assert.equal(result.inserted, 0)
  const row = (calls[0].args as {p_rows: Array<Record<string, unknown>>}).p_rows[0]
  assert.equal(calls[0].name, "upsert_product_refresh_observations")
  assert.equal(row.raw_observed_at, "2026-09-12T01:00:00Z")
  assert.equal(row.matched_brand_node_id, "5")
  assert.equal("status" in row, false)
  assert.deepEqual(row.raw_product, product())
})

test("missing observation time remains unknown and unsafe numeric brand IDs fail closed", () => {
  const rows = buildRefreshCandidateInputs([{productUrl: product().productUrl, brand: "Brand"}], config, brands)
  assert.equal(rows[0].raw_observed_at, null)
  assert.throws(() => buildRefreshCandidateInputs([{productUrl: product().productUrl, brand: "Brand"}], config, [{...brands[0], id: Number.MAX_SAFE_INTEGER + 1}]), /safe integer/)
})

test("unfinished known-product candidates are refreshed without enqueuing all existing products", async () => {
  const pending = product("https://test.example/products/pending")
  const unrelated = product("https://test.example/products/existing")
  let sent: Product[] = []
  const query: Record<string, unknown> = {}
  for (const method of ["select", "eq", "not", "gt", "order", "limit"]) query[method] = () => query
  query.abortSignal = async () => ({data: [{id: "9", identity_key: candidateIdentity(config.key, pending.productUrl)}], error: null})
  const db = {
    from: () => query,
    rpc: (_name: string, args: {p_rows: Array<{raw_product: Product}>}) => {
      sent = args.p_rows.map((row) => row.raw_product)
      return {abortSignal: async () => ({data: {...outcome, inserted: 1}, error: null})}
    },
  } as unknown as ProductRefreshClient
  await enqueueRefreshCandidates(db, {products: [product(), pending, unrelated], unknownUrls: [product().productUrl], config, brands})
  assert.deepEqual(sent.map((value) => value.productUrl), [product().productUrl, pending.productUrl])
})

test("RPC errors and malformed accounting never become successful observation writes", async () => {
  for (const response of [{data: null, error: {message: "secret"}}, {data: {inserted: 1}, error: null},
    {data: {inserted: 0, updated: 0, unchanged: 0, stale: 0, conflicted: 0, rematched: 0}, error: null}]) {
    const db = {rpc: () => ({abortSignal: async () => response})} as unknown as ProductRefreshClient
    await assert.rejects(enqueueRefreshCandidates(db, {products: [product()], config, brands}), /observation/)
  }
})
