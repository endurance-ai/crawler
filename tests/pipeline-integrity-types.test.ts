import assert from "node:assert/strict"
import test from "node:test"

import {toDecimalId} from "../src/lib/pipeline-integrity-types"
import type {ClaimedProductRefreshCandidate} from "../src/lib/pipeline-integrity-types"

test("toDecimalId preserves bigint and safe numeric IDs", () => {
  assert.equal(toDecimalId(9_007_199_254_740_993n), "9007199254740993")
  assert.equal(toDecimalId(Number.MAX_SAFE_INTEGER), "9007199254740991")
  assert.equal(toDecimalId("18446744073709551615"), "18446744073709551615")
})

test("claimed candidate exposes prepared normalization and legacy retry timestamps", () => {
  const row = {
    id: "1", platform_key: "shop", identity_key: "sku", product_url: "https://example.com/p",
    raw_product: {}, raw_observed_at: null, detected_brand: null, matched_brand_node_id: "2",
    status: "ready", observation_revision: "3", processing_token: "token",
    lease_expires_at: "2026-09-12T01:00:00Z", prepared_observation_revision: "3",
    enriched_product: null,
    normalization_result: {status: "unchanged", input_hash: "h", policy_version: "v1", model: "qwen", completed_at: "2026-09-12T00:00:00Z"},
    imported_product_id: null, attempt_count: 1, last_error_code: null,
    updated_at: "2026-09-12T00:00:00Z", last_seen_at: "2026-09-12T00:00:00Z", next_attempt_at: null,
  } satisfies ClaimedProductRefreshCandidate
  assert.equal(row.normalization_result.input_hash, "h")
})

test("toDecimalId rejects unsafe, negative, and malformed IDs", () => {
  assert.throws(() => toDecimalId(Number.MAX_SAFE_INTEGER + 1), /safe integer/)
  assert.throws(() => toDecimalId(-1), /non-negative/)
  assert.throws(() => toDecimalId("01"), /decimal string/)
  assert.throws(() => toDecimalId("1e3"), /decimal string/)
})
