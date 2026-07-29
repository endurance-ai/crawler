/**
 * Unit tests for the SPEC-ARCH-CRAWLER-001 Phase 3 (REQ-CRAWLER-004)
 * parser-strategy DI layer.
 *
 * SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-004.
 * Runs via: npm test (node --test --import tsx ./tests/*.test.ts)
 *
 * SCOPE — these are NEW-CODE tests for the strategy/DI seam itself:
 *   1. DI container resolves strategies by platform key (and fails loud
 *      on an unknown key).
 *   2. The shopify adapter delegates to `parseShopifyProducts`
 *      byte-identically (deep-equal vs calling the wrapped function
 *      directly with the same args — proves the wrap adds zero drift;
 *      the Stage-0 goldens separately lock the wrapped function itself).
 *   3. The uniqlo adapter delegates to `parseProducts` byte-identically.
 *   4. The cafe24-detail adapter resolves the SAME Phase 2 parser the
 *      live path uses (`getDetailParser`) and its `.parse` delegates
 *      verbatim — verified deterministically with a Page stub (no
 *      browser); the 18 detail goldens separately lock the wrapped path.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"
import type {Cafe24Page} from "../src/lib/cafe24-page"

import {
  ParserRegistry,
  defaultParserRegistry,
  ShopifyParserStrategy,
  UniqloParserStrategy,
  Cafe24DetailParserStrategy,
  type ShopifyParseInput,
  type UniqloParseInput,
  type Cafe24DetailInput,
} from "../src/lib/parsers/parser-strategy"
import {parseShopifyProducts} from "../src/lib/shopify-engine"
import {parseProducts} from "../src/lib/uniqlo-engine"
import {getDetailParser} from "../src/lib/parsers/detail"
import type {Product} from "../src/lib/types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOPIFY_FIXTURE = path.join(__dirname, "fixtures", "shopify-products.fixture.json")
const UNIQLO_FIXTURE = path.join(__dirname, "fixtures", "uniqlo-kr-products.fixture.json")

function normalize(products: Product[]): Product[] {
  return products.map((p) => ({...p, crawledAt: "<<NORMALIZED>>"}))
}

// ─── 1. DI container resolution ──────────────────────────────────

test("REQ-004 ParserRegistry: resolve() returns the registered strategy by key", () => {
  const shopify = defaultParserRegistry.resolve("shopify")
  const uniqlo = defaultParserRegistry.resolve("uniqlo")
  const cafe24 = defaultParserRegistry.resolve("cafe24-detail")

  assert.ok(shopify instanceof ShopifyParserStrategy, "shopify key must resolve ShopifyParserStrategy")
  assert.ok(uniqlo instanceof UniqloParserStrategy, "uniqlo key must resolve UniqloParserStrategy")
  assert.ok(
    cafe24 instanceof Cafe24DetailParserStrategy,
    "cafe24-detail key must resolve Cafe24DetailParserStrategy",
  )
  assert.equal(shopify.platform, "shopify")
  assert.equal(uniqlo.platform, "uniqlo")
  assert.equal(cafe24.platform, "cafe24-detail")
})

test("REQ-004 ParserRegistry: has()/keys() report the three live platforms", () => {
  assert.equal(defaultParserRegistry.has("shopify"), true)
  assert.equal(defaultParserRegistry.has("uniqlo"), true)
  assert.equal(defaultParserRegistry.has("cafe24-detail"), true)
  assert.equal(defaultParserRegistry.has("does-not-exist"), false)
  assert.deepEqual(
    [...defaultParserRegistry.keys()].sort(),
    ["cafe24-detail", "shopify", "uniqlo"],
  )
})

test("REQ-004 ParserRegistry: resolve() throws loud on an unknown platform key", () => {
  assert.throws(
    () => defaultParserRegistry.resolve("site-33-unregistered"),
    /no strategy registered for platform key "site-33-unregistered"/,
  )
})

test("REQ-004 ParserRegistry: register() adds a new platform without touching dispatch (extension point)", () => {
  const reg = new ParserRegistry()
  const sentinel: Product[] = []
  reg.register<{x: number}, Product[]>("newsite", () => ({
    platform: "newsite",
    parse: () => sentinel,
  }))
  assert.equal(reg.has("newsite"), true)
  const s = reg.resolve<{x: number}, Product[]>("newsite")
  assert.equal(s.platform, "newsite")
  assert.equal(s.parse({x: 1}), sentinel)
  // resolve() yields a fresh instance each call (factory semantics)
  assert.notEqual(reg.resolve("newsite"), reg.resolve("newsite"))
})

// ─── 2. Shopify adapter delegates byte-identically ───────────────

test("REQ-004 ShopifyParserStrategy.parse equals parseShopifyProducts(...) byte-for-byte", () => {
  const productsJson = JSON.parse(
    fs.readFileSync(SHOPIFY_FIXTURE, "utf-8"),
  ) as Parameters<typeof parseShopifyProducts>[0]
  const baseUrl = "https://shop.example-store.com"
  const key = "shopify-test"
  const options = {
    sourceCurrency: "USD" as const,
    defaultGender: [] as string[],
    brandFallback: "Example Store",
  }

  const direct = normalize(parseShopifyProducts(productsJson, baseUrl, key, options))

  const strategy = defaultParserRegistry.resolve<ShopifyParseInput, Product[]>("shopify")
  const viaStrategy = normalize(
    strategy.parse({productsJson, baseUrl, platformKey: key, options}) as Product[],
  )

  assert.deepEqual(
    viaStrategy,
    direct,
    "ShopifyParserStrategy MUST be a verbatim pass-through (zero drift vs parseShopifyProducts)",
  )
})

test("REQ-004 ShopifyParserStrategy: omitted options preserves the wrapped `= {}` default", () => {
  const productsJson = JSON.parse(
    fs.readFileSync(SHOPIFY_FIXTURE, "utf-8"),
  ) as Parameters<typeof parseShopifyProducts>[0]
  const baseUrl = "https://shop.example-store.com"
  const key = "shopify-test"

  const direct = normalize(parseShopifyProducts(productsJson, baseUrl, key))
  const strategy = new ShopifyParserStrategy()
  const viaStrategy = normalize(
    strategy.parse({productsJson, baseUrl, platformKey: key}),
  )
  assert.deepEqual(viaStrategy, direct, "missing options must fall through to wrapped default")
})

// ─── 3. Uniqlo adapter delegates byte-identically ────────────────

test("REQ-004 UniqloParserStrategy.parse equals parseProducts(...) byte-for-byte", () => {
  const json = JSON.parse(
    fs.readFileSync(UNIQLO_FIXTURE, "utf-8"),
  ) as Parameters<typeof parseProducts>[0]
  const baseUrl = "https://www.uniqlo.com/kr/ko"
  const key = "uniqlo-kr"

  const direct = normalize(parseProducts(json, baseUrl, key, "KR"))
  const strategy = defaultParserRegistry.resolve<UniqloParseInput, Product[]>("uniqlo")
  const viaStrategy = normalize(
    strategy.parse({json, baseUrl, platformKey: key, region: "KR"}) as Product[],
  )

  assert.deepEqual(
    viaStrategy,
    direct,
    "UniqloParserStrategy MUST be a verbatim pass-through (zero drift vs parseProducts)",
  )
})

test("REQ-004 UniqloParserStrategy: omitted region preserves the wrapped `= \"KR\"` default", () => {
  const json = JSON.parse(
    fs.readFileSync(UNIQLO_FIXTURE, "utf-8"),
  ) as Parameters<typeof parseProducts>[0]
  const baseUrl = "https://www.uniqlo.com/kr/ko"
  const key = "uniqlo-kr"

  const direct = normalize(parseProducts(json, baseUrl, key))
  const strategy = new UniqloParserStrategy()
  const viaStrategy = normalize(strategy.parse({json, baseUrl, platformKey: key}))
  assert.deepEqual(viaStrategy, direct, "missing region must fall through to wrapped default")
})

// ─── 4. Cafe24 detail adapter routes through the Phase 2 path ─────

test("REQ-004 Cafe24DetailParserStrategy resolves the SAME Phase 2 parser as getDetailParser", () => {
  const strategy = new Cafe24DetailParserStrategy()
  for (const site of ["eastlogue", "blankroom", "shopamomento", "8division"]) {
    const viaStrategy = strategy.resolveDetailParser(site)
    const viaLive = getDetailParser(site)
    assert.equal(
      viaStrategy.constructor,
      viaLive.constructor,
      `cafe24-detail adapter must resolve the identical Phase 2 parser class for "${site}"`,
    )
  }
})

test("REQ-004 Cafe24DetailParserStrategy.parse delegates verbatim to getDetailParser(site).parse", async () => {
  // RegistryDetailParser.parse wraps everything in try/catch and returns
  // an all-null DetailData on any failure. A Page stub whose goto throws
  // drives BOTH paths down the identical catch branch, so equality here
  // proves the adapter calls the same parser the same way (the 18 live
  // detail goldens separately lock the success path field-for-field).
  const failingPage = {
    goto: async () => {
      throw new Error("stub: navigation suppressed (deterministic delegation probe)")
    },
  } as unknown as Cafe24Page

  const site = "eastlogue"
  const url = "https://example.test/product/1"

  const viaLive = await getDetailParser(site).parse(failingPage, url)
  const strategy = new Cafe24DetailParserStrategy()
  const viaStrategy = await strategy.parse({site, page: failingPage, productUrl: url} as Cafe24DetailInput)

  assert.deepEqual(
    viaStrategy,
    viaLive,
    "Cafe24DetailParserStrategy MUST delegate verbatim to getDetailParser(site).parse",
  )
  assert.deepEqual(viaStrategy, {
    material: null,
    productCode: null,
  })
})
