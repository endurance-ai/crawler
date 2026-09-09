import test from "node:test"
import assert from "node:assert/strict"
import {decideCatalogMatch} from "../src/lib/catalog/matching"
import {identifierProfileFor, isValidGtin, makeIdentifier} from "../src/lib/catalog/identifiers"

const id = (kind: "gtin" | "model_id", value: string, namespace = "test") => makeIdentifier(kind, value, {
  namespace,
  scope: kind === "gtin" ? "global" : "brand",
  level: "product",
  provenance: "fixture",
  trust: 1,
})!

test("validates GTIN check digits and rejects malformed identifiers", () => {
  assert.equal(isValidGtin("4006381333931"), true)
  assert.equal(isValidGtin("4006381333932"), false)
  assert.equal(isValidGtin("abc"), false)
})

test("regional platform keys share the brand model-id profile", () => {
  assert.deepEqual(identifierProfileFor("uniqlo-kr"), identifierProfileFor("uniqlo-us"))
  assert.equal(identifierProfileFor("uniqlo-kr").productCode, "model_id")
})

test("same trusted identifier auto-matches while color conflict rejects", () => {
  const a = {brandKey: "uniqlo", name: "AIRism Cotton T-Shirt", colorKey: "black", identifiers: [id("model_id", "E465755-000", "uniqlo")]}
  const b = {brandKey: "uniqlo", name: "AIRism 코튼 T", colorKey: "black", identifiers: [id("model_id", "E465755-000", "uniqlo")]}
  assert.equal(decideCatalogMatch(a, b).status, "auto")
  assert.equal(decideCatalogMatch(a, {...b, colorKey: "white"}).status, "reject")
})

test("trusted identifier without color evidence never auto-matches", () => {
  const a = {brandKey: "uniqlo", name: "Crew Neck T-Shirt", identifiers: [id("model_id", "E422992-000", "uniqlo")]}
  const b = {brandKey: "uniqlo", name: "크루넥T", identifiers: [id("model_id", "E422992-000", "uniqlo")]}
  const result = decideCatalogMatch(a, b)
  assert.equal(result.status, "review")
  assert.equal(result.reason, "color_evidence_missing")
})

test("same merchant SKU from different namespaces does not auto-match", () => {
  const a = {brandKey: "acme", name: "Logo Tee", identifiers: [id("model_id", "SKU-1", "shop-a")]}
  const b = {brandKey: "acme", name: "Logo Tee", identifiers: [id("model_id", "SKU-1", "shop-b")]}
  assert.notEqual(decideCatalogMatch(a, b).status, "auto")
})

test("strong-looking title candidate is review-only", () => {
  const result = decideCatalogMatch(
    {brandKey: "acme", name: "Heavy Cotton Logo T-Shirt", category: "top"},
    {brandKey: "acme", name: "Heavy Cotton Logo T Shirt", category: "top"},
  )
  assert.equal(result.status, "review")
})
