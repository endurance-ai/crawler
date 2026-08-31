/**
 * FX module unit tests.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-005.
 *
 * 2026-08-26: rewritten when the pinned 2026-04 table was replaced by live
 * rates. The regression these guard is the 2026-08 currency incident — 1,201
 * rows whose USD/EUR/JPY/EGP amounts were stored verbatim as KRW. Two of the
 * three failure modes lived here: JPY had no rate at all (so every JPY
 * product was silently dropped at import), and the USD/EUR/GBP rates had
 * drifted 3-8% from the market.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {
  convertToKrw,
  fxRateToKrw,
  getFxRateTable,
  initFxRates,
  parseFxResponse,
  resetFxRates,
  ZERO_DECIMAL_CURRENCIES,
} from "../src/lib/fx"
import {FX_SNAPSHOT_RATES} from "../src/configs/fx-rates.snapshot"

/** Shape of a real `open.er-api.com/v6/latest/USD` response, trimmed. */
function erApiPayload(overrides: Record<string, unknown> = {}) {
  return {
    result: "success",
    base_code: "USD",
    time_last_update_utc: "Wed, 26 Aug 2026 00:02:31 +0000",
    rates: {USD: 1, KRW: 1383.1175, EUR: 0.8569, GBP: 0.7330, JPY: 159.2437, EGP: 50.4234},
    ...overrides,
  }
}

function stubFetch(payload: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => payload,
  })) as unknown as typeof fetch
}

test("parseFxResponse: USD-based payload becomes KRW-per-unit rates", () => {
  const table = parseFxResponse(erApiPayload())
  assert.ok(table)
  assert.equal(table.live, true)
  assert.equal(table.rates.KRW, 1)
  // 1 USD = rates.KRW / rates.USD
  assert.equal(table.rates.USD, 1383.1175)
  // 1 JPY = 1383.1175 / 159.2437 ≈ 8.685
  assert.ok(Math.abs(table.rates.JPY! - 8.6857) < 0.001, `JPY rate was ${table.rates.JPY}`)
  assert.ok(Math.abs(table.rates.EUR! - 1614.09) < 0.1, `EUR rate was ${table.rates.EUR}`)
})

test("parseFxResponse: rejects degraded payloads instead of publishing a partial table", () => {
  assert.equal(parseFxResponse(erApiPayload({result: "error"})), null)
  assert.equal(parseFxResponse(erApiPayload({rates: {USD: 1, EUR: 0.85}})), null, "no KRW rate")
  assert.equal(parseFxResponse(erApiPayload({rates: {USD: 1, KRW: 1383}})), null, "no majors")
  assert.equal(parseFxResponse(null), null)
  assert.equal(parseFxResponse({rates: "nope"}), null)
})

test("initFxRates: installs live rates and convertToKrw uses them", async () => {
  resetFxRates()
  await initFxRates({fetchImpl: stubFetch(erApiPayload()), force: true})
  assert.equal(getFxRateTable().live, true)
  assert.equal(convertToKrw(100, "USD"), 138312)
  // 4,800 JPY (howly-dog.jp의 HYDRO COOL NECK) → 약 4.2만원
  assert.equal(convertToKrw(4800, "JPY"), Math.round(4800 * (1383.1175 / 159.2437)))
  resetFxRates()
})

test("initFxRates: a dead rate API falls back to the snapshot rather than halting the crawl", async () => {
  resetFxRates()
  const table = await initFxRates({
    fetchImpl: (() => Promise.reject(new Error("ENOTFOUND"))) as unknown as typeof fetch,
    force: true,
  })
  assert.equal(table.live, false)
  assert.equal(table.source, "snapshot")
  // 스냅샷으로도 환산은 계속돼야 한다 — null 을 리턴하면 해외 상품이 통째로 드롭된다.
  assert.equal(typeof convertToKrw(100, "USD"), "number")
  assert.equal(typeof convertToKrw(4800, "JPY"), "number")
  resetFxRates()
})

test("initFxRates: an HTTP error response also falls back", async () => {
  resetFxRates()
  const table = await initFxRates({fetchImpl: stubFetch(erApiPayload(), false), force: true})
  assert.equal(table.live, false)
  resetFxRates()
})

test("convertToKrw: JPY converts (was null before 2026-08 — every JPY product was dropped)", () => {
  resetFxRates()
  assert.notEqual(convertToKrw(1650, "JPY"), null)
  assert.notEqual(convertToKrw(100, "EGP"), null)
})

test("convertToKrw: KRW passes through untouched", () => {
  resetFxRates()
  assert.equal(convertToKrw(1000, "KRW"), 1000)
  assert.equal(fxRateToKrw("KRW"), 1)
})

test("convertToKrw: a currency with no rate returns null, never a bare pass-through", () => {
  resetFxRates()
  assert.equal(convertToKrw(100, "ZZZ"), null)
  // 이게 핵심이다: 환산 못 하는 값을 "원화겠지"로 통과시키면 통화 사고가 재발한다.
  assert.notEqual(convertToKrw(100, "ZZZ"), 100)
})

test("convertToKrw: case-insensitive ISO code", () => {
  resetFxRates()
  assert.equal(convertToKrw(100, "usd"), convertToKrw(100, "USD"))
})

test("snapshot covers every currency observed in the catalogue", () => {
  for (const code of ["KRW", "USD", "EUR", "GBP", "JPY", "EGP"]) {
    assert.ok(FX_SNAPSHOT_RATES[code]! > 0, `snapshot missing ${code}`)
  }
})

test("ZERO_DECIMAL_CURRENCIES: KRW and JPY have no minor unit", () => {
  assert.ok(ZERO_DECIMAL_CURRENCIES.has("KRW"))
  assert.ok(ZERO_DECIMAL_CURRENCIES.has("JPY"))
  assert.ok(!ZERO_DECIMAL_CURRENCIES.has("USD"))
})
