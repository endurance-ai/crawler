import assert from "node:assert/strict"
import test from "node:test"

import {applyDetailCasWrite, isRetryableDetailDbError, recoverDuplicateCanonicalUrl, retryTransientDetailWrite, wasDetailWriteRecorded} from "../src/lib/detail-db-retry"

test("detail DB retry accepts transient transport and transaction failures", () => {
  for (const code of ["08006", "40001", "40P01", "53300", "57014", "PGRST000", "503", "AbortError"]) {
    assert.equal(isRetryableDetailDbError({code}), true, code)
  }
  assert.equal(isRetryableDetailDbError({message: "TypeError: fetch failed"}), true)
  assert.equal(isRetryableDetailDbError({code: "23505", message: "duplicate key"}), false)
  assert.equal(isRetryableDetailDbError({code: "23505", message: "network policy constraint"}), false)
})

test("detail write recognizes a committed update after a lost response", () => {
  assert.equal(wasDetailWriteRecorded("2026-09-23T01:23:45.123+00:00", "2026-09-23T01:23:45.123Z"), true)
  assert.equal(wasDetailWriteRecorded("2026-09-23T01:23:46Z", "2026-09-23T01:23:45Z"), false)
})

test("detail DB write retries a transient failure once and preserves the result", async () => {
  let calls = 0
  const result = await retryTransientDetailWrite(async () => {
    calls++
    return calls === 1
      ? {data: null, error: {code: "PGRST000"}}
      : {data: [{id: "1"}], error: null}
  }, async () => undefined)
  assert.equal(calls, 2)
  assert.deepEqual(result, {data: [{id: "1"}], error: null, hadTransientError: true})
})

test("detail DB write keeps permanent failures visible without retry", async () => {
  let calls = 0
  const result = await retryTransientDetailWrite(async () => {
    calls++
    return {data: null, error: {code: "23505"}}
  }, async () => undefined)
  assert.equal(calls, 1)
  assert.equal(result.error?.code, "23505")
  assert.equal(result.hadTransientError, false)
})

test("detail DB write does not hide a repeated transient failure", async () => {
  let calls = 0
  const result = await retryTransientDetailWrite(async () => {
    calls++
    throw Object.assign(new Error("fetch failed"), {code: "PGRST001"})
  }, async () => undefined)
  assert.equal(calls, 2)
  assert.equal(result.error?.code, "PGRST001")
  assert.equal(result.hadTransientError, true)
})

test("detail DB write retries an AbortSignal timeout exception", async () => {
  let calls = 0
  const result = await retryTransientDetailWrite(async () => {
    calls++
    if (calls === 1) throw new DOMException("The operation was aborted", "AbortError")
    return {data: [{id: "1"}], error: null}
  }, async () => undefined)
  assert.equal(calls, 2)
  assert.equal(result.error, null)
})

test("detail CAS write accepts a committed row after a lost response", async () => {
  const observedAt = "2026-09-23T01:23:45.123Z"
  let writes = 0
  const result = await applyDetailCasWrite(observedAt,
    async () => {
      writes++
      return writes === 1
        ? {data: null, error: {code: "PGRST000"}}
        : {data: [], error: null}
    },
    async () => ({data: {updated_at: "2026-09-23T01:23:45.123+00:00"}, error: null}),
    async () => undefined,
  )
  assert.equal(writes, 2)
  assert.deepEqual(result, {kind: "written"})
})

test("detail CAS write checks the row after repeated transient failures", async () => {
  let reads = 0
  const result = await applyDetailCasWrite("2026-09-23T01:23:45Z",
    async () => ({data: null, error: {code: "08006"}}),
    async () => {
      reads++
      return {data: {updated_at: "2026-09-23T01:23:45Z"}, error: null}
    },
    async () => undefined,
  )
  assert.equal(reads, 1)
  assert.deepEqual(result, {kind: "written"})
})

test("detail CAS write reports a genuine conflict and permanent error", async () => {
  const conflict = await applyDetailCasWrite("2026-09-23T01:23:45Z",
    async () => ({data: [], error: null}),
    async () => ({data: {updated_at: "2026-09-23T01:24:00Z"}, error: null}),
  )
  assert.deepEqual(conflict, {kind: "conflict", current: {updated_at: "2026-09-23T01:24:00Z"}})

  let reads = 0
  const failed = await applyDetailCasWrite("2026-09-23T01:23:45Z",
    async () => ({data: null, error: {code: "23505"}}),
    async () => {
      reads++
      return {data: null, error: null}
    },
  )
  assert.deepEqual(failed, {kind: "failed", code: "23505"})
  assert.equal(reads, 0)
})

test("detail DB retry does not hide unexpected programming errors", async () => {
  await assert.rejects(() => retryTransientDetailWrite(async () => {
    throw new Error("unexpected state")
  }, async () => undefined), /unexpected state/)
})

test("confirmed detail recovers when the canonical URL belongs to another product", async () => {
  let retryCalls = 0
  const patch = {product_url: "https://example.com/canonical", price: 100}
  const result = await recoverDuplicateCanonicalUrl(
    {kind: "failed", code: "23505"}, patch, "old-product",
    async () => ({data: {id: "canonical-product"}, error: null}),
    async () => { retryCalls++; assert.deepEqual(patch, {price: 100}); return {kind: "written"} },
  )
  assert.deepEqual(result, {outcome: {kind: "written"}, preservedUrl: true})
  assert.equal(retryCalls, 1)
})

test("confirmed detail retains DB failure when no competing canonical row exists", async () => {
  for (const target of [null, {id: "old-product"}]) {
    let retryCalls = 0
    const patch = {product_url: "https://example.com/canonical"}
    const result = await recoverDuplicateCanonicalUrl(
      {kind: "failed", code: "23505"}, patch, "old-product",
      async () => ({data: target, error: null}),
      async () => { retryCalls++; return {kind: "written"} },
    )
    assert.deepEqual(result, {outcome: {kind: "failed", code: "23505"}, preservedUrl: false})
    assert.equal(retryCalls, 0)
    assert.equal(patch.product_url, "https://example.com/canonical")
  }
})
