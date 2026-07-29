/**
 * Characterization tests for the ZARA KR engine.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-003 (REQ-009 + selected ACs)
 * Runs via: pnpm test (node --test --import tsx ./tests/*.test.ts)
 *
 * Coverage scope: the engine's pure parse path only. The Playwright
 * lifecycle (browser launch, navigation, XHR interception, scroll)
 * is NOT unit-tested here — that surface is smoke-tested via live
 * `pnpm crawl --probe=zara-kr` invocation per acceptance.md AC-3.
 *
 * IMPORTANT DEVIATION FROM SPEC v0.1.0:
 *   The plan called for `parseProductsFromDom(html: string, baseUrl,
 *   platformKey)` operating on a synthetic HTML body wrapping the
 *   fixture. The Run-phase ANALYZE step (2026-05-05) discovered that
 *   ZARA category landing pages render WITHOUT product names or prices
 *   in the static DOM — `product-grid-product__data` is always empty.
 *   The real product data is delivered to the SPA via an AJAX
 *   `/kr/ko/category/{id}/products?ajax=true` JSON response, which is
 *   the cleanest available data source.
 *   Engine therefore exposes `parseProductsFromXhr(json, baseUrl,
 *   platformKey)` and the fixture is captured XHR JSON, not card HTML.
 *   See zara-engine.ts header comments for full rationale.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {
  buildZaraProductUrlPattern,
  detectBmVerifyIntercept,
  formatZaraPrice,
  harvestRawProducts,
  isSafeZaraImageUrl,
  isSafeZaraProductUrl,
  parseProductsFromXhr,
  pickZaraUserAgent,
  type RawZaraProduct,
} from "../src/lib/zara-engine"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURE_PATH = path.join(__dirname, "fixtures", "zara-kr-products.fixture.json")
const TEST_BASE_URL = "https://www.zara.com/kr/ko"
const TEST_KEY = "zara-kr"

interface Fixture {
  capturedAt: string
  baseUrl: string
  ajaxUrls?: Record<string, string>
  samples: Array<RawZaraProduct & {_gender: string; _category: string}>
}

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8")) as Fixture
}

// ─── REQ-009 / AC-2: parseProductsFromXhr core invariants ──

test("AC-2 parseProductsFromXhr: every product has populated name/price/imageUrl/productUrl", () => {
  const fixture = loadFixture()
  assert.ok(fixture.samples.length >= 30, `expected >=30 samples, got ${fixture.samples.length}`)
  const products = parseProductsFromXhr(fixture.samples, TEST_BASE_URL, TEST_KEY, "KR", "KRW")
  assert.ok(products.length > 0, `parser produced 0 Products from ${fixture.samples.length} samples`)
  // We expect at least 80% of samples to survive (some may have missing
  // image data; those are silently skipped per defensive null-handling).
  const survival = products.length / fixture.samples.length
  assert.ok(
    survival >= 0.8,
    `expected >=80% of fixture samples to parse cleanly, got ${(survival * 100).toFixed(1)}%`,
  )
  for (const p of products) {
    assert.equal(typeof p.name, "string")
    assert.ok(p.name.length > 0, `empty name for ${p.productCode}`)
    assert.equal(typeof p.price, "number")
    assert.ok((p.price as number) > 0, `non-positive price for ${p.productCode}`)
    // KRW sanity range — ZARA KR prices typically 5,000 ≤ p ≤ 5,000,000
    assert.ok((p.price as number) >= 1_000, `price suspiciously low: ${p.price}`)
    assert.ok((p.price as number) <= 10_000_000, `price suspiciously high: ${p.price}`)
    assert.ok(
      isSafeZaraProductUrl(p.productUrl, TEST_BASE_URL),
      `productUrl format invalid: ${p.productUrl}`,
    )
    assert.ok(p.productUrl.startsWith(TEST_BASE_URL + "/"), `productUrl wrong base: ${p.productUrl}`)
    assert.ok(
      isSafeZaraImageUrl(p.imageUrl),
      `imageUrl host not whitelisted: ${p.imageUrl}`,
    )
    assert.equal(p.platform, TEST_KEY)
    assert.equal(p.sourceCurrency, "KRW")
    assert.equal(p.brand, "ZARA")
    assert.ok(p.priceFormatted.startsWith("₩"), `priceFormatted should use ₩: ${p.priceFormatted}`)
  }
})

test("AC-2 parseProductsFromXhr: accepts a deeply-nested raw payload via harvest", () => {
  // Wrap the fixture's samples in a fake payload tree.
  const fixture = loadFixture()
  const wrapped = {
    productGroups: [
      {
        elements: [
          {commercialComponents: fixture.samples.slice(0, 5)},
        ],
      },
    ],
  }
  const products = parseProductsFromXhr(wrapped, TEST_BASE_URL, TEST_KEY, "KR", "KRW")
  assert.ok(products.length > 0, "harvest should find nested products")
  for (const p of products) {
    assert.ok(isSafeZaraProductUrl(p.productUrl, TEST_BASE_URL))
    assert.ok(isSafeZaraImageUrl(p.imageUrl))
  }
})

// ─── isSafeZaraImageUrl: positive + negative cases ──

test("isSafeZaraImageUrl: accepts whitelisted hosts", () => {
  assert.equal(
    isSafeZaraImageUrl("https://static.zara.net/assets/public/abc/def/ghi.jpg?ts=1&w=1024"),
    true,
  )
  assert.equal(
    isSafeZaraImageUrl("https://static-images.zara.net/path/to/image.jpg"),
    true,
  )
})

test("isSafeZaraImageUrl: rejects non-whitelisted and non-https URLs", () => {
  assert.equal(isSafeZaraImageUrl("https://evil.example.com/img.jpg"), false)
  assert.equal(isSafeZaraImageUrl("https://i.imgur.com/x.jpg"), false)
  assert.equal(isSafeZaraImageUrl("http://static.zara.net/x.jpg"), false) // http
  assert.equal(isSafeZaraImageUrl("not a url"), false)
  assert.equal(isSafeZaraImageUrl(""), false)
  assert.equal(isSafeZaraImageUrl(null as unknown as string), false)
})

// ─── isSafeZaraProductUrl: regex check ──

test("isSafeZaraProductUrl: accepts the canonical /kr/ko/...-pNNNNNNN.html shape", () => {
  assert.equal(
    isSafeZaraProductUrl("https://www.zara.com/kr/ko/some-keyword-p03641406.html", TEST_BASE_URL),
    true,
  )
  // URL-encoded Korean keyword
  assert.equal(
    isSafeZaraProductUrl(
      "https://www.zara.com/kr/ko/%E1%84%85%E1%85%B5%E1%84%87%E1%85%B3-p12345678.html",
      TEST_BASE_URL,
    ),
    true,
  )
})

test("isSafeZaraProductUrl: rejects non-canonical URLs", () => {
  assert.equal(
    isSafeZaraProductUrl("https://www.zara.com/us/en/foo-p1.html", TEST_BASE_URL),
    false,
  ) // wrong locale
  assert.equal(
    isSafeZaraProductUrl("https://www.zara.com/kr/ko/cat/sub.html", TEST_BASE_URL),
    false,
  ) // no -pNNN
  assert.equal(isSafeZaraProductUrl("https://evil.example.com/foo-p1.html", TEST_BASE_URL), false)
  assert.equal(
    isSafeZaraProductUrl("http://www.zara.com/kr/ko/foo-p1.html", TEST_BASE_URL),
    false,
  ) // http
  assert.equal(isSafeZaraProductUrl("", TEST_BASE_URL), false)
})

// ─── detectBmVerifyIntercept ──

test("detectBmVerifyIntercept: identifies short bm-verify body as intercept", () => {
  const interceptBody = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="5; URL='/kr/ko/?bm-verify=AAQAAAAN_____'"></head><body></body></html>`
  const r = detectBmVerifyIntercept(interceptBody)
  assert.equal(r.isIntercept, true)
  assert.equal(r.reason, "bm-verify")
})

test("detectBmVerifyIntercept: identifies hard-403 access-denied body as intercept", () => {
  const denied = "<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>You don't have permission. Reference #18.xxx</body></html>"
  const r = detectBmVerifyIntercept(denied)
  assert.equal(r.isIntercept, true)
  assert.equal(r.reason, "access-denied-403")
})

test("detectBmVerifyIntercept: passes a real product-page-sized body", () => {
  const real = "<!DOCTYPE html><html>" + "x".repeat(10_000) + "</html>"
  const r = detectBmVerifyIntercept(real)
  assert.equal(r.isIntercept, false)
})

test("detectBmVerifyIntercept: does NOT flag long body that mentions bm-verify (e.g. analytics scripts)", () => {
  // bm-verify can appear in long pages as part of analytics token storage,
  // so the length floor is required to avoid false positives.
  const longWithKeyword = "<html>" + "x".repeat(20_000) + " bm-verify-token=abc " + "y".repeat(10_000) + "</html>"
  const r = detectBmVerifyIntercept(longWithKeyword)
  assert.equal(r.isIntercept, false)
})

// ─── harvestRawProducts ──

test("harvestRawProducts: walks nested structure and finds product-shaped objects", () => {
  const fixture = loadFixture()
  const seed = fixture.samples[0]!
  const nested = {a: {b: {c: [seed, {x: 1}, {arr: [seed]}]}}}
  const harvested = harvestRawProducts(nested)
  assert.equal(harvested.length, 2, "expected 2 distinct product matches")
})

test("harvestRawProducts: returns empty for non-product trees", () => {
  assert.deepEqual(harvestRawProducts({foo: "bar", n: 1}), [])
  assert.deepEqual(harvestRawProducts(null), [])
  assert.deepEqual(harvestRawProducts(undefined), [])
})

// ─── pickZaraUserAgent: round-robin ──

test("pickZaraUserAgent: rotates round-robin across 5 entries", () => {
  const seen = new Set<string>()
  for (let i = 0; i < 5; i++) seen.add(pickZaraUserAgent(i))
  assert.equal(seen.size, 5, "expected 5 unique UAs")
  // Index 5 should equal index 0 (round-robin).
  assert.equal(pickZaraUserAgent(0), pickZaraUserAgent(5))
  assert.equal(pickZaraUserAgent(1), pickZaraUserAgent(6))
})

test("pickZaraUserAgent: every entry begins with Mozilla/5.0", () => {
  for (let i = 0; i < 5; i++) {
    assert.ok(pickZaraUserAgent(i).startsWith("Mozilla/5.0"))
  }
})

// ─── AC-1: platform registry ──

test("AC-1 platform registry: getPlatformsByType('zara') returns zara-kr + zara-us, with zara-kr first", async () => {
  const {getPlatformsByType} = await import("../src/configs/platforms")
  const entries = getPlatformsByType("zara")
  // SPEC-005: zara-us activated 2026-05-06 after REQ-007/008/009 cleared.
  assert.equal(entries.length, 2, `expected 2 zara platforms (kr + us), got ${entries.length}`)
  const z = entries[0]!
  assert.equal(z.key, "zara-kr")
  assert.equal(z.type, "zara")
  assert.equal(z.baseUrl, "https://www.zara.com/kr/ko")
  assert.equal(z.sourceCurrency, "KRW")
  assert.equal(z.crawlDelay, 2000)
  assert.ok(
    Array.isArray(z.categoryUrls) && z.categoryUrls.length >= 16,
    `expected >=16 category URLs (8 women + 8 men), got ${z.categoryUrls?.length}`,
  )
  // Each URL must be valid ZARA KR locale.
  for (const u of z.categoryUrls!) {
    assert.ok(u.startsWith("https://www.zara.com/kr/ko/"), `bad URL: ${u}`)
    assert.ok(/-l\d+\.html$/.test(u), `URL doesn't end with -lNNN.html: ${u}`)
  }
  // Should NOT carry uniqlo-only fields.
  assert.equal(z.apiCategoryPaths, undefined, "zara-kr must NOT have apiCategoryPaths")
  // SPEC-PLATFORM-EXPANSION-005 REQ-001: zara-kr now carries explicit region.
  assert.equal(z.region, "KR", "zara-kr must have explicit region:'KR'")
})

// ─── SPEC-005 AC-1: zara-us platform registry (active post-Run-phase gates) ──

test("AC-1 platform registry: zara-us is registered and active (REQ-007/008/009 cleared 2026-05-06)", async () => {
  const {getSiteConfig} = await import("../src/configs/platforms")
  const z = getSiteConfig("zara-us")
  assert.ok(z, "zara-us SiteConfig must exist")
  assert.equal(z!.key, "zara-us")
  assert.equal(z!.type, "zara")
  assert.equal(z!.baseUrl, "https://www.zara.com/us/en")
  assert.equal(z!.region, "US")
  assert.equal(z!.sourceCurrency, "USD")
  assert.equal(z!.crawlDelay, 2000)
  // SPEC-005 REQ-007/008/009 cleared 2026-05-06: zara-us is active (no disabled flag).
  assert.notEqual(z!.disabled, true, "zara-us must NOT be disabled after Run-phase gates cleared")
  assert.ok(Array.isArray(z!.categoryUrls), "categoryUrls must be present")
  // REQ-009 result: 17/18 PASS. man-outerwear-l715 removed (no AJAX endpoint).
  assert.equal(
    z!.categoryUrls!.length,
    17,
    `expected exactly 17 category URLs (10 women + 7 men, post REQ-009 remediation), got ${z!.categoryUrls!.length}`,
  )
  for (const u of z!.categoryUrls!) {
    assert.ok(u.startsWith("https://www.zara.com/us/en/"), `bad URL: ${u}`)
    assert.ok(/-l\d+\.html$/.test(u), `URL doesn't end with -lNNN.html: ${u}`)
  }
  // l715 must NOT be present
  assert.ok(
    !z!.categoryUrls!.some((u) => u.includes("man-outerwear-l715")),
    "man-outerwear-l715 was removed per REQ-009 (no AJAX endpoint)",
  )
})

// ─── SPEC-005 AC-4: formatZaraPrice region-aware output ──

test("AC-4 formatZaraPrice: KR emits ₩ + ko-KR locale grouping", () => {
  assert.equal(formatZaraPrice(19900, "KR"), "₩19,900")
  assert.equal(formatZaraPrice(0, "KR"), "₩0")
  assert.equal(formatZaraPrice(1_234_567, "KR"), "₩1,234,567")
})

test("AC-4 formatZaraPrice: US emits $ + 2-decimal fixed", () => {
  assert.equal(formatZaraPrice(29.9, "US"), "$29.90")
  assert.equal(formatZaraPrice(0, "US"), "$0.00")
  assert.equal(formatZaraPrice(99, "US"), "$99.00")
})

// ─── SPEC-005: deriveGenderFromUrl region-agnostic ──

// ─── SPEC-005: buildZaraProductUrlPattern per-baseUrl validator ──

test("buildZaraProductUrlPattern: KR base accepts KR URLs and rejects US URLs", () => {
  const pat = buildZaraProductUrlPattern("https://www.zara.com/kr/ko")
  assert.equal(pat.test("https://www.zara.com/kr/ko/foo-p123.html"), true)
  assert.equal(pat.test("https://www.zara.com/us/en/foo-p123.html"), false)
})

test("buildZaraProductUrlPattern: US base accepts US URLs and rejects KR URLs", () => {
  const pat = buildZaraProductUrlPattern("https://www.zara.com/us/en")
  assert.equal(pat.test("https://www.zara.com/us/en/foo-p123.html"), true)
  assert.equal(pat.test("https://www.zara.com/kr/ko/foo-p123.html"), false)
})

test("buildZaraProductUrlPattern: trailing slash on baseUrl is normalized", () => {
  const pat = buildZaraProductUrlPattern("https://www.zara.com/us/en/")
  assert.equal(pat.test("https://www.zara.com/us/en/foo-p1.html"), true)
})

// ─── SPEC-005 AC-3 / REQ-010: parameterized US fixture characterization ──

const US_FIXTURE_PATH = path.join(__dirname, "fixtures", "zara-us-products.fixture.json")
const US_BASE_URL = "https://www.zara.com/us/en"
const US_KEY = "zara-us"

interface UsFixture {
  capturedAt: string
  baseUrl: string
  ajaxUrls?: Record<string, string>
  samples: Array<RawZaraProduct & {_gender?: string; _category?: string}>
}

function loadUsFixture(): UsFixture | null {
  if (!fs.existsSync(US_FIXTURE_PATH)) return null
  return JSON.parse(fs.readFileSync(US_FIXTURE_PATH, "utf-8")) as UsFixture
}

test("AC-3 parseProductsFromXhr (US): every product has populated name/price/imageUrl/productUrl with USD-decimal", () => {
  const fixture = loadUsFixture()
  assert.ok(fixture, `expected US fixture at ${US_FIXTURE_PATH}`)
  assert.ok(fixture!.samples.length >= 30, `expected >=30 US samples, got ${fixture!.samples.length}`)
  const products = parseProductsFromXhr(fixture!.samples, US_BASE_URL, US_KEY, "US", "USD")
  assert.ok(products.length > 0, `parser produced 0 Products from ${fixture!.samples.length} US samples`)
  const survival = products.length / fixture!.samples.length
  assert.ok(
    survival >= 0.5,
    `expected >=50% of US samples to parse cleanly, got ${(survival * 100).toFixed(1)}%`,
  )
  for (const p of products) {
    assert.equal(typeof p.name, "string")
    assert.ok(p.name.length > 0, `empty name for ${p.productCode}`)
    assert.equal(typeof p.price, "number")
    assert.ok((p.price as number) > 0, `non-positive price for ${p.productCode}`)
    // USD sanity range — ZARA US prices typically 0.01 ≤ p ≤ 50,000
    assert.ok((p.price as number) >= 0.01, `USD price suspiciously low: ${p.price}`)
    assert.ok((p.price as number) <= 50_000, `USD price suspiciously high: ${p.price}`)
    assert.ok(
      isSafeZaraProductUrl(p.productUrl, US_BASE_URL),
      `productUrl format invalid for US base: ${p.productUrl}`,
    )
    assert.ok(p.productUrl.startsWith(US_BASE_URL + "/"), `productUrl wrong base: ${p.productUrl}`)
    assert.ok(
      isSafeZaraImageUrl(p.imageUrl),
      `imageUrl host not whitelisted: ${p.imageUrl}`,
    )
    assert.equal(p.platform, US_KEY)
    assert.equal(p.sourceCurrency, "USD")
    assert.equal(p.brand, "ZARA")
    assert.ok(p.priceFormatted.startsWith("$"), `US priceFormatted should use $: ${p.priceFormatted}`)
    // US priceFormatted always carries 2-decimal precision
    assert.ok(/\.\d{2}$/.test(p.priceFormatted), `US priceFormatted should end in .NN: ${p.priceFormatted}`)
  }
})

