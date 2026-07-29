import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  assessCafe24ProductQuality,
  cleanCafe24ProductName,
  filterCafe24ProductsWithUsablePrice,
  inferCafe24Currency,
  isGenericCafe24ProductName,
  parseCafe24PriceCandidate,
  parseCafe24PriceCandidates,
  parseCafe24CategoryHref,
  runFirstUsefulCafe24Step,
} from "../src/lib/cafe24-chain"
import type {Product} from "../src/lib/types"

test("Cafe24 category chain parses pretty category URLs and rejects product detail URLs", () => {
  assert.deepEqual(
    parseCafe24CategoryHref("/category/tops/24/", "https://example.com", "TOPS"),
    {
      name: "TOPS",
      cateNo: 24,
      url: "https://example.com/category/tops/24/",
    },
  )

  assert.equal(
    parseCafe24CategoryHref(
      "/product/example-shirt/123/category/24/display/1/",
      "https://example.com",
      "Example Shirt",
    ),
    null,
  )
})

test("runFirstUsefulCafe24Step falls through until a strategy is useful", async () => {
  const result = await runFirstUsefulCafe24Step(
    undefined,
    [
      {name: "too-small", run: () => [1]},
      {name: "useful", run: () => [1, 2]},
    ],
    (value) => value.length >= 2,
  )

  assert.equal(result.strategy, "useful")
  assert.deepEqual(result.value, [1, 2])
  assert.deepEqual(result.attempted, [
    {name: "too-small", count: 1},
    {name: "useful", count: 2},
  ])
})

test("Cafe24 product name cleaner removes labels and detects generic placeholders", () => {
  assert.equal(cleanCafe24ProductName("Product Name : Marco Bag_Black"), "Marco Bag_Black")
  assert.equal(cleanCafe24ProductName("상품명 : 오버사이즈 셔츠"), "오버사이즈 셔츠")
  assert.equal(isGenericCafe24ProductName("상품명"), true)
  assert.equal(isGenericCafe24ProductName("Product Name : "), true)
  assert.equal(isGenericCafe24ProductName("Marco Bag_Black"), false)
})

test("Cafe24 price parser handles KRW integers and foreign decimal prices", () => {
  assert.equal(parseCafe24PriceCandidate("KRW 465,000", "KRW"), 465000)
  assert.equal(parseCafe24PriceCandidate("465000", "KRW"), 465000)
  assert.equal(parseCafe24PriceCandidate("sale price: KRW 418,500 ( KRW 46,500 할인)", "KRW"), 418500)
  assert.equal(parseCafe24PriceCandidate("$9.12", "USD"), 9.12)
  assert.equal(inferCafe24Currency("Price $9.12"), "USD")
  assert.deepEqual(parseCafe24PriceCandidates("₩98,000 ₩88,200", "KRW"), [98000, 88200])
})

test("Cafe24 quality gate rejects generic names, missing prices, and external brand contamination", () => {
  const base = product({name: "CAYL Trail Cap Black", price: 68000, brand: "Cayl"})

  const ok = assessCafe24ProductQuality([base], {type: "cafe24", name: "Cayl", brand: "Cayl"})
  assert.equal(ok.passed, true)

  const generic = assessCafe24ProductQuality(
    [product({name: "상품명", price: 68000, brand: "NOTHINGEVERYTHING"})],
    {type: "cafe24", name: "NOTHINGEVERYTHING", brand: "NOTHINGEVERYTHING"},
  )
  assert.equal(generic.passed, false)
  assert.deepEqual(generic.reasons, ["generic_name_rate=100"])

  const noPrice = assessCafe24ProductQuality(
    [product({name: "MPa Jacket Black", price: null, brand: "PLASTICPRODUCT"})],
    {type: "cafe24", name: "PLASTICPRODUCT", brand: "PLASTICPRODUCT"},
  )
  assert.equal(noPrice.passed, false)
  assert.deepEqual(noPrice.reasons, ["price_missing_rate=100"])

  const contaminated = assessCafe24ProductQuality(
    [
      product({name: "HOKA 여성 호파라 2 Black", price: 179000, brand: "Cayl"}),
      product({name: "CAYL Trail Cap Black", price: 68000, brand: "Cayl"}),
    ],
    {type: "cafe24", name: "Cayl", brand: "Cayl"},
  )
  assert.equal(contaminated.passed, false)
  assert.deepEqual(contaminated.reasons, ["brand_contamination_rate=50"])
})

test("Cafe24 usable price filter drops zero-price editorial records before save", () => {
  const valid = product({name: "Padded Bag Black", price: 98, priceFormatted: "$98.00"})
  const zeroPrice = product({
    name: "One Year of the Padding Bag",
    price: null,
    priceFormatted: "",
    productUrl: "https://en.sienneboutique.com/product/detail.html?product_no=2059",
  })

  const result = filterCafe24ProductsWithUsablePrice([valid, zeroPrice])
  assert.deepEqual(result.products, [valid])
  assert.deepEqual(result.dropped, [zeroPrice])
})

function product(overrides: Partial<Product>): Product {
  return {
    brand: "Brand",
    name: "Product Black",
    category: "Top",
    price: 10000,
    originalPrice: 10000,
    salePrice: null,
    priceFormatted: "₩10,000",
    imageUrl: "https://example.com/image.jpg",
    productUrl: "https://example.com/product/1",
    inStock: true,
    platform: "test",
    crawledAt: "2026-01-01T00:00:00.000Z",
    color: "Black",
    ...overrides,
  }
}
