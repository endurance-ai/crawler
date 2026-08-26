/**
 * Rewrite `src/configs/fx-rates.snapshot.ts` from the live rate API.
 *
 * The snapshot is the offline fallback for `initFxRates()`. It only matters
 * when the rate API is unreachable mid-crawl, but that is exactly when a
 * stale table does damage — so refresh it periodically (the previous pinned
 * table sat untouched from 2026-04 to 2026-08 and drifted 3-8%).
 *
 * Usage: `pnpm fx:refresh`
 */

import * as fs from "fs"
import * as path from "path"
import {parseFxResponse} from "../src/lib/fx"

const RATES_URL = process.env.FX_RATES_URL ?? "https://open.er-api.com/v6/latest/USD"
const OUTPUT = path.join(process.cwd(), "src/configs/fx-rates.snapshot.ts")

/**
 * Currencies worth pinning offline. The live table carries all 160+; the
 * snapshot only needs the markets our sources actually price in, plus enough
 * headroom that a newly onboarded shop is unlikely to miss.
 */
const TRACKED = [
  "KRW", "USD", "EUR", "GBP", "JPY", "CNY", "HKD", "TWD", "SGD", "THB",
  "AUD", "NZD", "CAD", "CHF", "SEK", "DKK", "NOK", "PLN", "CZK", "HUF",
  "EGP", "AED", "SAR", "ILS", "TRY", "INR", "IDR", "MYR", "PHP", "VND",
  "MXN", "BRL", "ZAR", "RUB", "UAH",
]

async function main(): Promise<void> {
  const res = await fetch(RATES_URL, {
    headers: {Accept: "application/json"},
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`rate API returned HTTP ${res.status}`)

  const table = parseFxResponse(await res.json(), RATES_URL)
  if (!table) throw new Error("rate API returned an unusable payload")

  const kept = TRACKED.filter((code) => typeof table.rates[code] === "number")
  const missing = TRACKED.filter((code) => !kept.includes(code))
  if (missing.length > 0) console.warn(`⚠️  API에 없는 통화 (스냅샷에서 제외): ${missing.join(", ")}`)
  if (!kept.includes("USD") || !kept.includes("EUR")) throw new Error("majors missing — refusing to write")

  const body = `/**
 * Committed FX snapshot: KRW per 1 unit of the source currency.
 *
 * This is the OFFLINE FALLBACK only. The live path is \`initFxRates()\` in
 * \`src/lib/fx.ts\`, which fetches current rates once per run. This file exists
 * so a crawl still converts (with a slightly stale rate) when the rate API is
 * unreachable, instead of silently dropping every foreign-currency product.
 *
 * Refresh with: \`pnpm fx:refresh\` (tools/refresh-fx-snapshot.ts).
 * Do not hand-edit — the tool rewrites the whole file.
 */

/** Upstream \`time_last_update_utc\` of the snapshot below. */
export const FX_SNAPSHOT_FETCHED_AT = ${JSON.stringify(table.fetchedAt)}

export const FX_SNAPSHOT_SOURCE = ${JSON.stringify(RATES_URL)}

/** KRW per 1 unit. */
export const FX_SNAPSHOT_RATES: Record<string, number> = {
${kept.map((code) => `  ${code}: ${Number(table.rates[code]!.toFixed(4))},`).join("\n")}
}
`

  fs.writeFileSync(OUTPUT, body, "utf-8")
  console.log(`✅ ${kept.length}개 통화 스냅샷 갱신 (기준 ${table.fetchedAt}) → ${OUTPUT}`)
  console.log(`   USD ${table.rates.USD!.toFixed(2)} / EUR ${table.rates.EUR!.toFixed(2)} / GBP ${table.rates.GBP!.toFixed(2)} / JPY ${table.rates.JPY!.toFixed(4)}`)
}

main().catch((error) => {
  console.error(`❌ FX 스냅샷 갱신 실패: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
