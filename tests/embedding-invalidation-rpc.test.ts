import assert from "node:assert/strict"
import test from "node:test"
import {invalidateStaleProductEmbeddings} from "../src/lib/embedding-invalidation-rpc"

test("embedding invalidation sends decimal strings and accepts a complete ordered reply", async () => {
  let args: Record<string, unknown> | undefined
  const db = {rpc(_name: string, value: Record<string, unknown>) { args = value; return Promise.resolve({
    data: [{id: "42", outcome: "current"}, {id: "9007199254740993", outcome: "invalidated"}], error: null}) }}
  const result = await invalidateStaleProductEmbeddings(db, [42, 9007199254740993n])
  assert.deepEqual(args, {p_product_ids: ["42", "9007199254740993"]})
  assert.deepEqual(result.map((row) => row.outcome), ["current", "invalidated"])
})

test("embedding invalidation rejects missing, reordered, duplicate, and unknown outcomes", async () => {
  const db = (data: unknown) => ({rpc() { return Promise.resolve({data, error: null}) }})
  await assert.rejects(invalidateStaleProductEmbeddings(db([]), ["42"]), /invalid response/)
  await assert.rejects(invalidateStaleProductEmbeddings(db([
    {id: "43", outcome: "current"}, {id: "42", outcome: "current"},
  ]), ["42", "43"]), /invalid response/)
  await assert.rejects(invalidateStaleProductEmbeddings(db([{id: "42", outcome: "deleted"}]), ["42"]),
    /invalid response/)
  await assert.rejects(invalidateStaleProductEmbeddings(db([]), ["42", "42"]), /unique/)
})
