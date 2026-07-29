/**
 * Characterization tests for the 29CM KR engine.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-004 (REQ-009 + selected ACs)
 * Runs via: pnpm test (node --test --import tsx ./tests/*.test.ts)
 *
 * Coverage scope: pure parse paths only. The Playwright lifecycle
 * (browser launch, navigation, scroll, XHR interception) is NOT
 * unit-tested — that surface is smoke-tested via live `pnpm crawl
 * --probe=29cm-kr` invocation per acceptance.md AC-7.
 *
 * Fixture: tests/fixtures/29cm-products.fixture.json — captured
 * 2026-05-06 from a live display-bff-api response for
 * categoryLargeCode=268100100 / 여성의류 (50 PRODUCT items).
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {
  harvestRawItems,
  is29cmCloudflareChallenge,
  isSafe29cmImageUrl,
  isSafe29cmProductUrl,
  parseProductsFromDom,
  parseProductsFromXhr,
  pick29cmUserAgent,
  type RawTwentyninecmItem,
  type RawTwentyninecmPayload,
} from "../src/lib/29cm-engine"
import {PLATFORMS, getSiteConfig} from "../src/configs/platforms"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURE_PATH = path.join(__dirname, "fixtures", "29cm-products.fixture.json")
const TEST_BASE_URL = "https://www.29cm.co.kr"
const TEST_KEY = "29cm-kr"
const FIXTURE_CATEGORY_CODE = 268100100 // 여성의류

function loadFixture(): RawTwentyninecmPayload {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8")) as RawTwentyninecmPayload
}

// ─── AC-1: platform registry ────────────────────────────────

test("AC-1 PLATFORMS includes 29cm-kr with required fields", () => {
  const cfg = getSiteConfig("29cm-kr")
  assert.ok(cfg, "29cm-kr SiteConfig missing")
  assert.equal(cfg!.key, "29cm-kr")
  assert.equal(cfg!.type, "29cm")
  assert.equal(cfg!.baseUrl, "https://www.29cm.co.kr")
  assert.equal(cfg!.sourceCurrency, "KRW")
  assert.equal(cfg!.crawlDelay, 2000)
  assert.ok(Array.isArray(cfg!.apiCategoryCodes), "apiCategoryCodes must be array")
  assert.equal(cfg!.apiCategoryCodes!.length, 10, "expected 10 L1 codes")
  // Ensure no cross-contamination with Uniqlo/ZARA-bound fields.
  assert.equal(cfg!.apiCategoryPaths, undefined)
  assert.equal(cfg!.categoryUrls, undefined)
  assert.equal(cfg!.region, undefined)
})

test("AC-1 platform count: total registered platforms is at least 36", () => {
  assert.ok(PLATFORMS.length >= 36, `expected >=36 platforms, got ${PLATFORMS.length}`)
})

// ─── AC-2: parseProductsFromXhr core invariants ─────────────

test("AC-2 parseProductsFromXhr: every product has populated name/price/imageUrl/productUrl", () => {
  const fixture = loadFixture()
  assert.equal(fixture.meta?.result, "SUCCESS")
  const list = fixture.data?.list ?? []
  assert.ok(list.length >= 30, `expected >=30 fixture items, got ${list.length}`)
  const annotated: RawTwentyninecmItem[] = list.map((it) => ({
    ...it,
    _categoryCode: FIXTURE_CATEGORY_CODE,
  }))
  const products = parseProductsFromXhr(annotated, TEST_BASE_URL, TEST_KEY)
  assert.ok(products.length > 0, `parser produced 0 Products from ${list.length} fixture items`)
  const survival = products.length / list.length
  assert.ok(
    survival >= 0.8,
    `expected >=80% of fixture items to parse cleanly, got ${(survival * 100).toFixed(1)}%`,
  )
  for (const p of products) {
    assert.equal(typeof p.name, "string")
    assert.ok(p.name.length > 0, `empty name for ${p.productCode}`)
    assert.equal(typeof p.price, "number")
    assert.ok((p.price as number) > 0, `non-positive price for ${p.productCode}`)
    // KRW sanity range
    assert.ok((p.price as number) >= 1_000, `price suspiciously low: ${p.price}`)
    assert.ok((p.price as number) <= 10_000_000, `price suspiciously high: ${p.price}`)
    assert.ok(isSafe29cmProductUrl(p.productUrl), `productUrl format invalid: ${p.productUrl}`)
    assert.ok(p.productUrl.startsWith("https://product.29cm.co.kr/catalog/"), `productUrl wrong host: ${p.productUrl}`)
    assert.ok(isSafe29cmImageUrl(p.imageUrl), `imageUrl host not whitelisted: ${p.imageUrl}`)
    assert.equal(p.platform, TEST_KEY)
    assert.equal(p.sourceCurrency, "KRW")
    assert.ok(p.priceFormatted.startsWith("₩"), `priceFormatted should use ₩: ${p.priceFormatted}`)
    assert.ok(p.productCode && p.productCode.length > 0, `productCode missing`)
  }
})

test("AC-2 parseProductsFromXhr: salePrice set when displayPrice < originalPrice", () => {
  const fixture = loadFixture()
  const list = fixture.data?.list ?? []
  const annotated = list.map((it) => ({
    ...it,
    _categoryCode: FIXTURE_CATEGORY_CODE,
  }))
  const products = parseProductsFromXhr(annotated, TEST_BASE_URL, TEST_KEY)
  let saleCount = 0
  for (const p of products) {
    if (p.salePrice !== null) {
      assert.ok(p.originalPrice !== null && p.originalPrice > p.price!, `salePrice set but original<=display for ${p.productCode}`)
      saleCount += 1
    }
  }
  // Fixture should have at least one discounted item (typical 29CM listing).
  assert.ok(saleCount >= 1, "no salePrice products parsed — fixture should contain discounts")
})

test("AC-2 parseProductsFromXhr: tolerates raw payload with nested data.list", () => {
  const fixture = loadFixture()
  // Pass the whole payload — harvest should walk the structure.
  const products = parseProductsFromXhr(fixture, TEST_BASE_URL, TEST_KEY)
  assert.ok(products.length > 0, "parser failed to harvest from nested payload")
})

test("AC-2 parseProductsFromXhr: skips non-PRODUCT items", () => {
  const synthetic: RawTwentyninecmItem[] = [
    {
      itemId: 1,
      itemType: "BANNER",
      itemUrl: {webLink: "https://product.29cm.co.kr/catalog/1"},
      itemInfo: {productName: "banner", displayPrice: 1000, thumbnailUrl: "https://img.29cm.co.kr/x.jpg"},
    },
    {
      itemId: 2,
      itemType: "PRODUCT",
      itemUrl: {webLink: "https://product.29cm.co.kr/catalog/2?x=y"},
      itemInfo: {
        productName: "real product",
        displayPrice: 50_000,
        originalPrice: 50_000,
        thumbnailUrl: "https://img.29cm.co.kr/y.jpg",
        isSoldOut: false,
        brandName: "TestBrand",
      },
      itemEvent: {eventProperties: {largeCategoryName: "여성의류", brandName: "TestBrand"}},
      _categoryCode: 268100100,
    },
  ]
  const products = parseProductsFromXhr(synthetic, TEST_BASE_URL, TEST_KEY)
  assert.equal(products.length, 1)
  assert.equal(products[0]!.productCode, "2")
})

// ─── AC-2b: parseProductsFromDom fallback ───────────────────

test("AC-2b parseProductsFromDom: extracts product from synthetic HTML card", () => {
  const html = `
    <div class="grid">
      <a href="https://product.29cm.co.kr/catalog/12345?categoryLargeCode=268100100">
        <img src="https://img.29cm.co.kr/item/12345.jpg" />
        <span class="product-name">테스트 블라우스</span>
        <p class="price">88,740원</p>
      </a>
      <a href="/some-other-link">unrelated</a>
      <a href="https://product.29cm.co.kr/catalog/67890">
        <img src="https://img.29cm.co.kr/item/67890.jpg" />
        <span class="product-title">테스트 티셔츠</span>
        <p class="price">45,000원</p>
      </a>
    </div>
  `
  const products = parseProductsFromDom(html, TEST_BASE_URL, TEST_KEY, "women")
  assert.equal(products.length, 2)
  const first = products[0]!
  assert.equal(first.productCode, "12345")
  assert.equal(first.name, "테스트 블라우스")
  assert.equal(first.price, 88740)
  assert.ok(isSafe29cmImageUrl(first.imageUrl))
  assert.ok(isSafe29cmProductUrl(first.productUrl))
})

test("AC-2b parseProductsFromDom: returns empty for empty/non-string input", () => {
  assert.deepEqual(parseProductsFromDom("", TEST_BASE_URL, TEST_KEY, "women"), [])
  // @ts-expect-error testing runtime defensive behavior with invalid input
  assert.deepEqual(parseProductsFromDom(null, TEST_BASE_URL, TEST_KEY, "women"), [])
})

// ─── AC-3: Cloudflare challenge detector ────────────────────

test("AC-3 is29cmCloudflareChallenge: detects synthetic challenge body", () => {
  const challengeHtml = `<!DOCTYPE html><html><body>Just a moment... cf-mitigated cf-challenge-platform</body></html>`
  const result = is29cmCloudflareChallenge(challengeHtml)
  assert.equal(result.isIntercept, true)
  assert.ok(result.reason && result.reason.includes("cloudflare"))
})

test("AC-3 is29cmCloudflareChallenge: passes large normal body", () => {
  const normalHtml = "<html><body>" + "x".repeat(20_000) + "</body></html>"
  const result = is29cmCloudflareChallenge(normalHtml)
  assert.equal(result.isIntercept, false)
})

test("AC-3 is29cmCloudflareChallenge: catches access-denied small body", () => {
  const denied = "Access Denied"
  const result = is29cmCloudflareChallenge(denied)
  assert.equal(result.isIntercept, true)
})

// ─── AC-4: image / product URL whitelists ───────────────────

test("AC-4 isSafe29cmImageUrl rejects off-host URLs", () => {
  assert.equal(isSafe29cmImageUrl("https://img.29cm.co.kr/item/x.jpg"), true)
  assert.equal(isSafe29cmImageUrl("https://asset.29cm.co.kr/y.jpg"), true)
  assert.equal(isSafe29cmImageUrl("https://example.com/x.jpg"), false)
  assert.equal(isSafe29cmImageUrl("http://img.29cm.co.kr/x.jpg"), false) // no http://
  assert.equal(isSafe29cmImageUrl("not-a-url"), false)
  // Subdomain spoofing — hostname is `img.29cm.co.kr.evil.com`
  assert.equal(isSafe29cmImageUrl("https://img.29cm.co.kr.evil.com/x.jpg"), false)
  // Userinfo spoofing — URL parser canonicalizes to actual host
  assert.equal(isSafe29cmImageUrl("https://img.29cm.co.kr@evil.com/x.jpg"), false)
})

test("AC-4 isSafe29cmProductUrl rejects bad URLs", () => {
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr/catalog/12345"), true)
  // Query string is benign — pathname-based whitelist accepts.
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr/catalog/12345?x=y"), true)
  assert.equal(isSafe29cmProductUrl("https://www.29cm.co.kr/catalog/12345"), false)
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr/catalog/abc"), false)
  assert.equal(isSafe29cmProductUrl("javascript:alert(1)"), false)
  // Subdomain spoofing
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr.evil.com/catalog/12345"), false)
  // Newline / null-byte injection (multiline-anchor attacks)
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr/catalog/12345\nhttps://evil.com"), false)
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr/catalog/12345\0"), false)
  // Path traversal
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr/catalog/12345/../admin"), false)
  // Userinfo spoofing
  assert.equal(isSafe29cmProductUrl("https://product.29cm.co.kr@evil.com/catalog/1"), false)
})

test("AC-4 harvestRawItems ignores prototype-pollution keys", () => {
  // Even if a payload contains __proto__/constructor literal keys, they MUST
  // not be traversed (defense-in-depth — Object.keys does not enumerate
  // prototype chain by default, but literal own-properties named __proto__
  // could exist in adversarial payloads).
  const malicious = {
    __proto__: {polluted: true},
    constructor: {bad: true},
    data: {
      list: [
        {
          itemId: 1,
          itemType: "PRODUCT",
          itemUrl: {webLink: "https://product.29cm.co.kr/catalog/1"},
          itemInfo: {
            productName: "ok",
            displayPrice: 1000,
            thumbnailUrl: "https://img.29cm.co.kr/x.jpg",
          },
        },
      ],
    },
  }
  const harvested = harvestRawItems(malicious)
  assert.equal(harvested.length, 1)
  // Ensure Object.prototype was not polluted (sanity check).
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined)
})


// ─── AC-6: harvest helper ───────────────────────────────────

test("AC-6 harvestRawItems walks nested payloads", () => {
  const fixture = loadFixture()
  const harvested = harvestRawItems(fixture)
  const list = fixture.data?.list ?? []
  assert.equal(harvested.length, list.length, `expected harvest count to match data.list length`)
})

// ─── AC-7: User-Agent rotation ──────────────────────────────

test("AC-7 pick29cmUserAgent rotates across 5 entries", () => {
  const seen = new Set<string>()
  for (let i = 0; i < 10; i++) seen.add(pick29cmUserAgent(i))
  assert.equal(seen.size, 5, "expected exactly 5 distinct UAs in rotation")
})
