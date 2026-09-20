import test from "node:test"
import assert from "node:assert/strict"
import {classifyRefreshException, isRefreshBatchSourceRunnable, retryAtFromErrors} from "../src/lib/refresh-batch"

test("batch source retry policy runs pending and partial sources below attempt limit", () => {
  assert.equal(isRefreshBatchSourceRunnable("pending", 0, 2), true)
  assert.equal(isRefreshBatchSourceRunnable("partial", 20, 2), true)
  assert.equal(isRefreshBatchSourceRunnable("running", 2, 2), true)
})

test("retry_at metadata is parsed without changing the error taxonomy", () => {
  assert.equal(
    retryAtFromErrors(["HTTP 429 on page 1 retry_at=2026-09-17T03:00:00.000Z"]),
    "2026-09-17T03:00:00.000Z",
  )
})

test("batch source retry policy stops terminal or exhausted sources", () => {
  assert.equal(isRefreshBatchSourceRunnable("success", 0, 2), false)
  assert.equal(isRefreshBatchSourceRunnable("exception", 0, 2), false)
  assert.equal(isRefreshBatchSourceRunnable("exception", 2, 2, "transient_exhausted"), false)
  assert.equal(isRefreshBatchSourceRunnable("exception", 0, 2, "external_block"), false)
})

test("batch source retry policy retries only transient exceptions", () => {
  assert.equal(isRefreshBatchSourceRunnable("exception", 0, 2, "transient_exhausted"), true)
  assert.equal(isRefreshBatchSourceRunnable("exception", 1, 2, "db_write_exhausted"), true)
  assert.equal(isRefreshBatchSourceRunnable("exception", 1, 2, "db_write_failed"), false)
  assert.equal(isRefreshBatchSourceRunnable("exception", 1, 2, "db_read_failed"), true)
  assert.equal(isRefreshBatchSourceRunnable("exception", 0, 2, "coverage_guard"), false)
  assert.equal(
    isRefreshBatchSourceRunnable(
      "exception",
      1,
      2,
      "external_block",
      "[robots-block] robots.txt fetch failed: AbortError",
    ),
    true,
  )
})

test("failure taxonomy separates access, DB, and coverage failures", () => {
  assert.equal(classifyRefreshException({status: "failed", errors: ["category URL HTTP 403"], unreachable: []}), "external_block")
  assert.equal(
    classifyRefreshException({
      status: "failed",
      errors: ["[robots-block] robots.txt fetch failed: AbortError"],
      unreachable: [],
    }),
    "transient_exhausted",
  )
  assert.equal(classifyRefreshException({status: "failed", errors: ["HTTP 429 on page 1"], unreachable: []}), "transient_exhausted")
  assert.equal(classifyRefreshException({status: "failed", errors: [], unreachable: [], dbWriteFailed: true}), "db_write_failed")
  assert.equal(classifyRefreshException({status: "skipped", errors: [], unreachable: [], coverageGuard: true}), "coverage_guard")
})
