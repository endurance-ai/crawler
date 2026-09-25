import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDetailRefreshPatch,
  buildRemovedProductPatch,
  chunkDetailFallbackPlatforms,
  combinedRefreshCoverage,
  compareOldestDetailRows,
  detailFallbackPacingMs,
  detailFallbackRecovered,
  detailRetryAt,
  detailTransientRetryDelayMs,
  isCafe24RemovedRedirect,
  isImwebExpiredStorePage,
  isImwebRemovedRedirect,
  imwebDetailFallbackUrls,
  parseZaraDomDetailPayload,
  parseStructuredDetailPayload,
  parseSixshopDetailPayload,
  resolveDetailFallbackType,
  shopifyProductJsonUrl,
  sixshopProductApiUrl,
  type DetailObservation,
} from "../src/lib/refresh-detail-fallback"
import type {StructuredProductData} from "../src/lib/parsers/structured-data"
import type {RefreshableRow} from "../src/lib/listing-refresh"

function row(overrides: Partial<RefreshableRow> = {}): RefreshableRow {
  return {
    id: "1",
    product_url: "https://shop.test/products/item",
    updated_at: "2026-09-18T00:00:00Z",
    price: 10_000,
    original_price: 10_000,
    sale_price: null,
    source_price: 10_000,
    source_currency: "KRW",
    in_stock: false,
    ...overrides,
  }
}

function liveObservation(): DetailObservation {
  return {
    kind: "confirmed",
    status: 200,
    inStock: true,
    price: null,
    originalPrice: null,
    salePrice: null,
    sourceCurrency: "KRW",
  }
}

test("detail fallback cannot reactivate an unverified unisex row", () => {
  const patch = buildDetailRefreshPatch(
    row({unverified_unisex_quarantined: true}),
    liveObservation(),
    "2026-09-19T00:00:00Z",
  )
  assert.equal(patch.in_stock, false)
})

test("detail fallback can reactivate a verified row", () => {
  const patch = buildDetailRefreshPatch(row(), liveObservation(), "2026-09-19T00:00:00Z")
  assert.equal(patch.in_stock, true)
})

test("detail fallback persists a recovered canonical product URL", () => {
  const patch = buildDetailRefreshPatch(row(), {...liveObservation(), productUrl: "https://shop.test/new/?idx=1"}, "2026-09-19T00:00:00Z")
  assert.equal(patch.product_url, "https://shop.test/new/?idx=1")
})

test("a confirmed 404 or 410 check produces an out-of-stock write", () => {
  assert.deepEqual(buildRemovedProductPatch("2026-09-19T00:00:00Z"), {
    in_stock: false,
    crawled_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
  })
})

test("combined coverage counts both listing and persisted detail observations", () => {
  assert.equal(combinedRefreshCoverage(100, 25), 0.75)
  assert.equal(combinedRefreshCoverage(100, 0), 1)
  assert.equal(combinedRefreshCoverage(0, 0), 1)
  assert.equal(combinedRefreshCoverage(10, 20), 0)
  assert.throws(() => combinedRefreshCoverage(-1, 0), /non-negative/)
})

test("daily full-coverage reconciliation keeps a guard until every product is observed", () => {
  assert.equal(detailFallbackRecovered(100, 0, 1), true)
  assert.equal(detailFallbackRecovered(100, 1, 1), false)
  assert.equal(detailFallbackRecovered(100, 30, 0.7), true)
  assert.throws(() => detailFallbackRecovered(100, 0, 1.01), /between 0 and 1/)
})

test("detail fallback platform filters stay below the PostgREST URL budget", () => {
  const chunks = chunkDetailFallbackPlatforms([
    "short-a",
    "short-b",
    "medium-key",
  ], 15)

  assert.deepEqual(chunks, [
    ["short-a", "short-b"],
    ["medium-key"],
  ])
  assert.deepEqual(chunkDetailFallbackPlatforms([], 15), [])
  assert.throws(() => chunkDetailFallbackPlatforms(["too-long"], 3), /exceeds URL budget/)
})

