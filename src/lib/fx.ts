/**
 * Shared FX (foreign exchange) rates and conversion utilities.
 *
 * Both `shopify-engine.ts` (engine time, for the price symbol/format) and
 * `import-products.ts` (upsert time, via `toDbPriceFields`) read the same
 * table so a product's KRW value is derived exactly once, from one rate.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-005
 *
 * 2026-08-26: replaced the hardcoded 2026-04 table with live rates fetched
 * once per run. The pinned table had drifted 3-8% (USD 1430 vs 1383, EUR
 * 1560 vs 1614, GBP 1750 vs 1887) and covered only USD/EUR/GBP/KRW, so
 * every JPY/EGP/... product hit the `unknown currency` branch and was
 * dropped at import. `FX_SNAPSHOT_RATES` is now only the offline fallback.
 *
 * @MX:ANCHOR: convertToKrw is the single KRW conversion for every ingest
 *   path (import-products, refresh-candidate-import, repair tools).
 * @MX:REASON: fan_in >= 3 and it sits on the write path — a wrong rate here
 *   silently mis-prices the catalogue, which is exactly the incident this
 *   module was rewritten for.
 */

import {FX_SNAPSHOT_FETCHED_AT, FX_SNAPSHOT_RATES, FX_SNAPSHOT_SOURCE} from "../configs/fx-rates.snapshot"

/** KRW per 1 unit of the keyed currency. */
export type FxRates = Record<string, number>

export interface FxRateTable {
  /** KRW per 1 unit of each ISO-4217 code. Always contains `KRW: 1`. */
  rates: FxRates
  /** Upstream publication time of these rates (ISO-8601). */
  fetchedAt: string
  /** Where the rates came from — a URL for live, `"snapshot"` for the fallback. */
  source: string
  /** False when the live fetch failed and the committed snapshot is in use. */
  live: boolean
}

const DEFAULT_RATES_URL = "https://open.er-api.com/v6/latest/USD"
const FETCH_TIMEOUT_MS = 10_000

/**
 * Currencies with no minor unit. Their listed price is already an integer, so
 * a decimal point in the scraped text means the parse went wrong rather than
 * that the amount has cents.
 */
export const ZERO_DECIMAL_CURRENCIES = new Set(["KRW", "JPY", "VND", "CLP", "ISK"])

export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  KRW: "₩",
  JPY: "¥",
  CNY: "¥",
  HKD: "HK$",
  TWD: "NT$",
  SGD: "S$",
  THB: "฿",
  AUD: "A$",
  NZD: "NZ$",
  CAD: "C$",
  CHF: "CHF ",
  EGP: "E£",
  AED: "AED ",
  INR: "₹",
  PHP: "₱",
  VND: "₫",
  BRL: "R$",
  MXN: "MX$",
  TRY: "₺",
}

/**
 * Shopify Markets localization — currency to the country code we send as
 * `?country=` and in the `localization=` cookie. Unset means the store keeps
 * its default market, which for a Korean IP can silently flip to KRW and
 * make the crawl ingest one market's numbers under another's currency.
 */
export const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "US",
  GBP: "GB",
  EUR: "DE",
  KRW: "KR",
  JPY: "JP",
  CNY: "CN",
  HKD: "HK",
  TWD: "TW",
  SGD: "SG",
  THB: "TH",
  AUD: "AU",
  NZD: "NZ",
  CAD: "CA",
  CHF: "CH",
  SEK: "SE",
  DKK: "DK",
  NOK: "NO",
  PLN: "PL",
  CZK: "CZ",
  HUF: "HU",
  EGP: "EG",
  AED: "AE",
  SAR: "SA",
  ILS: "IL",
  TRY: "TR",
  INR: "IN",
  IDR: "ID",
  MYR: "MY",
  PHP: "PH",
  VND: "VN",
  MXN: "MX",
  BRL: "BR",
  ZAR: "ZA",
}

const SNAPSHOT_TABLE: FxRateTable = {
  rates: {...FX_SNAPSHOT_RATES, KRW: 1},
  fetchedAt: FX_SNAPSHOT_FETCHED_AT,
  source: "snapshot",
  live: false,
}

let active: FxRateTable = SNAPSHOT_TABLE
let inflight: Promise<FxRateTable> | null = null
const warnedCurrencies = new Set<string>()

interface ErApiResponse {
  result?: string
  base_code?: string
  rates?: Record<string, unknown>
  time_last_update_utc?: string
}

/**
 * Convert an `open.er-api.com` USD-based payload into KRW-per-unit rates.
 * Dividing through `rates.KRW` keeps full precision — inverting each rate
 * from a KRW-based payload would round 1/0.000723 style values instead.
 */
