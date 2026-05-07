/**
 * Characterization tests for the Farfetch KR/US engine.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-006 (REQ-010 + selected ACs)
 * Runs via: pnpm test (node --test --import tsx ./tests/*.test.ts)
 *
 * Coverage scope: pure parse paths and helper functions only. The
 * Playwright lifecycle (browser launch, navigation, DOM extraction)
 * is NOT unit-tested — that surface is smoke-tested via live
 * `pnpm crawl --probe=farfetch-kr` invocation per acceptance.md.
 *
 * Fixture: tests/fixtures/farfetch-kr-products.fixture.json — captured
 * 2026-05-07 from a live `/kr/shopping/men/clothing-2/items.aspx`
 * landing (32 product cards passing brand+name+priceText+imageUrl
 * presence filter).
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {
    buildFarfetchProductUrlPattern,
    deriveGenderFromUrl,
    detectChallengeIntercept,
    formatFarfetchPrice,
    isSafeFarfetchImageUrl,
    isSafeFarfetchProductUrl,
    parseFarfetchPrice,
    parseProductsFromCards,
    pickFarfetchUserAgent,
    type RawFarfetchCard,
} from "../src/lib/farfetch-engine"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, "fixtures", "farfetch-kr-products.fixture.json")
const KR_BASE = "https://www.farfetch.com/kr"
const US_BASE = "https://www.farfetch.com"

interface Fixture {
  _meta: {capturedAt: string; capturedFrom: string; cardCount: number}
  cards: RawFarfetchCard[]
}

function loadFixture(): Fixture {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf-8")
  return JSON.parse(raw) as Fixture
}

// ─── Fixture-driven characterization tests (REQ-010) ─────

test("fixture: parseProductsFromCards yields >= 1 valid Product", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  assert.ok(products.length >= 1, `expected >= 1 product, got ${products.length}`)
})

test("fixture: every emitted Product has populated required fields", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  for (const p of products) {
    assert.ok(p.name && p.name.length > 0, `name missing for ${p.productUrl}`)
    assert.ok(p.brand && p.brand.length > 0, `brand missing for ${p.productUrl}`)
    assert.ok(p.imageUrl && p.imageUrl.startsWith("https://"), `imageUrl invalid for ${p.productUrl}`)
    assert.ok(p.productUrl && p.productUrl.startsWith("https://www.farfetch.com/kr/"), `productUrl invalid: ${p.productUrl}`)
    assert.ok(typeof p.price === "number" && p.price > 0, `price invalid for ${p.productUrl}`)
  }
})

test("fixture: every imageUrl matches FARFETCH_IMAGE_HOSTS whitelist", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  for (const p of products) {
    assert.ok(isSafeFarfetchImageUrl(p.imageUrl), `unsafe image host: ${p.imageUrl}`)
  }
})

test("fixture: every productUrl matches FARFETCH_PRODUCT_URL pattern", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  for (const p of products) {
    assert.ok(isSafeFarfetchProductUrl(p.productUrl, KR_BASE), `unsafe product URL: ${p.productUrl}`)
  }
})

test("fixture: every Product.sourceCurrency === 'KRW' and platform === 'farfetch-kr'", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  for (const p of products) {
    assert.equal(p.sourceCurrency, "KRW")
    assert.equal(p.platform, "farfetch-kr")
    assert.equal(p.sourcePrice, p.price, "sourcePrice should equal price for KRW-native cache")
  }
})

test("fixture: every priceFormatted starts with '₩' for KR", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  for (const p of products) {
    assert.ok(p.priceFormatted.startsWith("₩"), `priceFormatted missing ₩: ${p.priceFormatted}`)
  }
})

test("fixture: every price is a positive KRW integer in sanity range [1000, 100M]", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  for (const p of products) {
    assert.ok(typeof p.price === "number" && Number.isInteger(p.price), `non-integer price: ${p.price}`)
    assert.ok((p.price ?? 0) >= 1_000, `price below KRW_MIN: ${p.price}`)
    assert.ok((p.price ?? 0) <= 100_000_000, `price above KRW_MAX: ${p.price}`)
  }
})

test("fixture: every gender contains 'men' (category was /men/clothing-2)", () => {
  const fx = loadFixture()
  const products = parseProductsFromCards(fx.cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  for (const p of products) {
    assert.ok(p.gender.includes("men"), `gender missing 'men' for ${p.productUrl}`)
  }
})

// ─── Unit tests: helper functions ────────────────────────

test("isSafeFarfetchImageUrl accepts whitelisted hosts", () => {
  assert.equal(isSafeFarfetchImageUrl("https://cdn-images.farfetch-contents.com/35/18/27/path.jpg"), true)
  assert.equal(isSafeFarfetchImageUrl("https://cdn-static.farfetch-contents.com/icon.png"), true)
})

test("isSafeFarfetchImageUrl rejects non-whitelisted hosts", () => {
  assert.equal(isSafeFarfetchImageUrl("https://evil.example.com/img.jpg"), false)
  assert.equal(isSafeFarfetchImageUrl("https://farfetch-contents.com.attacker.com/img.jpg"), false)
  assert.equal(isSafeFarfetchImageUrl("http://cdn-images.farfetch-contents.com/img.jpg"), false)
  assert.equal(isSafeFarfetchImageUrl(""), false)
  // @ts-expect-error testing non-string input
  assert.equal(isSafeFarfetchImageUrl(null), false)
})

test("isSafeFarfetchProductUrl accepts canonical KR pattern", () => {
  assert.equal(
    isSafeFarfetchProductUrl(
      "https://www.farfetch.com/kr/shopping/men/ralph-lauren-rrl--item-30688530.aspx",
      KR_BASE,
    ),
    true,
  )
  assert.equal(
    isSafeFarfetchProductUrl(
      "https://www.farfetch.com/kr/shopping/women/lemaire-item-30582033.aspx",
      KR_BASE,
    ),
    true,
  )
})

test("isSafeFarfetchProductUrl accepts canonical US pattern", () => {
  assert.equal(
    isSafeFarfetchProductUrl(
      "https://www.farfetch.com/shopping/men/dolce-gabbana--item-12345678.aspx",
      US_BASE,
    ),
    true,
  )
})

test("isSafeFarfetchProductUrl rejects malformed/cross-locale URLs", () => {
  // KR base should reject US URL
  assert.equal(
    isSafeFarfetchProductUrl("https://www.farfetch.com/shopping/men/x-item-1.aspx", KR_BASE),
    false,
  )
  // missing -item-
  assert.equal(
    isSafeFarfetchProductUrl("https://www.farfetch.com/kr/shopping/men/foo.aspx", KR_BASE),
    false,
  )
  // path traversal
  assert.equal(
    isSafeFarfetchProductUrl("https://www.farfetch.com/kr/shopping/men/../-item-1.aspx", KR_BASE),
    false,
  )
  // wrong gender
  assert.equal(
    isSafeFarfetchProductUrl("https://www.farfetch.com/kr/shopping/baby/x-item-1.aspx", KR_BASE),
    false,
  )
  // protocol mismatch
  assert.equal(
    isSafeFarfetchProductUrl("http://www.farfetch.com/kr/shopping/men/x-item-1.aspx", KR_BASE),
    false,
  )
})

test("buildFarfetchProductUrlPattern strips trailing slashes from baseUrl", () => {
  const re = buildFarfetchProductUrlPattern("https://www.farfetch.com/kr/")
  assert.ok(re.test("https://www.farfetch.com/kr/shopping/men/x-item-1.aspx"))
})

test("detectChallengeIntercept flags small body with challenge title", () => {
  const result = detectChallengeIntercept("<html>tiny</html>", "Just a moment...")
  assert.equal(result.isIntercept, true)
})

test("detectChallengeIntercept flags datadome body", () => {
  const result = detectChallengeIntercept("<html>blocked by datadome</html>", "")
  assert.equal(result.isIntercept, true)
})

test("detectChallengeIntercept flags access-denied 403", () => {
  const result = detectChallengeIntercept("<html>Access Denied</html>", "Access Denied")
  assert.equal(result.isIntercept, true)
})

test("detectChallengeIntercept passes large real product page", () => {
  const big = "x".repeat(50_000)
  const result = detectChallengeIntercept(big, "Men's Clothing | FARFETCH")
  assert.equal(result.isIntercept, false)
})

test("detectChallengeIntercept rejects non-string body", () => {
  // @ts-expect-error testing non-string input
  const result = detectChallengeIntercept(null, "")
  assert.equal(result.isIntercept, true)
})

test("deriveGenderFromUrl extracts gender from KR path", () => {
  assert.equal(deriveGenderFromUrl("https://www.farfetch.com/kr/shopping/men/items.aspx"), "men")
  assert.equal(deriveGenderFromUrl("https://www.farfetch.com/kr/shopping/women/clothing-1/items.aspx"), "women")
  assert.equal(deriveGenderFromUrl("https://www.farfetch.com/kr/shopping/kids/items.aspx"), "kids")
})

test("deriveGenderFromUrl extracts gender from US path", () => {
  assert.equal(deriveGenderFromUrl("https://www.farfetch.com/shopping/men/items.aspx"), "men")
  assert.equal(deriveGenderFromUrl("https://www.farfetch.com/shopping/women/clothing-1/items.aspx"), "women")
})

test("deriveGenderFromUrl returns empty for non-shopping URL", () => {
  assert.equal(deriveGenderFromUrl("https://www.farfetch.com/kr/terms-and-conditions/"), "")
  assert.equal(deriveGenderFromUrl(""), "")
})

test("parseFarfetchPrice parses KRW with comma separator", () => {
  assert.equal(parseFarfetchPrice("₩659,000", "KR"), 659000)
  assert.equal(parseFarfetchPrice("₩1,050,000", "KR"), 1050000)
})

test("parseFarfetchPrice picks LAST numeric token for sale price", () => {
  // Original ₩1,050,000 ; sale ₩630,000 — engine takes the last (sale).
  assert.equal(parseFarfetchPrice("₩1,050,000 ₩630,000", "KR"), 630000)
})

test("parseFarfetchPrice parses USD decimal", () => {
  assert.equal(parseFarfetchPrice("$659.00", "US"), 659.0)
  assert.equal(parseFarfetchPrice("$1,250.50", "US"), 1250.5)
})

test("parseFarfetchPrice returns null on invalid input", () => {
  assert.equal(parseFarfetchPrice("", "KR"), null)
  assert.equal(parseFarfetchPrice("free", "KR"), null)
  assert.equal(parseFarfetchPrice("$0.00", "US"), null)
})

test("formatFarfetchPrice emits region-correct format", () => {
  assert.equal(formatFarfetchPrice(659000, "KR"), "₩659,000")
  assert.equal(formatFarfetchPrice(659.0, "US"), "$659.00")
  assert.equal(formatFarfetchPrice(1250.5, "US"), "$1250.50")
})

test("pickFarfetchUserAgent rotates 5 distinct UAs", () => {
  const set = new Set<string>()
  for (let i = 0; i < 10; i++) set.add(pickFarfetchUserAgent(i))
  assert.equal(set.size, 5)
})

// ─── Drift guard: parser rejects synthetic non-card input ────

test("parseProductsFromCards drops cards missing required fields", () => {
  const cards: RawFarfetchCard[] = [
    {href: "", brand: "", name: "", priceText: "", imageUrl: ""},
    {href: "https://www.farfetch.com/kr/shopping/men/foo--item-1.aspx", brand: "X", name: "Y", priceText: "₩50,000", imageUrl: "https://evil.com/img.jpg"},
  ]
  const products = parseProductsFromCards(cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  assert.equal(products.length, 0)
})

test("parseProductsFromCards drops cards with out-of-range price", () => {
  const cards: RawFarfetchCard[] = [
    {
      href: "https://www.farfetch.com/kr/shopping/men/x--item-1.aspx",
      brand: "X", name: "Y",
      priceText: "₩100",  // below KRW_MIN
      imageUrl: "https://cdn-images.farfetch-contents.com/x.jpg",
    },
    {
      href: "https://www.farfetch.com/kr/shopping/men/x--item-2.aspx",
      brand: "X", name: "Y",
      priceText: "₩999,999,999",  // above KRW_MAX
      imageUrl: "https://cdn-images.farfetch-contents.com/x.jpg",
    },
  ]
  const products = parseProductsFromCards(cards, KR_BASE, "farfetch-kr", "KR", "KRW", "men")
  assert.equal(products.length, 0)
})
