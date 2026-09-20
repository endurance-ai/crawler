import test from "node:test"
import assert from "node:assert/strict"

import {
  isShopifyTransientNetworkError,
  isShopifyCatalogPageLimit,
  isShopifyCatalogTruncated,
  retryAfterDelayMs,
  retryAtForRateLimit,
  shouldUseShopifyBrowserFallback,
} from "../src/lib/shopify-engine"
import {getSiteConfig} from "../src/configs/platforms"

test("Retry-After supports seconds and HTTP-date", () => {
  const now = Date.parse("2026-09-17T00:00:00Z")
  assert.equal(retryAfterDelayMs("120", now), 120_000)
  assert.equal(retryAfterDelayMs("Thu, 17 Sep 2026 00:03:00 GMT", now), 180_000)
  assert.equal(retryAfterDelayMs("invalid", now), null)
})

test("missing Retry-After schedules the batch retry 30 minutes later", () => {
  const now = Date.parse("2026-09-17T00:00:00Z")
  assert.equal(retryAtForRateLimit(null, now), "2026-09-17T00:30:00.000Z")
})

test("browser fallback is limited to rate limiting", () => {
  assert.equal(shouldUseShopifyBrowserFallback(429), true)
  assert.equal(shouldUseShopifyBrowserFallback(403), false)
  assert.equal(shouldUseShopifyBrowserFallback(404), false)
  assert.equal(shouldUseShopifyBrowserFallback(503), false)
})

test("transient direct-fetch failures can switch to the browser session", () => {
  assert.equal(isShopifyTransientNetworkError(new TypeError("fetch failed")), true)
  assert.equal(isShopifyTransientNetworkError({message: "request failed", cause: {code: "ECONNRESET"}}), true)
  assert.equal(isShopifyTransientNetworkError({name: "AbortError", message: "aborted"}), true)
  assert.equal(isShopifyTransientNetworkError(new SyntaxError("invalid JSON")), false)
  assert.equal(isShopifyTransientNetworkError(new Error("HTTP 403")), false)
})

test("Shopify's 25,000 item pagination boundary is a normal listing end", () => {
  assert.equal(isShopifyCatalogPageLimit(400, 101), true)
  assert.equal(isShopifyCatalogPageLimit(400, 100), false)
  assert.equal(isShopifyCatalogPageLimit(404, 101), false)
})

test("a full final configured page reports catalog truncation", () => {
  assert.equal(isShopifyCatalogTruncated(100, 100, 250), true)
  assert.equal(isShopifyCatalogTruncated(99, 100, 250), false)
  assert.equal(isShopifyCatalogTruncated(100, 100, 112), false)
})

test("Skims uses the canonical www host that exposes the Shopify catalog API", () => {
  assert.equal(getSiteConfig("skims")?.baseUrl, "https://www.skims.com")
})