test("detail fallback prefers the current platform type over a stale batch snapshot", () => {
  assert.equal(resolveDetailFallbackType("imweb", "cafe24"), "cafe24")
  assert.equal(resolveDetailFallbackType("shopify", "custom"), "shopify")
  assert.equal(resolveDetailFallbackType("custom", "structured"), null)
})

test("rolling detail checks the least recently verified product first", () => {
  const neverChecked = row({id: "1", last_seen_at: null, crawled_at: null})
  const checkedYesterday = row({id: "2", last_seen_at: "2026-09-18T00:00:00Z", crawled_at: "2026-09-19T00:00:00Z"})
  const checkedToday = row({id: "3", last_seen_at: "2026-09-20T00:00:00Z", crawled_at: "2026-09-18T00:00:00Z"})
  assert.deepEqual([checkedToday, neverChecked, checkedYesterday].sort(compareOldestDetailRows).map((item) => item.id), ["1", "2", "3"])
})

test("rolling detail cooldowns defer failures without delaying confirmed checks", () => {
  const now = Date.parse("2026-09-25T00:00:00Z")
  assert.equal(detailRetryAt("confirmed", now), null)
  assert.equal(detailRetryAt("removed", now), null)
  assert.equal(detailRetryAt("transient", now), "2026-09-25T00:30:00.000Z")
  assert.equal(detailRetryAt("db_failed", now), "2026-09-25T01:00:00.000Z")
  assert.equal(detailRetryAt("unreadable", now), "2026-09-26T00:00:00.000Z")
  assert.equal(detailRetryAt("transient", now, "2026-09-25T02:00:00Z"), "2026-09-25T02:00:00.000Z")
})

test("Imweb detail fallback uses conservative pacing and bounded transient backoff", () => {
  assert.equal(detailFallbackPacingMs("imweb", undefined), 1_200)
  assert.equal(detailFallbackPacingMs("sixshop", undefined), 500)
  assert.equal(detailFallbackPacingMs("imweb", 2_000), 2_000)
  assert.equal(detailTransientRetryDelayMs(0), 1_000)
  assert.equal(detailTransientRetryDelayMs(1), 3_000)
  assert.equal(detailTransientRetryDelayMs(2), null)
})

test("Imweb's HTTP 200 hosting-expired tombstone is a confirmed store removal", () => {
  assert.equal(isImwebExpiredStorePage(`
    <main>
      <h1>사이트 기간 만료</h1>
      <p>현재 접속하신 사이트의 호스팅 기간이 만료되었습니다.</p>
    </main>
  `), true)
  assert.equal(isImwebExpiredStorePage("<h1>사이트 점검 중입니다</h1>"), false)
})

test("Imweb's same-host homepage redirect is a removed idx product", () => {
  assert.equal(
    isImwebRemovedRedirect("https://heretic.kr/198/?idx=353", "https://heretic.kr/"),
    true,
  )
  assert.equal(
    isImwebRemovedRedirect("https://heretic.kr/198/?idx=353", "https://heretic.kr/SHOP/?idx=353"),
    false,
  )
  assert.equal(isImwebRemovedRedirect("https://heretic.kr/198/", "https://heretic.kr/"), false)
  assert.equal(
    isImwebRemovedRedirect("https://heretic.kr/198/?idx=353", "https://other.test/"),
    false,
  )
})

test("Imweb detail fallback keeps idx while moving to a current same-host category", () => {
  assert.deepEqual(imwebDetailFallbackUrls(
    "https://heretic.kr/203/?idx=399",
    ["https://heretic.kr/198/", "https://other.test/198/"],
  ), ["https://heretic.kr/198/?idx=399"])
})

