/**
 * `detectShopifyActiveCurrency` retry behaviour.
 *
 * Split from shopify-currency.test.ts because these assert the failure
 * envelope rather than the happy path. A transient timeout here silently
 * reverts the crawl to "trust config.sourceCurrency", which is the exact
 * behaviour that produced the 2026-08 currency incident — so one flaky
 * request must not switch the safety net off.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {detectShopifyActiveCurrency} from "../src/lib/shopify-engine"

function bootstrap(active: string): string {
  return `Shopify.currency = {"active":"${active}","rate":"1356.77"};`
}

test("a transient failure is retried once and can still succeed", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    if (calls === 1) throw new Error("TimeoutError")
    return {ok: true, status: 200, text: async () => bootstrap("KRW")}
  }) as unknown as typeof fetch

  assert.equal(await detectShopifyActiveCurrency("https://slamjam.com", "KR", fetchImpl), "KRW")
  assert.equal(calls, 2)
})

test("two consecutive failures give up and return null", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    throw new Error("TimeoutError")
  }) as unknown as typeof fetch

  assert.equal(await detectShopifyActiveCurrency("https://slamjam.com", "KR", fetchImpl), null)
  assert.equal(calls, 2, "must not retry forever")
})

test("a store with no bootstrap is not retried — the answer will not change", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    return {ok: true, status: 200, text: async () => "<html>plain page</html>"}
  }) as unknown as typeof fetch

  assert.equal(await detectShopifyActiveCurrency("https://x.com", "KR", fetchImpl), null)
  assert.equal(calls, 1)
})

test("an HTTP error is not retried either", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    return {ok: false, status: 403, text: async () => ""}
  }) as unknown as typeof fetch

  assert.equal(await detectShopifyActiveCurrency("https://x.com", "KR", fetchImpl), null)
  assert.equal(calls, 1)
})
