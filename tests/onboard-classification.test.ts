import assert from "node:assert/strict"
import test from "node:test"

import {classifyOnboardProduct, hasSuspiciousShortNames} from "../src/lib/onboard-classification"

test("onboarding preserves a valid crawler subcategory for every crawl variant", () => {
  assert.deepEqual(classifyOnboardProduct({
    name: "Sang",
    category: "jewelry",
    subcategory: "necklace",
  }), {category: "jewelry", subcategory: "necklace"})
})

test("normal jewelry titles are not flagged by the short-name review heuristic", () => {
  assert.equal(hasSuspiciousShortNames([
    {name: "Silver Ring"},
    {name: "Gold Necklace"},
    {name: "Pearl Earring"},
  ]), false)
})

test("a short-name anomaly remains available as a review signal", () => {
  assert.equal(hasSuspiciousShortNames([
    {name: "Alpha"},
    {name: "Beta"},
    {name: "Gamma"},
  ]), true)
})