export function parseFxResponse(payload: unknown, source = DEFAULT_RATES_URL): FxRateTable | null {
  const body = payload as ErApiResponse
  if (!body || typeof body !== "object") return null
  if (body.result && body.result !== "success") return null
  const raw = body.rates
  if (!raw || typeof raw !== "object") return null

  const base = typeof body.base_code === "string" ? body.base_code.toUpperCase() : "USD"
  const perBase = (code: string): number | null => {
    const value = (raw as Record<string, unknown>)[code]
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  // `base` itself is not always echoed inside `rates`; it is 1 by definition.
  const krwPerBase = base === "KRW" ? 1 : perBase("KRW")
  if (krwPerBase === null) return null

  const rates: FxRates = {KRW: 1}
  for (const code of Object.keys(raw)) {
    if (!/^[A-Z]{3}$/.test(code)) continue
    const unitsPerBase = perBase(code)
    if (unitsPerBase === null) continue
    rates[code] = krwPerBase / unitsPerBase
  }
  if (base !== "KRW" && rates[base] === undefined) rates[base] = krwPerBase

  // A payload without the majors is a partial/degraded response, not a table.
  if (!rates.USD || !rates.EUR) return null

  return {
    rates,
    fetchedAt: typeof body.time_last_update_utc === "string"
      ? new Date(body.time_last_update_utc).toISOString()
      : new Date().toISOString(),
    source,
    live: true,
  }
}

/**
 * Fetch current rates once per process and install them as the active table.
 *
 * Safe to call from every entrypoint: concurrent callers share one request,
 * and a failure leaves the committed snapshot in place rather than throwing,
 * so a rate-API outage degrades price freshness instead of halting a crawl.
 * Set `FX_DISABLE_LIVE=1` to pin the snapshot (used by tests).
 */
export async function initFxRates(options: {
  fetchImpl?: typeof fetch
  url?: string
  force?: boolean
} = {}): Promise<FxRateTable> {
  if (!options.force && inflight) return inflight
  if (!options.force && active.live) return active
  if (process.env.FX_DISABLE_LIVE === "1") return active

  const url = options.url ?? process.env.FX_RATES_URL ?? DEFAULT_RATES_URL
  const fetchImpl = options.fetchImpl ?? fetch

  inflight = (async () => {
    try {
      const res = await fetchImpl(url, {
        headers: {Accept: "application/json"},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const table = parseFxResponse(await res.json(), url)
      if (!table) throw new Error("unusable rate payload")
      active = table
      warnedCurrencies.clear()
      console.log(
        `[FX] 실시간 환율 적용 (${Object.keys(table.rates).length}개 통화, 기준 ${table.fetchedAt}) ` +
          `— USD ${table.rates.USD?.toFixed(2)} / EUR ${table.rates.EUR?.toFixed(2)} / JPY ${table.rates.JPY?.toFixed(2)}`,
      )
      return table
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(
        `[FX] 실시간 환율 조회 실패 (${reason}) — 커밋된 스냅샷(${FX_SNAPSHOT_FETCHED_AT})으로 폴백`,
      )
      return active
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** The table `convertToKrw` is currently using. */
export function getFxRateTable(): FxRateTable {
  return active
}

/** Restore the committed snapshot. Test seam — not used on the crawl path. */
export function resetFxRates(): void {
  active = SNAPSHOT_TABLE
  inflight = null
  warnedCurrencies.clear()
}

/** KRW per 1 unit of `currency`, or undefined when we have no rate for it. */
export function fxRateToKrw(currency: string): number | undefined {
  return active.rates[currency.toUpperCase()]
}

/**
 * Convert `price` from `currency` into whole KRW.
 *
 * Returns null for a currency we have no rate for. Callers on the write path
 * MUST treat null as "drop this product" — never as "assume it was KRW",
 * which is how foreign prices ended up stored as won in the first place.
 */
export function convertToKrw(price: number, currency: string): number | null {
  const code = currency.toUpperCase()
  const rate = active.rates[code]
  if (rate === undefined) {
    if (!warnedCurrencies.has(code)) {
      warnedCurrencies.add(code)
      console.warn(`[FX] 알 수 없는 통화 "${currency}" — 가격 변환 skip`)
    }
    return null
  }
  return Math.round(price * rate)
}

/**
 * Legacy alias for the committed snapshot rates.
 *
 * @deprecated Reads a fixed table and so ignores the live rates installed by
 * `initFxRates()`. Use `convertToKrw` / `fxRateToKrw` instead.
 */
export const FX_TO_KRW: Record<string, number> = SNAPSHOT_TABLE.rates
