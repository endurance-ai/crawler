/**
 * Golden-master characterization test for the Uniqlo parse strategy.
 *
 * SPEC: SPEC-ARCH-CRAWLER-001 — pre-phase-3 (parser-strategy DI) gate.
 * Runs via: pnpm test (node --test --import tsx ./tests/*.test.ts)
 *
 * PURPOSE (DDD PRESERVE phase)
 * ---------------------------
 * SPEC-ARCH-CRAWLER-001 mandates characterization tests for 3
 * representative platforms (cafe24 + shopify + uniqlo) BEFORE the
 * parser-strategy DI refactor (phase 3). This file locks the full
 * Product[] output of uniqlo-engine.parseProducts() as a byte-identical
 * golden master so the strategy extraction can prove zero behavior
 * change.
 *
 * NORMALIZATION
 * -------------
 * parseProducts() stamps `crawledAt = new Date().toISOString()` once
 * per call (non-deterministic). Every product's crawledAt is mapped to
 * the sentinel "<<NORMALIZED>>" before comparison; the timestamp's
 * shape (valid ISO-8601, single value per call) is asserted separately
 * so the side effect is still characterized.
 *
 * Fixtures:
 *   tests/fixtures/uniqlo-kr-products.fixture.json — existing recorded
 *     Uniqlo KR API payload (reused; pre-existing repo fixture).
 *   tests/fixtures/uniqlo-kr-parse.golden.json — current parseProducts
 *     output, crawledAt-normalized, captured 2026-05-16 from unmodified
 *     code.
 *
 * NOTE — cafe24 + shopify gate status: see this file's companion report.
 * The cafe24-family detail layer is characterized by
 * detail-parsers.characterization.test.ts (18 site parsers route
 * through getDetailParser()). The Shopify parse path
 * (shopify-engine.ts) exposes NO pure/public seam — its variant
 * mapping, price, and image logic live inside an un-exported
 * crawlShopify() consuming live fetch — so a byte-identical Shopify
 * snapshot cannot be captured without an IMPROVE-phase export seam or a
 * live probe. That is documented as a PRESERVE blocker, not stubbed.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {parseProducts} from "../src/lib/uniqlo-engine"
import type {Product} from "../src/lib/types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, "fixtures", "uniqlo-kr-products.fixture.json")
const GOLDEN_PATH = path.join(__dirname, "fixtures", "uniqlo-kr-parse.golden.json")
const BASE_URL = "https://www.uniqlo.com/kr/ko"
const KEY = "uniqlo-kr"

function loadFixture(): unknown {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"))
}

function loadGolden(): Product[] {
  return JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf-8")) as Product[]
}

function normalize(products: Product[]): Product[] {
  return products.map((p) => {
    // genderSource is a new persistence-provenance field and is tested
    // separately; omit it from the pre-existing parser golden master.
    const {genderSource: _genderSource, ...legacyShape} = p
    return {...legacyShape, crawledAt: "<<NORMALIZED>>"}
  })
}

// ─── Golden-master: full Product[] output is byte-identical ─────

test("characterize_uniqlo_parseProducts_KR_fixture_matches_golden", () => {
  const fixture = loadFixture() as Parameters<typeof parseProducts>[0]
  const actual = normalize(parseProducts(fixture, BASE_URL, KEY, "KR"))
  const golden = loadGolden()

  assert.equal(
    actual.length,
    golden.length,
    `product count drift: actual ${actual.length} vs golden ${golden.length}`,
  )
  assert.deepEqual(
    actual,
    golden,
    "BEHAVIOR DRIFT: uniqlo parseProducts output diverged from the " +
      "SPEC-ARCH-CRAWLER-001 golden master. A parser-strategy refactor " +
      "must be byte-identical — do NOT regenerate the golden.",
  )
})

// ─── Side-effect characterization: crawledAt stamping ──────────

test("characterize: crawledAt is one valid ISO-8601 value per call", () => {
  const fixture = loadFixture() as Parameters<typeof parseProducts>[0]
  const products = parseProducts(fixture, BASE_URL, KEY, "KR")
  assert.ok(products.length > 0, "fixture produced zero products")

  const stamps = new Set(products.map((p) => p.crawledAt))
  assert.equal(stamps.size, 1, "crawledAt must be a single value across one parse call")

  const stamp = products[0].crawledAt
  assert.equal(
    stamp,
    new Date(stamp).toISOString(),
    `crawledAt is not a round-trip-stable ISO-8601 string: ${stamp}`,
  )
})

// ─── Output contract invariants (characterized, not corrected) ──

test("characterize: every product carries platform/key + KRW shape", () => {
  const fixture = loadFixture() as Parameters<typeof parseProducts>[0]
  const products = parseProducts(fixture, BASE_URL, KEY, "KR")
  for (const p of products) {
    assert.equal(p.platform, KEY, `platform drift for ${p.productUrl}`)
    assert.ok(
      p.productUrl.startsWith(`${BASE_URL}/products/`),
      `productUrl base drift: ${p.productUrl}`,
    )
    assert.ok(Array.isArray(p.gender), `gender must be array for ${p.productUrl}`)
  }
})