test("Cafe24's same-host HTTP 200 tombstones are treated as removed products", () => {
  const product = "https://margesherwood.com/product/old-bag/4634/category/66/display/1/"
  assert.equal(isCafe24RemovedRedirect(product, "https://margesherwood.com/404.html"), true)
  assert.equal(isCafe24RemovedRedirect(product, "https://margesherwood.com/"), true)
  assert.equal(isCafe24RemovedRedirect(product, "https://margesherwood.com/index.html"), true)
  assert.equal(isCafe24RemovedRedirect(product, "https://www.margesherwood.com/product/new-bag/5000/"), false)
  assert.equal(isCafe24RemovedRedirect(product, "https://other-shop.test/404.html"), false)
})

test("Zara DOM fallback refreshes both restocked and sold-out products without JSON-LD", () => {
  assert.deepEqual(parseZaraDomDetailPayload({
    currentPrice: "79900",
    currency: "KRW",
    hasAddToCart: true,
    productText: "장바구니에 담기 추가하기",
  }, "KRW"), {
    kind: "confirmed",
    status: 200,
    inStock: true,
    price: 79_900,
    originalPrice: null,
    salePrice: null,
    sourceCurrency: "KRW",
    pricingState: "unknown",
  })
  assert.deepEqual(parseZaraDomDetailPayload({
    currentPrice: "129.00",
    currency: "USD",
    hasAddToCart: false,
    productText: "VIEW SIMILAR\nOUT OF STOCK",
  }, "USD")?.inStock, false)
  assert.equal(parseZaraDomDetailPayload({
    currentPrice: null,
    currency: null,
    hasAddToCart: false,
    productText: "Loading",
  }, "USD"), null)
})

test("Shopify detail URL accepts SKU-prefixed handles containing underscores", () => {
  assert.equal(
    shopifyProductJsonUrl("https://rodo.it/products/clutch_b088280832013700930127_clutch-midollino-fibbia"),
    "https://rodo.it/products/clutch_b088280832013700930127_clutch-midollino-fibbia.js",
  )
  assert.equal(
    shopifyProductJsonUrl("https://rodo.it/products/_b085470401231_clutch_raso-tube-plus-clutch"),
    "https://rodo.it/products/_b085470401231_clutch_raso-tube-plus-clutch.js",
  )
  assert.equal(shopifyProductJsonUrl("https://shop.test/products/not/a-handle"), null)
})

test("structured detail evidence can reactivate an Imweb product without guessing sale state", () => {
  const observation = parseStructuredDetailPayload({
    name: "Restocked jacket",
    description: null,
    brand: "AUBOUR",
    price: 118_000,
    currency: "KRW",
    images: [],
    inStock: true,
    color: null,
    sku: null,
    url: null,
    source: "jsonld",
  } satisfies StructuredProductData, "KRW")
  assert.deepEqual(observation, {
    kind: "confirmed",
    status: 200,
    inStock: true,
    price: 118_000,
    originalPrice: null,
    salePrice: null,
    sourceCurrency: "KRW",
    pricingState: "unknown",
  })
})

test("Sixshop detail API URL and payload preserve exact stock and sale state", () => {
  assert.equal(
    sixshopProductApiUrl("https://yinandyang.co.kr/products/pjbega4bdqsa"),
    "https://sf-gateway.sixshop.io/website/guest/products/pjbega4bdqsa",
  )
  assert.equal(sixshopProductApiUrl("https://yinandyang.co.kr/about"), null)
  assert.deepEqual(parseSixshopDetailPayload({
    name: "Frill top",
    status: "active",
    displayStatus: "active",
    isOutOfStock: false,
    price: {original: 118_000, sale: 98_000},
  }, "KRW"), {
    kind: "confirmed",
    status: 200,
    inStock: true,
    price: 98_000,
    originalPrice: 118_000,
    salePrice: 98_000,
    sourceCurrency: "KRW",
    pricingState: "sale",
  })
})
