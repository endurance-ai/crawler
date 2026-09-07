import test from "node:test"
import assert from "node:assert/strict"
import {isRefreshBatchSourceRunnable} from "../src/lib/refresh-batch"

test("batch source retry policy runs pending and partial sources below attempt limit", () => {
  assert.equal(isRefreshBatchSourceRunnable("pending", 0, 2), true)
  assert.equal(isRefreshBatchSourceRunnable("partial", 1, 2), true)
  assert.equal(isRefreshBatchSourceRunnable("running", 1, 2), true)
})

test("batch source retry policy stops terminal or exhausted sources", () => {
  assert.equal(isRefreshBatchSourceRunnable("success", 0, 2), false)
  assert.equal(isRefreshBatchSourceRunnable("exception", 0, 2), false)
  assert.equal(isRefreshBatchSourceRunnable("partial", 2, 2), false)
})
