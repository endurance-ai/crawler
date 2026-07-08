import assert from "node:assert/strict"
import {test} from "node:test"

import {
  DEFAULT_CHROMIUM_CAFE24_PARALLEL,
  DEFAULT_LIGHTPANDA_CAFE24_PARALLEL,
  cafe24DetailConcurrency,
  cafe24ParallelLimitFor,
  parseCafe24EngineMode,
  parsePositiveInt,
} from "../src/lib/cafe24-engine-selection"
import {translateCafe24WaitUntil} from "../src/lib/cafe24-page"

test("Cafe24 engine mode defaults to chromium and accepts lightpanda/auto", () => {
  assert.equal(parseCafe24EngineMode(undefined), "chromium")
  assert.equal(parseCafe24EngineMode(""), "chromium")
  assert.equal(parseCafe24EngineMode("chromium"), "chromium")
  assert.equal(parseCafe24EngineMode("lightpanda"), "lightpanda")
  assert.equal(parseCafe24EngineMode("auto"), "auto")
  assert.equal(parseCafe24EngineMode("firefox"), "chromium")
})

test("Cafe24 parallel limit uses engine-specific env knobs", () => {
  assert.equal(cafe24ParallelLimitFor("chromium", {}), DEFAULT_CHROMIUM_CAFE24_PARALLEL)
  assert.equal(cafe24ParallelLimitFor("lightpanda", {}), DEFAULT_LIGHTPANDA_CAFE24_PARALLEL)
  assert.equal(cafe24ParallelLimitFor("auto", {CRAWLER_CAFE24_LIGHTPANDA_PARALLEL: "12"}), 12)
  assert.equal(cafe24ParallelLimitFor("chromium", {CRAWLER_CAFE24_PARALLEL: "5"}), 5)
})

test("Cafe24 numeric env parser rejects invalid values", () => {
  assert.equal(parsePositiveInt("8", 3), 8)
  assert.equal(parsePositiveInt("0", 3), 3)
  assert.equal(parsePositiveInt("-1", 3), 3)
  assert.equal(parsePositiveInt("2.5", 3), 3)
  assert.equal(parsePositiveInt("abc", 3), 3)
})

test("Cafe24 detail concurrency has an explicit env override", () => {
  assert.equal(cafe24DetailConcurrency({}), 3)
  assert.equal(cafe24DetailConcurrency({CRAWLER_CAFE24_DETAIL_CONCURRENCY: "4"}), 4)
})

test("Cafe24 waitUntil values map to Puppeteer-compatible values", () => {
  assert.equal(translateCafe24WaitUntil("commit"), "domcontentloaded")
  assert.equal(translateCafe24WaitUntil("networkidle"), "networkidle0")
  assert.equal(translateCafe24WaitUntil("domcontentloaded"), "domcontentloaded")
  assert.equal(translateCafe24WaitUntil(undefined), undefined)
})
