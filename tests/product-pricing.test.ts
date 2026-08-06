import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeObservedPricing,
  toDbPriceFields,
} from "../src/lib/product-pricing"

test("명시적 세일은 현재가/정가/세일가 coherent tuple을 만든다", () => {
  const pricing = normalizeObservedPricing({
    currentPrice: 70,
    originalPrice: 100,
    salePrice: 70,
    state: "sale",
    source: "variant",
  })
  assert.deepEqual(
    {price: pricing.price, original: pricing.originalPrice, sale: pricing.salePrice, source: pricing.sourcePrice},
    {price: 70, original: 100, sale: 70, source: 70},
  )
  assert.equal(pricing.pricingObservation.state, "sale")
})

test("뒤집힌 세일 pair는 regular로 세탁하지 않고 unknown으로 강등한다", () => {
  const pricing = normalizeObservedPricing({
    currentPrice: 120,
    originalPrice: 100,
    salePrice: 120,
    state: "sale",
    source: "detail",
  })
  assert.equal(pricing.salePrice, null)
  assert.equal(pricing.pricingObservation.state, "unknown")
})

test("DB mapper는 확인되지 않은 가격을 refresh/import 쓰기에서 거부한다", () => {
  const fields = toDbPriceFields(
    {
      price: 10000,
      originalPrice: 10000,
      salePrice: null,
      sourcePrice: 10000,
      sourceCurrency: "KRW",
      pricingObservation: {state: "unknown", source: "listing", version: 2},
    },
    "KRW",
    {requireConfirmed: true},
  )
  assert.equal(fields, null)
})

test("DB mapper는 원본 현재가는 native로, 가격 tuple은 KRW로 변환한다", () => {
  const fields = toDbPriceFields({
    price: 70,
    originalPrice: 100,
    salePrice: 70,
    sourcePrice: 70,
    sourceCurrency: "USD",
    pricingObservation: {state: "sale", source: "variant", version: 2},
  })
  assert.ok(fields)
  assert.equal(fields!.source_price, 70)
  assert.equal(fields!.source_currency, "USD")
  assert.equal(fields!.price, fields!.sale_price)
  assert.ok(fields!.original_price > fields!.price)
})
