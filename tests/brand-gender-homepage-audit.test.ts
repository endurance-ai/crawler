import test from "node:test"
import assert from "node:assert/strict"

import {extractHomepageSignals} from "../tools/audit-brand-gender-homepages"

test("official men and women collection links widen the brand scope", () => {
  const result = extractHomepageSignals(`
    <a href="/collections/mens">Men</a>
    <a href="/collections/womens">Women</a>
  `)
  assert.equal(result.suggested, "unisex")
  assert.equal(result.suggestionRule, "official_navigation_men_and_women")
})

test("country selector text and product-level unisex labels are not brand-wide evidence", () => {
  const result = extractHomepageSignals(`
    <a href="#">Isle of Man (GBP)</a>
    <a href="/products/unisex-cotton-pants">Unisex Cotton Pants</a>
  `)
  assert.deepEqual(result.menLinks, [])
  assert.deepEqual(result.unisexLinks, [])
  assert.equal(result.suggested, null)
})

test("official unisex collection navigation is brand-wide evidence", () => {
  const result = extractHomepageSignals(`<a href="/collections/genderless">GENDERLESS</a>`)
  assert.equal(result.suggested, "unisex")
  assert.equal(result.suggestionRule, "official_navigation_unisex")
})
