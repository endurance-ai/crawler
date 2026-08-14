import assert from "node:assert/strict"
import test from "node:test"
import {pricingFieldsFromPoc, pricingFieldsToPoc} from "../src/lib/onboard-pricing-transport"

test("confirmed regular pricing survives the POC and import-file boundary", () => {
  const poc = pricingFieldsToPoc({
    originalPrice: 100_000,
    salePrice: null,
    sourcePrice: 100_000,
    pricingObservation: {state: "regular", source: "detail", version: 2},
  })

  assert.deepEqual(poc, {
    original_price: 100_000,
    sale_price: null,
    source_price: 100_000,
    pricing_observation: {state: "regular", source: "detail", version: 2},
  })
  assert.deepEqual(pricingFieldsFromPoc(poc), {
    originalPrice: 100_000,
    salePrice: null,
    sourcePrice: 100_000,
    pricingObservation: {state: "regular", source: "detail", version: 2},
  })
})

test("confirmed sale pricing preserves both list and effective prices", () => {
  const poc = pricingFieldsToPoc({
    originalPrice: 120_000,
    salePrice: 90_000,
    sourcePrice: 90_000,
    pricingObservation: {state: "sale", source: "variant", version: 2},
  })

  assert.deepEqual(pricingFieldsFromPoc(poc), {
    originalPrice: 120_000,
    salePrice: 90_000,
    sourcePrice: 90_000,
    pricingObservation: {state: "sale", source: "variant", version: 2},
  })
})

test("missing or malformed observations stay unconfirmed", () => {
  assert.deepEqual(pricingFieldsFromPoc({}), {
    originalPrice: null,
    salePrice: null,
  })
  assert.deepEqual(
    pricingFieldsFromPoc({pricing_observation: {state: "regular", source: "detail", version: 1}}),
    {originalPrice: null, salePrice: null},
  )
})
