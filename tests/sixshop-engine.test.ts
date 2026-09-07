import assert from "node:assert/strict"
import test from "node:test"

import {parseSixshopCatalogProduct, parseSixshopV2CatalogProduct} from "../src/lib/sixshop-engine"

const config = {
  key: "sample",
  name: "Sample",
  brand: "Sample Brand",
  baseUrl: "https://sample.kr",
  sourceCurrency: "KRW" as const,
  defaultGender: ["women"],
  defaultCategory: "tops",
  sixshopProductPath: "products" as const,
}

test("Sixshop catalog maps exact sale tuple, stock, image, and product path", () => {
  const product = parseSixshopCatalogProduct(
    {
      id: 42,
      name: "Ribbon top",
      address: "ribbon-top",
      soldOut: false,
      thumbnails: ["/uploadedFiles/1/product/image.jpg"],
      price: {
        regularPrice: 120_000,
        currency: "KRW",
        groupByGradeId: {"-2": {salesPrice: 96_000}},
      },
    },
    config,
  )

  assert.ok(product)
  assert.equal(product.price, 96_000)
  assert.equal(product.originalPrice, 120_000)
  assert.equal(product.salePrice, 96_000)
  assert.equal(product.pricingObservation?.state, "sale")
  assert.equal(product.productUrl, "https://sample.kr/products/ribbon-top")
  assert.equal(product.imageUrl, "https://contents.sixshop.com/uploadedFiles/1/product/image.jpg")
  assert.equal(product.inStock, true)
})

test("Sixshop equal grade price is a confirmed regular price", () => {
  const product = parseSixshopCatalogProduct(
    {
      name: "Bag",
      address: "bag",
      soldOut: true,
      price: {
        regularPrice: 50_000,
        currency: "KRW",
        groupByGradeId: {"-2": {salesPrice: 50_000}},
      },
    },
    {...config, sixshopProductPath: "product"},
  )

  assert.ok(product)
  assert.equal(product.price, 50_000)
  assert.equal(product.originalPrice, 50_000)
  assert.equal(product.salePrice, null)
  assert.equal(product.pricingObservation?.state, "regular")
  assert.equal(product.productUrl, "https://sample.kr/product/bag")
  assert.equal(product.inStock, false)
})

test("Sixshop incomplete rows are rejected", () => {
  assert.equal(parseSixshopCatalogProduct({name: "No address", price: {regularPrice: 1}}, config), null)
  assert.equal(parseSixshopCatalogProduct({address: "no-name", price: {regularPrice: 1}}, config), null)
  assert.equal(parseSixshopCatalogProduct({name: "No price", address: "no-price"}, config), null)
})

test("Sixshop Storefront v2 catalog maps sale and availability", () => {
  const product = parseSixshopV2CatalogProduct(
    {
      name: "Odyssey VTG",
      slug: "jpcr8q7jens6",
      images: [{url: "https://cdn.sixshop.io/product.jpg"}],
      price: {original: 100_000, sale: 86_000},
      availability: "out-of-stock",
      isOutOfStock: true,
      managementCode: "JPCR8Q7JENS6",
    },
    config,
  )
  assert.ok(product)
  assert.equal(product.price, 86_000)
  assert.equal(product.originalPrice, 100_000)
  assert.equal(product.salePrice, 86_000)
  assert.equal(product.productUrl, "https://sample.kr/products/jpcr8q7jens6")
  assert.equal(product.inStock, false)
})
