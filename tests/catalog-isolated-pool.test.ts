import assert from "node:assert/strict"
import test from "node:test"

import {runIsolatedPool} from "../src/lib/catalog/isolated-pool"

test("one product failure does not stop other catalog products", async () => {
  const completed: number[] = []
  const failures = await runIsolatedPool([1, 2, 3], 2, async (id) => {
    if (id === 2) throw new Error("bad image")
    completed.push(id)
  })
  assert.deepEqual(completed.sort(), [1, 3])
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.item, 2)
})
