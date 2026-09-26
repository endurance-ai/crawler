import assert from "node:assert/strict"
import test from "node:test"

import {
  assessRollingDetailHealth,
  buildDetailRefreshPatch,
  buildRemovedProductPatch,
  chunkDetailFallbackPlatforms,
  combinedRefreshCoverage,
  compareOldestDetailRows,
  createRollingDetailGroupQueue,
  detailFallbackPacingMs,
  detailFallbackRecovered,
  detailRetryAt,
  detailTransientRetryDelayMs,
  isCafe24RemovedRedirect,
  isCafe24BlockedRedirect,
  isImwebExpiredStorePage,
  isImwebRemovedRedirect,
  imwebDetailFallbackUrls,
  parseZaraDomDetailPayload,
  parseStructuredDetailPayload,
  parseSixshopStorefrontResponse,
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

test("rolling detail gives sparse platforms a minimum share of attempts", () => {
  const groups = ([
    ["cafe24", 500],
    ["shopify", 400],
    ["imweb", 25],
    ["sixshop", 10],
  ] as const).map(([type, count]) => ({type, rows: Array.from({length: count}, (_, i) => i)}))
  const queue = createRollingDetailGroupQueue(groups)
  const attempted = new Map<string, number>()
  for (let i = 0; i < 100; i++) {
    const group = queue.next()!
    group.rows.shift()
    attempted.set(group.type, (attempted.get(group.type) ?? 0) + 1)
    queue.finish(group, 1)
  }
  assert.ok((attempted.get("cafe24") ?? 0) >= 48)
  assert.ok((attempted.get("shopify") ?? 0) >= 38)
  assert.ok((attempted.get("imweb") ?? 0) >= 4)
  assert.ok((attempted.get("sixshop") ?? 0) >= 4)
})

test("rolling detail rotates sources while keeping each source's oldest row first", () => {
  const groups = [
    {type: "cafe24" as const, platform: "old-source", rows: ["oldest", "next"]},
    {type: "cafe24" as const, platform: "other-source", rows: ["other-oldest", "other-next"]},
  ]
  const queue = createRollingDetailGroupQueue(groups)
  const selected: string[] = []
  for (let i = 0; i < 4; i++) {
    const group = queue.next()!
    selected.push(`${group.platform}:${group.rows.shift()}`)
    queue.finish(group, 1)
  }
  assert.deepEqual(selected, [
    "old-source:oldest", "other-source:other-oldest",
    "old-source:next", "other-source:other-next",
  ])
})

test("rolling detail leases a bounded source slice before rotating", () => {
  const groups = [
    {type: "cafe24" as const, platform: "first", rows: Array.from({length: 25}, (_, i) => i)},
    {type: "cafe24" as const, platform: "second", rows: Array.from({length: 25}, (_, i) => i)},
  ]
  const queue = createRollingDetailGroupQueue(groups)
  const first = queue.next(20)!
  assert.equal(first.platform, "first")
  first.rows.splice(0, 20)
  queue.finish(first, 20)
  const second = queue.next(20)!
  assert.equal(second.platform, "second")
  second.rows.splice(0, 20)
  queue.finish(second, 20)
  assert.equal(queue.next(20)?.platform, "first")
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

test("rolling detail distinguishes isolated retries from a failed pass", () => {
  const counts = {
    eligible_products: 3_000,
    attempted: 3_000,
    confirmed: 2_935,
    removed: 0,
    removed_recorded: 0,
    blocked: 0,
    transient: 60,
    unreadable: 0,
    db_failed: 3,
    cas_conflicts: 2,
  }
  assert.deepEqual(assessRollingDetailHealth(counts), {
    status: "degraded",
    reason: "retry_pending",
    persisted: 2_935,
    persistence_attempted: 2_940,
  })
  assert.equal(assessRollingDetailHealth({...counts, transient: 0, confirmed: 3_000, db_failed: 0, cas_conflicts: 0}).status, "success")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 100, confirmed: 75, transient: 0, db_failed: 24, cas_conflicts: 1}).reason, "db_write_rate")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 100, confirmed: 97, transient: 0, db_failed: 0, cas_conflicts: 3}).reason, "cas_conflict_rate")
})

test("rolling detail reports eligible platforms with no attempts as a coverage gap", () => {
  const counts = {
    eligible_products: 200,
    attempted: 100,
    confirmed: 100,
    removed: 0,
    removed_recorded: 0,
    blocked: 0,
    transient: 0,
    unreadable: 0,
    db_failed: 0,
    cas_conflicts: 0,
    by_type: {
      cafe24: {eligible_products: 150, attempted: 100},
      imweb: {eligible_products: 50, attempted: 0},
    },
  }
  assert.equal(assessRollingDetailHealth(counts).reason, "coverage_gap")
  assert.equal(assessRollingDetailHealth({...counts, by_type: {
    cafe24: {eligible_products: 150, attempted: 99},
    imweb: {eligible_products: 50, attempted: 1},
  }}).status, "success")
  assert.equal(assessRollingDetailHealth({...counts, db_failed: 5}).reason, "db_write_rate")
})

test("rolling detail reports no progress only when eligible work was left undone", () => {
  const counts = {
    eligible_products: 20,
    attempted: 0,
    confirmed: 0,
    removed: 0,
    removed_recorded: 0,
    blocked: 0,
    transient: 0,
    unreadable: 0,
    db_failed: 0,
    cas_conflicts: 0,
  }
  assert.equal(assessRollingDetailHealth(counts).reason, "no_progress")
  assert.equal(assessRollingDetailHealth({...counts, eligible_products: 0}).status, "success")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 10, blocked: 10}).reason, "no_progress")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 10, confirmed: 4, blocked: 6}).reason, "low_evidence")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 10, confirmed: 5, blocked: 5}).status, "degraded")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 1, blocked: 1}).status, "degraded")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 10, removed: 10, removed_recorded: 10}).status, "success")
  assert.equal(assessRollingDetailHealth({...counts, attempted: 10, removed: 10}, true).status, "success")
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

test("Cafe24 member login redirects are blocked rather than removed", () => {
  const product = "https://store.test/product/old-bag/42/"
  assert.equal(isCafe24BlockedRedirect(product, "https://store.test/member/login.html?returnUrl=%2Fproduct%2Fold-bag%2F42%2F"), true)
  assert.equal(isCafe24BlockedRedirect(product, "https://store.test/product/new-bag/43/"), false)
  assert.equal(isCafe24BlockedRedirect(product, "https://other.test/member/login.html"), false)
  assert.equal(isCafe24RemovedRedirect(product, "https://store.test/member/login.html"), false)
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

test("Sixshop gateway 404 requires storefront product evidence before removal", () => {
  const liveHtml = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Still available bag",
    offers: {"@type": "Offer", price: "49000", priceCurrency: "KRW"},
  })}</script>`
  const live = parseSixshopStorefrontResponse(200, liveHtml, "KRW")
  assert.equal(live.kind, "confirmed")
  assert.equal(live.price, 49_000)
  assert.equal(live.inStock, null)
  assert.equal(buildDetailRefreshPatch(row({in_stock: true}), live, "2026-09-26T00:00:00Z").in_stock, undefined)

  assert.equal(parseSixshopStorefrontResponse(200, "<html>Store homepage</html>", "KRW").kind, "unreadable")
  assert.equal(parseSixshopStorefrontResponse(404, "", "KRW").kind, "removed")
  assert.equal(parseSixshopStorefrontResponse(429, "", "KRW").kind, "transient")
})
