import assert from "node:assert/strict"
import {test} from "node:test"

import {runAsyncPool} from "../src/lib/async-pool"

test("runAsyncPool processes every item once without exceeding concurrency", async () => {
  const seen: number[] = []
  let active = 0
  let peak = 0

  await runAsyncPool([1, 2, 3, 4, 5], 2, async (item) => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    seen.push(item)
    active--
  })

  assert.equal(peak, 2)
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5])
})

test("runAsyncPool stops claiming new work when shouldStart closes the gate", async () => {
  const seen: number[] = []
  let claims = 0

  await runAsyncPool(
    [1, 2, 3, 4],
    2,
    async (item) => {
      seen.push(item)
    },
    () => claims++ < 2,
  )

  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2])
})
