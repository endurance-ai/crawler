import assert from "node:assert/strict"
import test from "node:test"

import {
  assessKrMarketProbes,
  discoverKrStorefrontUrls,
  extractActualOfferCurrencies,
  extractLocalizationCountryCodes,
  isRetryableEligibilityError,
  type KrPriceProbe,
} from "../src/lib/kr-market-eligibility"

const checkedAt = "2026-08-02T00:00:00.000Z"

function probe(patch: Partial<KrPriceProbe> = {}): KrPriceProbe {
  return {
    context: "default",
    storefrontUrl: "https://example.com/",
    productsUrl: "https://example.com/products.json?limit=2",
    currency: "GBP",
    variantPriceCount: 2,
    countryCodes: [],
    status: "ok",
    ...patch,
  }
}

test("KR origin은 기존처럼 가격 탐지 없이 eligibility를 유지한다", () => {
  const result = assessKrMarketProbes([], "KR", checkedAt)
  assert.equal(result.status, "eligible_origin")
  assert.equal(result.nextCheckAt, null)
})

test("Shopify Market이 기본 GBP를 KRW로 바꾸고 실제 variant 가격을 주면 통과한다", () => {
  const result = assessKrMarketProbes([
    probe(),
    probe({
      context: "shopify_market",
      currency: "KRW",
      storefrontUrl: "https://example.com/",
      countryCodes: ["GB", "KR"],
    }),
  ], "GB", checkedAt)
  assert.equal(result.status, "eligible_storefront")
  assert.equal(result.localizationStatus, "supported")
  assert.equal(result.shippingStatus, "supported")
  assert.equal(result.priceCurrency, "KRW")
})

test("/en-kr 실제 KRW variant 가격은 배송 미확정과 분리해 통과한다", () => {
  const result = assessKrMarketProbes([
    probe({
      context: "localized_url",
      storefrontUrl: "https://example.com/en-kr/",
      productsUrl: "https://example.com/en-kr/products.json?limit=2",
      currency: "KRW",
    }),
  ], "ES", checkedAt)
  assert.equal(result.status, "eligible_storefront")
  assert.equal(result.shippingStatus, "unknown")
})

test("KRW 가격만 있고 KR localization 또는 배송이 확인되지 않으면 price_only다", () => {
  const result = assessKrMarketProbes([
    probe({currency: "KRW"}),
  ], "US", checkedAt)
  assert.equal(result.status, "price_only")
})

test("명시적 country selector에 KR이 없으면 unsupported로 확정한다", () => {
  const result = assessKrMarketProbes([
    probe({countryCodes: ["GB", "US", "JP"]}),
  ], "GB", checkedAt)
  assert.equal(result.status, "unsupported")
  assert.equal(result.shippingStatus, "unsupported")
})

test("네트워크 실패와 미지원 판정을 분리하고 다음 확인 시각을 둔다", () => {
  const result = assessKrMarketProbes([
    probe({status: "network_error", currency: null, variantPriceCount: 0}),
  ], "GB", checkedAt)
  assert.equal(result.status, "retryable_error")
  assert.equal(result.nextCheckAt, "2026-08-03T00:00:00.000Z")
  assert.equal(isRetryableEligibilityError(new Error("fetch failed: ENOTFOUND")), true)
})

test("KR storefront 링크와 localization country ISO를 구조적으로 추출한다", () => {
  const html = `
    <a href="/en-kr/collections/new">Korea</a>
    <a href="/en-gb/collections/new">UK</a>
    <a href="https://third-party.example/resources/KR/widget.css">Third party</a>
    <form action="/localization"><select name="country_code">
      <option value="GB">United Kingdom</option><option value="KR">South Korea</option>
    </select><input name="country_code" value="KR"></form>
  `
  assert.deepEqual(discoverKrStorefrontUrls("https://example.com", html), [
    "https://example.com/en-kr",
  ])
  assert.deepEqual(extractLocalizationCountryCodes(html), ["GB", "KR"])
})

test("일반 상품 페이지 fallback은 Product Offer의 양수 가격과 ISO 통화만 인정한다", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "Dress",
    offers: {"@type": "Offer", price: "129000", priceCurrency: "KRW"},
  })}</script>`
  assert.deepEqual(extractActualOfferCurrencies(html), ["KRW"])
  assert.deepEqual(
    extractActualOfferCurrencies('<meta property="product:price:currency" content="KRW">'),
    [],
  )
})
