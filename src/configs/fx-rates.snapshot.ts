/**
 * Committed FX snapshot: KRW per 1 unit of the source currency.
 *
 * This is the OFFLINE FALLBACK only. The live path is `initFxRates()` in
 * `src/lib/fx.ts`, which fetches current rates once per run. This file exists
 * so a crawl still converts (with a slightly stale rate) when the rate API is
 * unreachable, instead of silently dropping every foreign-currency product.
 *
 * Refresh with: `pnpm fx:refresh` (tools/refresh-fx-snapshot.ts).
 * Do not hand-edit — the tool rewrites the whole file.
 */

/** Upstream `time_last_update_utc` of the snapshot below. */
export const FX_SNAPSHOT_FETCHED_AT = "2026-08-26T00:02:31.000Z"

export const FX_SNAPSHOT_SOURCE = "https://open.er-api.com/v6/latest/USD"

/** KRW per 1 unit. */
export const FX_SNAPSHOT_RATES: Record<string, number> = {
  KRW: 1,
  USD: 1383.1175,
  EUR: 1614.0794,
  GBP: 1886.77,
  JPY: 8.6854,
  CNY: 205.3013,
  HKD: 176.4516,
  TWD: 43.4292,
  SGD: 1089.3992,
  THB: 42.2733,
  AUD: 990.0981,
  NZD: 826.0229,
  CAD: 999.3884,
  CHF: 1724.1598,
  SEK: 145.9735,
  DKK: 215.7931,
  NOK: 148.4358,
  PLN: 375.0784,
  CZK: 67.0057,
  HUF: 4.4647,
  EGP: 27.4302,
  AED: 376.6147,
  SAR: 368.8313,
  ILS: 464.4234,
  TRY: 28.7501,
  INR: 14.4939,
  IDR: 0.0781,
  MYR: 341.7846,
  PHP: 22.4223,
  VND: 0.0531,
  MXN: 81.6159,
  BRL: 268.3321,
  ZAR: 86.7623,
  RUB: 16.4533,
  UAH: 30.9588,
}
