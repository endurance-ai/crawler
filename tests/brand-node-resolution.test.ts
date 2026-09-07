import assert from "node:assert/strict"
import test from "node:test"
import {
  canUsePlatformBrandFallback,
  resolveProductBrandNodeIdFromMaps,
} from "../src/lib/brand-node-resolution"

const brandIds = new Map([
  ["sculptor", 834],
  ["vans", 9001],
])
const platformIds = new Map([
  ["sculpstore", 834],
  ["single-brand-shop", 123],
])
const retailers = new Set(["sculpstore"])

test("retailer products resolve by their exact product brand", () => {
  assert.equal(
    resolveProductBrandNodeIdFromMaps("VANS", "sculpstore", brandIds, platformIds, retailers),
    9001,
  )
})

test("retailer products resolve safe compact brand aliases", () => {
  const aliases = new Map([["compact:justhaus", 5209]])
  assert.equal(
    resolveProductBrandNodeIdFromMaps("Just Haus", "sculpstore", aliases, platformIds, retailers),
    5209,
  )
})

test("retailer products never fall back to the retailer's historical platform mapping", () => {
  assert.equal(
    resolveProductBrandNodeIdFromMaps("UNKNOWN LABEL", "sculpstore", brandIds, platformIds, retailers),
    null,
  )
  assert.equal(canUsePlatformBrandFallback("sculpstore", retailers), false)
})

test("single-brand platforms retain their platform-level fallback", () => {
  assert.equal(
    resolveProductBrandNodeIdFromMaps("UNEXTRACTED", "single-brand-shop", brandIds, platformIds, retailers),
    123,
  )
  assert.equal(canUsePlatformBrandFallback("single-brand-shop", retailers), true)
})

test("single-brand platforms prefer their platform mapping over a duplicate exact brand name", () => {
  const duplicateBrandIds = new Map([["opening project", 2503]])
  const crawlPlatformIds = new Map([["opening-project", 2563]])
  assert.equal(
    resolveProductBrandNodeIdFromMaps(
      "Opening Project",
      "opening-project",
      duplicateBrandIds,
      crawlPlatformIds,
      retailers,
    ),
    2563,
  )
})
