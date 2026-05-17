/**
 * Golden-master characterization test for the Shopify parse seam.
 *
 * SPEC: SPEC-ARCH-CRAWLER-001 — pre-phase-3 (parser-strategy DI) gate,
 *       Stage 0 (the sole non-pure→pure refactor of live-fetch code).
 * Runs via: npm test (node --test --import tsx ./tests/*.test.ts)
 *
 * PURPOSE (DDD PRESERVE phase)
 * ---------------------------
 * The Shopify variant→Product mapping (variant pick, price/option
 * handling, image-host whitelist, gender/tag/description) was formerly
 * private inside the un-exported `crawlShopify()` consuming live `fetch`.
 * SPEC-ARCH-CRAWLER-001's HARD characterization gate (cafe24 + shopify +
 * uniqlo) requires a byte-identical Shopify snapshot before the
 * parser-strategy DI refactor. Stage 0 extracted that mapping VERBATIM
 * into the pure `parseShopifyProducts()`; this file locks its full
 * `Product[]` output as a golden master so the strategy extraction can
 * prove zero behavior change.
 *
 * NORMALIZATION
 * -------------
 * `parseShopifyProducts()` stamps `crawledAt = new Date().toISOString()`
 * per product (non-deterministic — preserved verbatim from the original
 * inline loop, NOT hoisted). Every product's crawledAt is mapped to the
 * sentinel "<<NORMALIZED>>" before comparison; the timestamp's shape
 * (valid ISO-8601) is asserted separately so the side effect is still
 * characterized. Mirrors tests/uniqlo-parse-strategy.characterization.test.ts.
 *
 * Fixtures:
 *   tests/fixtures/shopify-products.fixture.json — recorded representative
 *     Shopify /products.json payload exercising every mapping branch
 *     (variant pick, sold-out, image whitelist accept+reject, option
 *     parsing, skip rules, currency, brand fallback).
 *   tests/fixtures/shopify-parse.golden.json — current parseShopifyProducts
 *     output, crawledAt-normalized, captured 2026-05-17 from the verbatim
 *     extraction. Do NOT regenerate on drift — a parser-strategy refactor
 *     must be byte-identical.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {parseShopifyProducts} from "../src/lib/shopify-engine"
import type {Product} from "../src/lib/types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, "fixtures", "shopify-products.fixture.json")
const GOLDEN_PATH = path.join(__dirname, "fixtures", "shopify-parse.golden.json")
const KRW_GOLDEN_PATH = path.join(__dirname, "fixtures", "shopify-parse.krw.golden.json")
const BASE_URL = "https://shop.example-store.com"
const KEY = "shopify-test"
const PARSE_OPTIONS = {
  sourceCurrency: "USD" as const,
  defaultGender: [] as string[],
  brandFallback: "Example Store",
}
// Production shopify sites default to KRW (`config.sourceCurrency || "KRW"`
// in crawlShopify). Same option values as the USD case — only the currency
// differs — so the KRW `srcPrice.toLocaleString("ko-KR")` + ₩ branch (the
// production-dominant path) is locked. Captured 2026-05-17 from the verbatim
// extraction; do NOT regenerate on drift (must be byte-identical).
const KRW_PARSE_OPTIONS = {
  sourceCurrency: "KRW" as const,
  defaultGender: [] as string[],
  brandFallback: "Example Store",
}

const IMAGE_HOST_WHITELIST = (host: string, baseHost: string): boolean =>
  host === baseHost ||
  host === "cdn.shopify.com" ||
  host.endsWith(".myshopify.com") ||
  host.endsWith(".shopifycdn.com")

function loadFixture(): Parameters<typeof parseShopifyProducts>[0] {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"))
}

function loadGolden(): Product[] {
  return JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf-8")) as Product[]
}

function loadKrwGolden(): Product[] {
  return JSON.parse(fs.readFileSync(KRW_GOLDEN_PATH, "utf-8")) as Product[]
}

/**
 * Normalize for golden comparison at the *persistence boundary*.
 *
 * `parseShopifyProducts` (verbatim from the original inline loop) always
 * assigns the optional fields (`description`/`color`/`sizeInfo`/`images`/
 * `tags`), sometimes with the value `undefined`. The crawler's downstream
 * write path (`JSON.stringify` → JSON file / DB upsert) drops
 * `undefined`-valued keys. The SPEC's "byte-identical crawl output JSON"
 * contract is therefore defined at the serialized boundary, so we compare
 * the JSON round-trip (which also strips the `undefined` keys exactly as
 * the persisted golden was written) rather than in-memory object shape.
 * crawledAt (non-deterministic per-product stamp, preserved verbatim) is
 * mapped to the sentinel before serialization.
 */
function normalize(products: Product[]): Product[] {
  return JSON.parse(
    JSON.stringify(products.map((p) => ({...p, crawledAt: "<<NORMALIZED>>"}))),
  ) as Product[]
}

// ─── Golden-master: full Product[] output is byte-identical ─────

