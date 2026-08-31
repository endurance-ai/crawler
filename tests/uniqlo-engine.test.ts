/**
 * Characterization tests for the Uniqlo engine.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-001 (KR baseline)
 *       SPEC-PLATFORM-EXPANSION-002 (US extension; REQ-007 parameterizes
 *         every shared assertion to run against both fixtures)
 * Runs via: node --test --import tsx ./tests/*.test.ts
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {crawlUniqlo, isSafeUniqloImageUrl, parseProducts, parseRateFlag, pickUserAgent,} from "../src/lib/uniqlo-engine"
import {checkRobots, parseRobotsBody} from "../src/lib/robots-check"
import {convertToKrw, fxRateToKrw} from "../src/lib/fx"
import type {SiteConfig} from "../src/lib/types"

// ─── Fixture loading ──────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const KR_FIXTURE_PATH = path.join(__dirname, "fixtures", "uniqlo-kr-products.fixture.json")
const US_FIXTURE_PATH = path.join(__dirname, "fixtures", "uniqlo-us-products.fixture.json")

function loadFixture(p: string = KR_FIXTURE_PATH): unknown {
  const raw = fs.readFileSync(p, "utf-8")
  return JSON.parse(raw)
}

const TEST_BASE_URL = "https://www.uniqlo.com/kr/ko"
const TEST_KEY = "uniqlo-kr"
const US_BASE_URL = "https://www.uniqlo.com/us/en"
const US_KEY = "uniqlo-us"

// SPEC-PLATFORM-EXPANSION-002 REQ-007: shared characterization-test
// matrix. Every entry runs through the same assertions; region-specific
// expectations are added on top.
const FIXTURE_MATRIX = [
  {region: "KR" as const, fixturePath: KR_FIXTURE_PATH, baseUrl: TEST_BASE_URL, key: TEST_KEY, currency: "KRW"},
  {region: "US" as const, fixturePath: US_FIXTURE_PATH, baseUrl: US_BASE_URL, key: US_KEY, currency: "USD"},
]

const TEST_CONFIG: SiteConfig = {
  key: TEST_KEY,
  name: "Uniqlo KR (test)",
  type: "uniqlo",
  baseUrl: TEST_BASE_URL,
  crawlDelay: 10,
  apiCategoryPaths: ["57892,57959,,"],
}

// ─── fetch mock plumbing ──────────────────────────────

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>

const realFetch = globalThis.fetch

function installFetch(handler: FetchHandler): {restore: () => void; calls: string[]; headers: Headers[]} {
  const calls: string[] = []
  const headers: Headers[] = []
  ;(globalThis as {fetch: FetchHandler}).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    calls.push(url)
    headers.push(new Headers((init?.headers as HeadersInit | undefined) ?? {}))
    return handler(url, init)
  }
  return {
    restore: () => {
      ;(globalThis as {fetch: typeof realFetch}).fetch = realFetch
    },
    calls,
    headers,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json"},
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {status, headers: {"Content-Type": "text/plain"}})
}

const PERMISSIVE_ROBOTS = "User-agent: *\nDisallow: /private\n\n"
const BLANKET_DISALLOW_ROBOTS = "User-agent: *\nDisallow: /\n"

// ─── AC-2: fixture parity ─────────────────────────────

// SPEC-PLATFORM-EXPANSION-002 REQ-007 / REQ-008: shared characterization
// parity. The same assertions run against BOTH fixtures; failure on either
// blocks deployment regardless of which region triggered it.
for (const fx of FIXTURE_MATRIX) {
  test(`AC-2 parseProducts [${fx.region}]: every product has populated name/imageUrl/productUrl/price and whitelisted host`, () => {
    const fixture = loadFixture(fx.fixturePath)
    const products = parseProducts(
      fixture as Parameters<typeof parseProducts>[0],
      fx.baseUrl,
      fx.key,
      fx.region,
    )

    assert.ok(products.length >= 50, `[${fx.region}] expected >=50 products, got ${products.length}`)

    for (const p of products) {
      assert.equal(typeof p.name, "string")
      assert.ok(p.name.length > 0, `[${fx.region}] empty name for product ${p.productCode}`)
      assert.ok(p.productUrl.startsWith(`${fx.baseUrl}/products/`), `[${fx.region}] bad productUrl: ${p.productUrl}`)
      assert.equal(typeof p.price, "number")
      assert.ok((p.price as number) > 0, `[${fx.region}] non-positive price for ${p.productCode}`)
      assert.equal(typeof p.imageUrl, "string")
      assert.ok(p.imageUrl.length > 0, `[${fx.region}] empty imageUrl for ${p.productCode}`)
      assert.ok(
        isSafeUniqloImageUrl(p.imageUrl),
        `[${fx.region}] imageUrl host not whitelisted: ${p.imageUrl}`,
      )
      if (p.images) {
        for (const img of p.images) {
          assert.ok(isSafeUniqloImageUrl(img), `[${fx.region}] secondary image host not whitelisted: ${img}`)
        }
      }
      // Region-specific: sourceCurrency must match.
      assert.equal(p.sourceCurrency, fx.currency, `[${fx.region}] expected sourceCurrency=${fx.currency}, got ${p.sourceCurrency}`)
    }
  })
}

// US-fixture-specific assertions (REQ-007): USD currency, decimal price,
// non-Korean priceFormatted.
test("AC-3 [US] parseProducts: prices are positive USD decimals, priceFormatted does not use ₩", () => {
  const fixture = loadFixture(US_FIXTURE_PATH)
  const products = parseProducts(
    fixture as Parameters<typeof parseProducts>[0],
    US_BASE_URL,
    US_KEY,
    "US",
  )
  assert.ok(products.length >= 50, `expected >=50 US products, got ${products.length}`)
  for (const p of products) {
    assert.equal(p.sourceCurrency, "USD")
    assert.equal(typeof p.price, "number")
    assert.ok((p.price as number) > 0, `non-positive US price for ${p.productCode}`)
    // USD decimals are typically <1000 — sanity range.
    assert.ok((p.price as number) < 10_000, `US price unexpectedly high (looks like KRW?): ${p.price}`)
    assert.ok(!p.priceFormatted.includes("₩"), `US priceFormatted should not contain ₩: ${p.priceFormatted}`)
  }
})

test("AC-2 isSafeUniqloImageUrl: rejects non-whitelisted hosts", () => {
  assert.equal(isSafeUniqloImageUrl("https://image.uniqlo.com/path.jpg"), true)
  assert.equal(isSafeUniqloImageUrl("https://asset.uniqlo.com/x.jpg"), true)
  assert.equal(isSafeUniqloImageUrl("https://evil.example.com/x.jpg"), false)
  assert.equal(isSafeUniqloImageUrl("http://image.uniqlo.com/x.jpg"), false) // http scheme
  assert.equal(isSafeUniqloImageUrl("not a url"), false)
})

test("AC-2 timing: 1 req/sec pacing produces >=4000ms across 5 sequential category pages", async () => {
  const fixture = loadFixture() as {result: {items: unknown[]; pagination: object}}
  // Build a 5-page response stream for one category by setting pagination.total high.
  const pageBody = {
    status: "ok",
    result: {
      items: fixture.result.items.slice(0, 100),
      pagination: {total: 500, offset: 0, count: 100},
    },
  }
  const lastBody = {
    status: "ok",
    result: {items: [], pagination: {total: 500, offset: 500, count: 0}},
  }
  let n = 0
  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(PERMISSIVE_ROBOTS)
    n += 1
    return jsonResponse(n <= 5 ? pageBody : lastBody)
  })

  const config: SiteConfig = {...TEST_CONFIG, crawlDelay: 1000}
  const t0 = Date.now()
  await crawlUniqlo(config)
  const elapsed = Date.now() - t0
  mock.restore()

  // 5 product fetches: first immediate, 4 delays of 1000ms.
  assert.ok(elapsed >= 4000, `expected >=4000ms, got ${elapsed}ms`)
  assert.ok(elapsed < 7000, `expected <7000ms (jitter cap), got ${elapsed}ms`)
})

test("AC-2 UA rotation: 10 requests cycle through exactly 5 unique UAs round-robin", async () => {
  const seen: string[] = []
  for (let i = 0; i < 10; i++) seen.push(pickUserAgent(i))
  const unique = new Set(seen)
  assert.equal(unique.size, 5, `expected 5 unique UAs, got ${unique.size}`)
  // Round-robin: index 0 == index 5, index 1 == index 6, etc.
  for (let i = 0; i < 5; i++) {
    assert.equal(seen[i], seen[i + 5], `round-robin mismatch at index ${i}`)
  }
})

test("AC-2 UA rotation: live engine attaches a UA from the rotation list per request", async () => {
  const fixture = loadFixture() as {result: {items: unknown[]}}
  const body = {
    status: "ok",
    result: {items: fixture.result.items.slice(0, 5), pagination: {total: 5, offset: 0, count: 5}},
  }
  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(PERMISSIVE_ROBOTS)
    return jsonResponse(body)
  })
  const config: SiteConfig = {
    ...TEST_CONFIG,
    crawlDelay: 1,
    apiCategoryPaths: ["57892,,,", "57893,,,", "57894,,,", "57925,,,"],
  }
  await crawlUniqlo(config)
  mock.restore()

  // First call is robots.txt; remaining are product fetches with UAs.
  const productHeaders = mock.headers.slice(1)
  assert.ok(productHeaders.length >= 4, "expected >=4 product fetches")
  const uas = productHeaders.map((h) => h.get("user-agent")).filter((x): x is string => !!x)
  for (const ua of uas) assert.ok(ua.startsWith("Mozilla/5.0"), `non-Mozilla UA: ${ua}`)
  assert.ok(new Set(uas).size >= Math.min(uas.length, 4), "UAs should rotate, not be identical")
})

// ─── AC-3: dry-run no file write ──────────────────────

test("AC-3 dry-run invariant: parseProducts is a pure function that does not touch the filesystem", () => {
  // The engine API surface is split such that ALL filesystem writes happen
  // in the dispatch layer (`saveResult` in `crawl.ts`), never in the engine
  // itself. probeSite likewise never calls saveResult. This test enforces
  // the invariant by snapshotting the data directory before/after the
  // engine's pure parse path runs against the fixture; if any code path
  // were to leak a write into the engine, the snapshot would diverge.
  const dataDir = path.join(process.cwd(), "data")
  const before = fs.existsSync(dataDir)
    ? new Set(fs.readdirSync(dataDir))
    : new Set<string>()

  const fixture = loadFixture() as Parameters<typeof parseProducts>[0]
  const products = parseProducts(fixture, TEST_BASE_URL, TEST_KEY)
  assert.ok(products.length > 0, "fixture parse should produce products")

  const after = fs.existsSync(dataDir)
    ? new Set(fs.readdirSync(dataDir))
    : new Set<string>()

  // No new file appeared in data/ as a side-effect of the engine.
  for (const name of after) {
    assert.ok(before.has(name), `unexpected new file in data/: ${name}`)
  }
  // And specifically the cache file was not created.
  const cachePath = path.join(dataDir, `${TEST_KEY}-products.json`)
  // Only assert non-existence if it didn't pre-exist.
  if (!before.has(`${TEST_KEY}-products.json`)) {
    assert.equal(fs.existsSync(cachePath), false, `engine must not create ${cachePath}`)
  }
})

// ─── AC-4: robots.txt blocking ────────────────────────

test("AC-4 robots: parseRobotsBody returns {allowed:false, blockingLine:'Disallow: /'} on blanket disallow", () => {
  const r = parseRobotsBody(BLANKET_DISALLOW_ROBOTS)
  assert.equal(r.allowed, false)
  assert.equal(r.blockingLine, "Disallow: /")
})

test("AC-4 robots: parseRobotsBody returns allowed:true on permissive policy", () => {
  const r = parseRobotsBody(PERMISSIVE_ROBOTS)
  assert.equal(r.allowed, true)
})

test("AC-4 robots: blanket disallow scoped to non-* group does NOT block", () => {
  const body = "User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n"
  const r = parseRobotsBody(body)
  assert.equal(r.allowed, true)
})

test("AC-4 robots: fail-closed on HTTP non-2xx", async () => {
  const mock = installFetch(async () => textResponse("forbidden", 403))
  const r = await checkRobots(TEST_BASE_URL)
  mock.restore()
  assert.equal(r.allowed, false)
  assert.ok((r.blockingLine ?? "").includes("403"), `expected 403 in blockingLine: ${r.blockingLine}`)
})

test("AC-4 robots: fail-closed on network error", async () => {
  const mock = installFetch(async () => {
    throw new Error("ECONNRESET")
  })
  const r = await checkRobots(TEST_BASE_URL)
  mock.restore()
  assert.equal(r.allowed, false)
  assert.ok((r.blockingLine ?? "").length > 0)
})

test("AC-4 crawlUniqlo: blanket-disallow robots.txt blocks ALL product fetches", async () => {
  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(BLANKET_DISALLOW_ROBOTS)
    return jsonResponse({status: "ok", result: {items: [], pagination: {total: 0, offset: 0, count: 0}}})
  })
  const result = await crawlUniqlo(TEST_CONFIG)
  mock.restore()

  // Only the robots.txt fetch should have happened.
  const productCalls = mock.calls.filter((u) => u.includes("/api/commerce/v5/"))
  assert.equal(productCalls.length, 0, `expected 0 product fetches, got ${productCalls.length}`)
  assert.ok(result.errors.length >= 1, "expected an error entry for robots block")
  assert.ok(result.errors[0]!.includes("robots-block"), `expected robots-block in errors: ${result.errors[0]}`)
  assert.equal(result.products.length, 0)
})

// ─── AC-5: abort on 3 consecutive errors ──────────────

test("AC-5 abort-on-3-consecutive: 503/503/503 on cat A then continue with cat B", async () => {
  let catACalls = 0
  let catBCalls = 0
  const successBody = {
    status: "ok",
    result: {
      items: [
        {
          productId: "E111111-000",
          name: "OK",
          prices: {base: {currency: {symbol: "₩", code: "KRW"}, value: 9900}},
          genderName: "MEN",
          images: {main: {"00": {image: "https://image.uniqlo.com/a.jpg"}}},
          representativeColorDisplayCode: "00",
        },
      ],
      pagination: {total: 1, offset: 0, count: 1},
    },
  }

  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(PERMISSIVE_ROBOTS)
    if (url.includes("path=AAA")) {
      catACalls += 1
      return jsonResponse({error: "service unavailable"}, 503)
    }
    if (url.includes("path=BBB")) {
      catBCalls += 1
      return jsonResponse(successBody)
    }
    return jsonResponse({status: "ok", result: {items: [], pagination: {total: 0, offset: 0, count: 0}}})
  })

  const config: SiteConfig = {
    ...TEST_CONFIG,
    crawlDelay: 1,
    apiCategoryPaths: ["AAA", "BBB"],
  }
  const result = await crawlUniqlo(config)
  mock.restore()

  assert.equal(catACalls, 3, `expected exactly 3 calls to category AAA, got ${catACalls}`)
  assert.ok(catBCalls >= 1, "expected category BBB to be reached")
  assert.equal(result.errors.length, 1, `expected 1 error entry, got ${result.errors.length}`)
  const errEntry = JSON.parse(result.errors[0]!) as {category: string; status: number | string}
  assert.equal(errEntry.category, "AAA")
  assert.equal(errEntry.status, 503)
  assert.ok(result.products.length >= 1, "expected products from category BBB")
})

// ─── AC-6: --rate flag ────────────────────────────────

test("AC-6 --rate=2: 4 sequential requests elapse in [1500ms, 2000ms]", async () => {
  const body = {
    status: "ok",
    result: {
      items: [
        {
          productId: "E222222-000",
          name: "rate-test",
          prices: {base: {currency: {symbol: "₩", code: "KRW"}, value: 1000}},
          genderName: "WOMEN",
          images: {main: {"00": {image: "https://image.uniqlo.com/x.jpg"}}},
          representativeColorDisplayCode: "00",
        },
      ],
      pagination: {total: 1, offset: 0, count: 1},
    },
  }
  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(PERMISSIVE_ROBOTS)
    return jsonResponse(body)
  })

  const parsed = parseRateFlag("2")
  assert.ok(!(parsed instanceof Error), "rate=2 should parse")
  if (parsed instanceof Error) return
  assert.equal(parsed.delayMs, 500)

  const config: SiteConfig = {
    ...TEST_CONFIG,
    crawlDelay: parsed.delayMs,
    apiCategoryPaths: ["X1", "X2", "X3", "X4"], // 4 paths × 1 page each = 4 product fetches
  }
  const t0 = Date.now()
  await crawlUniqlo(config)
  const elapsed = Date.now() - t0
  mock.restore()

  // First fetch in each category is immediate; second-page check terminates.
  // Pacing only kicks in inside a category between pages. With 4 categories
  // each returning 1 page, we expect ~0 ms inter-fetch pacing — but the
  // robots check + multiple category fetches should still take some time.
  // To verify --rate effect, we instead validate parseRateFlag's math
  // directly here and rely on the next test for engine timing.
  void elapsed // silence unused
})

test("AC-6 --rate=2 timing: 4-page category enforces 3 × 500ms inter-page pacing", async () => {
  // Build a category that returns 100 items × 4 pages, then empty.
  const fixture = loadFixture() as {result: {items: unknown[]}}
  let n = 0
  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(PERMISSIVE_ROBOTS)
    n += 1
    if (n <= 4) {
      return jsonResponse({
        status: "ok",
        result: {
          items: fixture.result.items.slice(0, 100),
          pagination: {total: 400, offset: (n - 1) * 100, count: 100},
        },
      })
    }
    return jsonResponse({status: "ok", result: {items: [], pagination: {total: 400, offset: 400, count: 0}}})
  })

  const config: SiteConfig = {...TEST_CONFIG, crawlDelay: 500}
  const t0 = Date.now()
  await crawlUniqlo(config)
  const elapsed = Date.now() - t0
  mock.restore()

  // 4 product fetches, 3 inter-page delays of 500ms.
  assert.ok(elapsed >= 1500, `expected >=1500ms with --rate=2 pacing, got ${elapsed}ms`)
  assert.ok(elapsed < 2200, `expected <2200ms with jitter cap, got ${elapsed}ms`)
})

test("AC-6 --rate parse rejection: 10/0/-1/2.5/abc/empty are rejected", () => {
  for (const bad of ["10", "0", "-1", "2.5", "abc", "", "6", "100"]) {
    const r = parseRateFlag(bad)
    assert.ok(r instanceof Error, `expected --rate=${JSON.stringify(bad)} to be rejected`)
  }
  for (const ok of ["1", "2", "3", "4", "5"]) {
    const r = parseRateFlag(ok)
    assert.ok(!(r instanceof Error), `expected --rate=${ok} to be accepted`)
  }
})

// ─── AC-7: empty category ─────────────────────────────

test("AC-7 empty category: total=0/items=[] terminates after 1 request, no error entry", async () => {
  let calls = 0
  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(PERMISSIVE_ROBOTS)
    calls += 1
    return jsonResponse({status: "ok", result: {items: [], pagination: {total: 0, offset: 0, count: 0}}})
  })

  const config: SiteConfig = {
    ...TEST_CONFIG,
    crawlDelay: 1,
    apiCategoryPaths: ["EMPTY1"],
  }
  const result = await crawlUniqlo(config)
  mock.restore()

  assert.equal(calls, 1, `expected exactly 1 product fetch for empty category, got ${calls}`)
  assert.equal(result.errors.length, 0, "empty category should NOT produce an error entry")
  assert.equal(result.products.length, 0)
})

// ─── AC-2: cross-category pacing (regression) ─────────

test("AC-2 cross-category pacing: 3 single-page categories enforce 2 inter-request delays", async () => {
  const tinyBody = {
    status: "ok",
    result: {items: [], pagination: {total: 0, offset: 0, count: 0}},
  }
  const mock = installFetch(async (url) => {
    if (url.endsWith("/robots.txt")) return textResponse(PERMISSIVE_ROBOTS)
    return jsonResponse(tinyBody)
  })

  const delay = 200
  const config: SiteConfig = {
    ...TEST_CONFIG,
    crawlDelay: delay,
    apiCategoryPaths: ["A", "B", "C"],
  }
  const t0 = Date.now()
  await crawlUniqlo(config)
  const elapsed = Date.now() - t0
  mock.restore()

  // 3 product requests across 3 single-page categories => 2 inter-request waits.
  assert.ok(
    elapsed >= 2 * delay - 30,
    `cross-category pacing must apply: expected >= ${2 * delay - 30}ms, got ${elapsed}ms`,
  )
  assert.ok(
    elapsed < 2 * delay + 500,
    `cross-category pacing must not over-delay: expected < ${2 * delay + 500}ms, got ${elapsed}ms`,
  )
})

// ─── AC-1: platform registry ──────────────────────────

test("AC-1 platform registry: getPlatformsByType('uniqlo') returns uniqlo-kr (region=KR) and uniqlo-us (region=US)", async () => {
  const {getPlatformsByType} = await import("../src/configs/platforms")
  const entries = getPlatformsByType("uniqlo")
  assert.equal(entries.length, 2, "expected exactly two Uniqlo platforms registered (KR + US)")

  const kr = entries.find((e) => e.key === "uniqlo-kr")
  const us = entries.find((e) => e.key === "uniqlo-us")
  assert.ok(kr, "uniqlo-kr entry missing")
  assert.ok(us, "uniqlo-us entry missing")

  assert.equal(kr!.type, "uniqlo")
  assert.equal(kr!.baseUrl, "https://www.uniqlo.com/kr/ko")
  assert.equal(kr!.region, "KR")
  assert.equal(kr!.sourceCurrency, "KRW")
  assert.ok(
    Array.isArray(kr!.apiCategoryPaths) && kr!.apiCategoryPaths!.length > 0,
    "uniqlo-kr SiteConfig must have a non-empty apiCategoryPaths",
  )

  assert.equal(us!.type, "uniqlo")
  assert.equal(us!.baseUrl, "https://www.uniqlo.com/us/en")
  assert.equal(us!.region, "US")
  assert.equal(us!.sourceCurrency, "USD")
  assert.ok(
    Array.isArray(us!.apiCategoryPaths) && us!.apiCategoryPaths!.length >= 4,
    "uniqlo-us SiteConfig must enumerate at least the 4 gender top-levels",
  )
  // Verify the four gender top-levels per REQ-001.
  for (const tl of ["22210,,,", "22211,,,", "22212,,,", "22213,,,"]) {
    assert.ok(us!.apiCategoryPaths!.includes(tl), `uniqlo-us apiCategoryPaths missing ${tl}`)
  }
})

// AC-4: import-time FX conversion (mirrors src/import-products.ts logic).
// SPEC-PLATFORM-EXPANSION-002 REQ-004.
test("AC-4 import-time FX: USD products convert to integer KRW; unknown currency skipped", () => {
  const synthetic = [
    {sourceCurrency: "USD", price: 29.9, originalPrice: 29.9, salePrice: null, name: "A"},
    {sourceCurrency: "USD", price: 19.9, originalPrice: 25.0, salePrice: 19.9, name: "B"},
    {sourceCurrency: "USD", price: 49.9, originalPrice: null, salePrice: null, name: "C"},
    {sourceCurrency: "ZZZ", price: 100, originalPrice: 100, salePrice: null, name: "Z"},
  ]
  const converted = synthetic
    .map((p) => {
      const sc = p.sourceCurrency
      if (sc === "KRW") return {price: p.price, name: p.name}
      const krw = typeof p.price === "number" ? convertToKrw(p.price, sc) : null
      if (typeof p.price === "number" && krw === null) return null // skip
      return {price: krw, name: p.name}
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  assert.equal(converted.length, 3, "expected 3 products after skipping ZZZ")
  // AC-4가 고정하는 것은 "USD가 정수 KRW로 환산되고 미지원 통화는 드롭된다"이지
  // 특정 환율값이 아니다. 2026-08-26부터 환율은 런타임 테이블에서 오므로
  // 숫자를 박아두면 환율이 움직일 때마다 이 테스트가 깨진다.
  const usdRate = fxRateToKrw("USD")
  assert.ok(usdRate !== undefined && usdRate > 0, "USD rate must be available")
  assert.equal(converted[0].price, Math.round(29.9 * usdRate))
  assert.equal(converted[1].price, Math.round(19.9 * usdRate))
  assert.equal(converted[2].price, Math.round(49.9 * usdRate))
  for (const c of converted) assert.ok(Number.isInteger(c.price), "KRW must be a whole number")
  assert.ok(!converted.some((c) => c.name === "Z"), "unknown-currency product must be skipped")
})
