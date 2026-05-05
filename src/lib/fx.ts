/**
 * Shared FX (foreign exchange) table and conversion utilities.
 *
 * Lifted verbatim from `shopify-engine.ts:11-41` so that both
 * `shopify-engine.ts` (existing call site at engine time) and
 * `import-products.ts` (new call site at upsert time, for Uniqlo US
 * cache files that store native USD prices) can share the same
 * hardcoded rate table.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-005
 *
 * @MX:NOTE: POC-grade. Live FX rate API is project-level out-of-scope.
 * Rates are reviewed manually; last refresh: 2026-04.
 */

// 2026-04 기준 고정 환율 (POC — 실시간 환율 API는 후속 작업)
export const FX_TO_KRW: Record<string, number> = {
  USD: 1430,
  EUR: 1560,
  GBP: 1750,
  KRW: 1,
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  KRW: "₩",
}

// Shopify Markets localization cookie — currency 기반 국가 코드 매핑
// 미설정 시 스토어가 IP geo로 로컬 통화 반환 (한국 IP → KRW로 리턴 → 통화 혼선)
export const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "US",
  GBP: "GB",
  EUR: "DE",
  KRW: "KR",
}

export function convertToKrw(price: number, currency: string): number | null {
  const rate = FX_TO_KRW[currency]
  if (rate === undefined) {
    console.warn(`[FX] 알 수 없는 통화 "${currency}" — 가격 변환 skip`)
    return null
  }
  return Math.round(price * rate)
}