test("characterize_shopify_parseShopifyProducts_fixture_matches_golden", () => {
  const fixture = loadFixture()
  const actual = normalize(parseShopifyProducts(fixture, BASE_URL, KEY, PARSE_OPTIONS))
  const golden = loadGolden()

  assert.equal(
    actual.length,
    golden.length,
    `product count drift: actual ${actual.length} vs golden ${golden.length}`,
  )
  assert.deepEqual(
    actual,
    golden,
    "BEHAVIOR DRIFT: shopify parseShopifyProducts output diverged from the " +
      "SPEC-ARCH-CRAWLER-001 golden master. A parser-strategy refactor " +
      "must be byte-identical — do NOT regenerate the golden.",
  )
})

test("characterize_shopify_parseShopifyProducts_KRW_fixture_matches_golden", () => {
  const fixture = loadFixture()
  const actual = normalize(parseShopifyProducts(fixture, BASE_URL, KEY, KRW_PARSE_OPTIONS))
  const golden = loadKrwGolden()

  assert.equal(
    actual.length,
    golden.length,
    `product count drift: actual ${actual.length} vs golden ${golden.length}`,
  )
  assert.deepEqual(
    actual,
    golden,
    "BEHAVIOR DRIFT: shopify parseShopifyProducts KRW output diverged from " +
      "the SPEC-ARCH-CRAWLER-001 KRW golden master. KRW is the " +
      "production-dominant path (config.sourceCurrency || \"KRW\"). A " +
      "parser-strategy refactor must be byte-identical — do NOT regenerate " +
      "the golden.",
  )
})

// ─── Side-effect characterization: crawledAt stamping ──────────

test("characterize: shopify crawledAt is a valid ISO-8601 value per product", () => {
  const fixture = loadFixture()
  const products = parseShopifyProducts(fixture, BASE_URL, KEY, PARSE_OPTIONS)
  assert.ok(products.length > 0, "fixture produced zero products")

  for (const p of products) {
    assert.equal(
      p.crawledAt,
      new Date(p.crawledAt).toISOString(),
      `crawledAt is not a round-trip-stable ISO-8601 string: ${p.crawledAt}`,
    )
  }
})

// ─── Output contract invariants (characterized, not corrected) ──

test("characterize: every shopify product carries platform/key + USD shape + whitelisted images", () => {
  const fixture = loadFixture()
  const products = parseShopifyProducts(fixture, BASE_URL, KEY, PARSE_OPTIONS)
  const baseHost = new URL(BASE_URL).hostname

  assert.ok(products.length > 0, "fixture produced zero products")

  for (const p of products) {
    // Required Product fields present with expected shapes.
    assert.equal(typeof p.brand, "string")
    assert.ok(p.brand.length > 0, `empty brand for ${p.productUrl}`)
    assert.equal(typeof p.name, "string")
    assert.ok(p.name.length > 0, `empty name for ${p.productUrl}`)
    assert.equal(typeof p.category, "string")
    assert.ok(
      p.price === null || typeof p.price === "number",
      `price must be number|null for ${p.productUrl}`,
    )
    assert.equal(p.salePrice, null)
    assert.equal(typeof p.priceFormatted, "string")
    assert.equal(typeof p.imageUrl, "string")
    assert.ok(
      p.productUrl.startsWith(`${BASE_URL}/products/`),
      `productUrl base drift: ${p.productUrl}`,
    )
    assert.equal(typeof p.inStock, "boolean")
    assert.ok(Array.isArray(p.gender), `gender must be array for ${p.productUrl}`)
    assert.equal(p.platform, KEY, `platform drift for ${p.productUrl}`)
    assert.equal(p.sourceCurrency, "USD", `sourceCurrency drift for ${p.productUrl}`)

    // USD shape: priceFormatted uses $ + 2-decimal fixed (never ₩).
    if (p.price !== null) {
      assert.ok(!p.priceFormatted.includes("₩"), `USD priceFormatted should not contain ₩: ${p.priceFormatted}`)
      assert.match(p.priceFormatted, /^\$\d+\.\d{2}$/, `USD priceFormatted shape drift: ${p.priceFormatted}`)
    }

    // Image-host whitelist invariant: every emitted image (primary +
    // secondary) is on the Shopify/store-host whitelist.
    if (p.imageUrl.length > 0) {
      assert.ok(
        IMAGE_HOST_WHITELIST(new URL(p.imageUrl).hostname, baseHost),
        `imageUrl host not whitelisted: ${p.imageUrl}`,
      )
    }
    for (const img of p.images ?? []) {
      assert.ok(img.startsWith("https://"), `secondary image must be https: ${img}`)
      assert.ok(
        IMAGE_HOST_WHITELIST(new URL(img).hostname, baseHost),
        `secondary image host not whitelisted: ${img}`,
      )
    }
  }
})

test("characterize: shopify skip-rules exclude lookbook/gift-card/Rise.ai/unsafe-handle", () => {
  const fixture = loadFixture()
  const products = parseShopifyProducts(fixture, BASE_URL, KEY, PARSE_OPTIONS)

  // 8 fixture products → 4 survive (lookbook, gift card, Rise.ai, and the
  // unsafe-handle product are all dropped). This locks the exclusion set.
  const handles = products.map((p) => p.productUrl.split("/products/")[1])
  assert.deepEqual(
    handles,
    ["oxford-cotton-shirt", "sold-out-wool-coat", "plain-basic-tee", "trail-running-shoe"],
    "skip-rule set drift: expected lookbook/gift-card/Rise.ai/unsafe-handle excluded",
  )
})
