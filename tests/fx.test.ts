/**
 * FX module unit tests.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-005 — pre-lift / post-lift
 *   numeric-equivalence check for the FX_TO_KRW table after lifting it
 *   from shopify-engine.ts into the shared src/lib/fx.ts module.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {convertToKrw, FX_TO_KRW} from "../src/lib/fx"

test("REQ-005 convertToKrw: USD/EUR/GBP integer outputs match Math.round(price * rate)", () => {
  assert.equal(convertToKrw(29.9, "USD"), 42757)
  assert.equal(convertToKrw(100, "EUR"), 156000)
  assert.equal(convertToKrw(100, "GBP"), 175000)
})

test("REQ-005 convertToKrw: KRW pass-through (rate=1)", () => {
  assert.equal(convertToKrw(1000, "KRW"), 1000)
})

test("REQ-005 convertToKrw: unknown currency returns null", () => {
  assert.equal(convertToKrw(100, "ZZZ"), null)
  assert.equal(convertToKrw(100, "JPY"), null)
})

test("REQ-005 FX_TO_KRW: table has expected baseline rates (POC-grade, 2026-04)", () => {
  assert.equal(FX_TO_KRW.USD, 1430)
  assert.equal(FX_TO_KRW.EUR, 1560)
  assert.equal(FX_TO_KRW.GBP, 1750)
  assert.equal(FX_TO_KRW.KRW, 1)
})
