import {test} from "node:test"
import * as assert from "node:assert/strict"

import {fetchShopifyGenderByHandle, parseShopifyProducts} from "../src/lib/shopify-engine"
import type {SiteConfig} from "../src/lib/types"

function shopifyProduct(handle: string, price = "100") {
  return {
    id: 1,
    title: "Plain Jacket",
    handle,
    vendor: "House",
    product_type: "Jacket",
    body_html: "",
    tags: [],
    options: [],
    variants: [{id: 1, title: "Default", price, available: true, sku: ""}],
    images: [{src: "https://cdn.shopify.com/a.jpg"}],
  }
}

test("공식 Shopify 컬렉션 성별이 무신호 상품의 engine 근거가 된다", () => {
  const [product] = parseShopifyProducts(
    {products: [shopifyProduct("plain-jacket")]},
    "https://example.com",
    "mixed-site",
    {genderByHandle: {"plain-jacket": "women"}},
  )

  assert.deepEqual(product.gender, ["women"])
  assert.equal(product.genderSource, "engine")
})

test("가격 없는 Shopify 서비스 add-on은 플랫폼 전체 가격 적재를 막지 않게 제외한다", () => {
  const products = parseShopifyProducts(
    {products: [shopifyProduct("real-product"), shopifyProduct("free-engraving", "0")]},
    "https://example.com",
    "price-site",
  )
  assert.deepEqual(products.map((product) => product.productUrl), ["https://example.com/products/real-product"])
})

test("men/women 양쪽 공식 부서 소속은 unisex, 명시적 unisex도 우선한다", async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  globalThis.fetch = async (input) => {
    const url = String(input)
    const products = url.includes("/collections/men/")
      ? [shopifyProduct("men-only"), shopifyProduct("both")]
      : url.includes("/collections/women/")
        ? [shopifyProduct("women-only"), shopifyProduct("both"), shopifyProduct("explicit")]
        : [shopifyProduct("explicit")]
    return new Response(JSON.stringify({products}), {
      status: 200,
      headers: {"content-type": "application/json"},
    })
  }

  const config: SiteConfig = {
    key: "mixed-site",
    name: "Mixed Site",
    type: "shopify",
    baseUrl: "https://example.com",
    shopifyGenderCollections: {
      men: ["men"],
      women: ["women"],
      unisex: ["unisex"],
    },
  }
  const errors: string[] = []
  const result = await fetchShopifyGenderByHandle(config, "KR", "localization=KR", errors)

  assert.deepEqual(result, {
    "men-only": "men",
    both: "unisex",
    "women-only": "women",
    explicit: "unisex",
  })
  assert.deepEqual(errors, [])
})

test("configured Shopify tags exclude products outside the supported taxonomy", () => {
  const adult = shopifyProduct("adult")
  const kids = {...shopifyProduct("kids"), tags: ["SALE", "KIDS"]}
  const products = parseShopifyProducts(
    {products: [adult, kids]},
    "https://example.com",
    "adult-site",
    {excludedTags: ["kids"]},
  )
  assert.deepEqual(products.map((product) => product.productUrl), ["https://example.com/products/adult"])
})

test("configured Shopify handles exclude non-merchandise records", () => {
  const products = parseShopifyProducts(
    {products: [shopifyProduct("jacket"), shopifyProduct("express-shipping")]},
    "https://example.com",
    "shop",
    {excludedHandles: ["express-shipping"]},
  )
  assert.deepEqual(products.map((product) => product.productUrl), ["https://example.com/products/jacket"])
})

test("verified non-fashion Shopify defaults retain the canonical other category", () => {
  const products = parseShopifyProducts(
    {products: [{...shopifyProduct("skin-oil"), title: "Idan Oil", product_type: ""}]},
    "https://example.com",
    "beauty-site",
    {defaultCategory: "other"},
  )
  assert.equal(products[0]?.category, "other")
})
