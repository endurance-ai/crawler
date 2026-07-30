import assert from "node:assert/strict"
import {test} from "node:test"

import {waitForCafe24ListReady} from "../src/lib/cafe24-engine"
import type {Cafe24Page} from "../src/lib/cafe24-page"

function fakePage(waitForSelector: Cafe24Page["waitForSelector"]): Cafe24Page {
  return {
    goto: async () => undefined,
    waitForTimeout: async () => {
      throw new Error("list readiness must not use a fixed sleep")
    },
    waitForSelector,
    evaluate: async () => undefined as never,
    $eval: async () => undefined as never,
    $$eval: async () => undefined as never,
    url: () => "https://example.com/category/1",
  }
}

test("Cafe24 list readiness proceeds as soon as a real product link appears", async () => {
  let timeout = 0
  let selector = ""
  const page = fakePage(async (value, options) => {
    selector = value
    timeout = options?.timeout ?? 0
    return {}
  })

  await waitForCafe24ListReady(page)

  assert.match(selector, /product/)
  assert.equal(timeout, 3000)
})

test("Cafe24 list readiness preserves the empty-page path after its bounded wait", async () => {
  const page = fakePage(async () => {
    throw new Error("timeout")
  })

  await assert.doesNotReject(() => waitForCafe24ListReady(page))
})
