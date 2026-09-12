import assert from "node:assert/strict"
import test from "node:test"
import {createClient} from "@supabase/supabase-js"

import {SupabaseRecoveryStore} from "../src/lib/pipeline-recovery-store"
import type {RecoveryCandidate} from "../src/lib/pipeline-recovery"

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {status: 200, headers: {"content-type": "application/json"}})
}

function candidate(): RecoveryCandidate {
  return {
    id: "42", platform_key: "shop", product_url: "https://shop.example/p/42", status: "ready",
    updated_at: "2026-09-12T00:00:00.123456+00:00", observation_revision: "7",
    prepared_observation_revision: "7", raw_observed_at: "2026-09-12T00:00:00Z",
    matched_brand_node_id: "9", imported_product_id: null, processing_token: null,
    processing_observation_revision: null, processing_max_age_hours: null, lease_expires_at: null,
    attempt_count: 1, last_error_code: null,
    normalization_result: {status: "succeeded", input_hash: "hash", nested: {model: "qwen"}},
    raw_product: {name: "Item"},
    enriched_product: {product: {product_url: "https://shop.example/p/42"}, normalization: {status: "succeeded"}},
    next_attempt_at: null, last_error: null,
  }
}

test("installed Supabase client serializes JSONB CAS filters as JSON text", async () => {
  let requestUrl: URL | undefined
  const fetch: typeof globalThis.fetch = async (input) => {
    requestUrl = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    return response([{id: "42"}])
  }
  const db = createClient("http://postgrest.test", "test-key", {global: {fetch}})
  const current = candidate()
  const updated = await new SupabaseRecoveryStore(db).updateCandidate(current, {status: "discovered"})
  assert.equal(updated, true)
  assert.ok(requestUrl)
  assert.equal(requestUrl.searchParams.get("normalization_result"), `eq.${JSON.stringify(current.normalization_result)}`)
  assert.equal(requestUrl.searchParams.get("enriched_product"), `eq.${JSON.stringify(current.enriched_product)}`)
  assert.equal(requestUrl.href.includes("%5Bobject+Object%5D"), false)
})

test("brand verification exhausts stable decimal-ID pages beyond PostgREST's first page", async () => {
  const firstId = 9_007_199_254_740_993n
  const brands = Array.from({length: 1001}, (_, index) => ({
    id: String(firstId + BigInt(index)), brand_name: `Brand ${index}`, brand_name_normalized: `brand-${index}`,
  }))
  const cursors: Array<string | null> = []
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    const cursorFilter = url.searchParams.get("id")
    const cursor = cursorFilter?.startsWith("gt.") ? cursorFilter.slice(3) : null
    cursors.push(cursor)
    const start = cursor === null ? 0 : brands.findIndex((brand) => brand.id === cursor) + 1
    const limit = Number(url.searchParams.get("limit") ?? 500)
    return response(brands.slice(start, start + limit))
  }
  const db = createClient("http://postgrest.test", "test-key", {global: {fetch}})
  const result = await new SupabaseRecoveryStore(db).readBrands()
  assert.equal(result.length, 1001)
  assert.equal(result[1000].id, brands[1000].id)
  assert.deepEqual(cursors, [null, brands[499].id, brands[999].id])
})
