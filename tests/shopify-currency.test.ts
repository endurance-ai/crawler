/**
 * Shopify source-currency verification.
 *
 * Regression guard for the 2026-08 currency incident: `crawlShopify` trusted
 * `config.sourceCurrency` (defaulting to KRW) and never checked what the
 * store actually priced in, so EUR/JPY/USD/EGP amounts were written to
 * `products.price` as if they were won — 1,201 rows across 12 sites, with
 * medians as low as ₩70 for a jacket.
 *
 * The oracle under test was validated on 2026-08-26 against nine live
 * stores; in every case the storefront's `Shopify.currency.active` under
 * `?country=KR` matched the currency `products.json?country=KR` returned.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {
  detectShopifyActiveCurrency,
  parseShopifyActiveCurrency,
  reconcileShopifyCurrency,
} from "../src/lib/shopify-engine"

/** Shape Shopify inlines into every storefront's <head>. */
function bootstrap(active: string): string {
  return `<script>var Shopify = Shopify || {};Shopify.shop = "x.myshopify.com";` +
    `Shopify.currency = {"active":"${active}","rate":"1.0"};</script>`
}

test("parseShopifyActiveCurrency: reads the active market currency", () => {
  assert.equal(parseShopifyActiveCurrency(bootstrap("KRW")), "KRW")
  assert.equal(parseShopifyActiveCurrency(bootstrap("EUR")), "EUR")
  // notfoundco.com은 실제로 EGP를 반환한다 — 하드코딩 유니온 밖 통화도 읽혀야 한다.
  assert.equal(parseShopifyActiveCurrency(bootstrap("EGP")), "EGP")
})

test("parseShopifyActiveCurrency: returns null when the store exposes no bootstrap", () => {
  assert.equal(parseShopifyActiveCurrency("<html><body>no shopify here</body></html>"), null)
  assert.equal(parseShopifyActiveCurrency(""), null)
  // 소문자/비 ISO 형태는 통화로 인정하지 않는다.
  assert.equal(parseShopifyActiveCurrency('Shopify.currency = {"active":"krw"};'), null)
})

test("reconcileShopifyCurrency: agreement is a no-op", () => {
  const result = reconcileShopifyCurrency("KRW", "KRW")
  assert.equal(result.currency, "KRW")
  assert.equal(result.warning, undefined)
})

test("reconcileShopifyCurrency: the store wins over the config, with a warning", () => {
  // therasario.com: config는 KRW지만 KR 마켓을 지원하지 않아 USD로 응답한다.
  const result = reconcileShopifyCurrency("KRW", "USD")
  assert.equal(result.currency, "USD")
  assert.match(result.warning ?? "", /통화 불일치/)
  assert.match(result.warning ?? "", /USD/)
})

test("reconcileShopifyCurrency: an undetectable currency keeps the configured value", () => {
  // 오라클 실패를 "KRW겠지"로 바꿔치기하면 사고가 그대로 재현된다 — config 유지.
  const result = reconcileShopifyCurrency("EUR", null)
  assert.equal(result.currency, "EUR")
  assert.equal(result.warning, undefined)
})

test("detectShopifyActiveCurrency: probes the storefront under the crawled market", async () => {
  const seen: Array<{url: string; cookie: unknown}> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({url, cookie: (init.headers as Record<string, string>).Cookie})
    return {ok: true, status: 200, text: async () => bootstrap("KRW")}
  }) as unknown as typeof fetch

  const currency = await detectShopifyActiveCurrency("https://nodaleto.com", "KR", fetchImpl)

  assert.equal(currency, "KRW")
  assert.equal(seen.length, 1)
  // 상품 요청과 같은 마켓을 봐야 의미가 있다 — country 파라미터와 쿠키 둘 다.
  assert.match(seen[0]!.url, /country=KR/)
  assert.equal(seen[0]!.cookie, "localization=KR")
})

test("detectShopifyActiveCurrency: network and HTTP failures degrade to null, not to a guess", async () => {
  const boom = (() => Promise.reject(new Error("ETIMEDOUT"))) as unknown as typeof fetch
  assert.equal(await detectShopifyActiveCurrency("https://x.com", "KR", boom), null)

  const notFound = (async () => ({ok: false, status: 404, text: async () => ""})) as unknown as typeof fetch
  assert.equal(await detectShopifyActiveCurrency("https://x.com", "KR", notFound), null)
})
