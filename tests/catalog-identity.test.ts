import test from "node:test"
import assert from "node:assert/strict"
import {decideCatalogMatch, decideCrossShopMatch, extractSourceProductTokens} from "../src/lib/catalog/matching"
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

test("domestic official shop and retailer auto-match only with shared source token and image", () => {
  const base = {
    brandKey: "innir",
    name: "251 Aged Crewneck Sweater (Beige)",
    category: "knitwear",
    colorKey: "BEIGE",
    imageEmbedding: [0.2, 0.4, 0.8],
  }
  const result = decideCrossShopMatch(
    {...base, platform: "innir", productUrl: "https://innir.net/product/item/46790/category/3167"},
    {...base, platform: "8division", productUrl: "https://8division.com/product/detail.html?product_no=46790"},
  )
  assert.equal(result.status, "auto")
  assert.equal(result.reason, "cross_shop_source_token_and_image_exact")
})

test("same title and color do not auto-match without both corroborators", () => {
  const base = {brandKey: "acme", name: "DRIP TEE", category: "tops", colorKey: "BLACK"}
  const result = decideCrossShopMatch(
    {...base, platform: "official", productUrl: "https://official.test/p/B0030669FA706", imageEmbedding: [1, 0]},
    {...base, platform: "retailer", productUrl: "https://retailer.test/p/B0030556FA582", imageEmbedding: [0, 1]},
  )
  assert.equal(result.status, "review")
})

test("cross-shop matcher rejects color conflicts and same host", () => {
  const base = {brandKey: "innir", name: "Sweater", category: "knitwear", colorKey: "BEIGE", imageEmbedding: [1, 0]}
  assert.equal(decideCrossShopMatch(
    {...base, platform: "innir", productUrl: "https://innir.net/p/46790"},
    {...base, colorKey: "BLACK", platform: "8division", productUrl: "https://8division.com/p/46790"},
  ).reason, "color_conflict")
  assert.equal(decideCrossShopMatch(
    {...base, platform: "legacy-a", productUrl: "https://innir.net/p/46790"},
    {...base, platform: "legacy-b", productUrl: "https://www.innir.net/p/46790"},
  ).reason, "not_cross_shop")
  assert.deepEqual(extractSourceProductTokens("https://shop.test/p/24?product_no=46790"), ["46790"])
})
