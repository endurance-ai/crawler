import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  applyCafe24DetailFallbacks,
  assessCafe24ProductQuality,
  cafe24CategoryGenderSource,
  canonicalizeCafe24ProductUrl,
  cleanCafe24ProductName,
  dedupeCafe24ProductsByIdentity,
  filterCafe24ProductsForCategory,
  filterCafe24ProductsWithUsablePrice,
  extractCafe24DetailFallbacks,
  inferCafe24Currency,
  isGenericCafe24ProductName,
  isNoisyCafe24CategoryName,
  parseCafe24LabeledPrice,
  parseCafe24PriceCandidate,
  parseCafe24PriceCandidates,
  parseCafe24CategoryHref,
  runFirstUsefulCafe24Step,
} from "../src/lib/cafe24-chain"
import type {Product} from "../src/lib/types"

test("Cafe24 editorial archive and collection categories are not product feeds", () => {
  for (const name of ["ARCHIVE", "Archives", "COLLECTION", "Collections", "EDITORIAL"]) {
    assert.equal(isNoisyCafe24CategoryName(name), true, name)
  }
  assert.equal(isNoisyCafe24CategoryName("NEW COLLECTION DRESSES"), false)
})

test("Cafe24 generic unisex category remains a fallback below product URL/text evidence", () => {
  assert.equal(cafe24CategoryGenderSource(["unisex"]), "config_default")
  assert.equal(cafe24CategoryGenderSource([]), "config_default")
  assert.equal(cafe24CategoryGenderSource(["men"]), "engine")
  assert.equal(cafe24CategoryGenderSource(["women"]), "engine")
})

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

test("Cafe24 category chain accepts department-specific list.html category pages", () => {
  assert.deepEqual(
    parseCafe24CategoryHref(
      "/product/man_list.html?cate_no=25",
      "https://example.com",
      "OUTER",
    ),
    {
      name: "OUTER",
      cateNo: 25,
      url: "https://example.com/product/man_list.html?cate_no=25",
    },
  )

  assert.equal(
    parseCafe24CategoryHref(
      "/product/woman_list.html?cate_no=176",
      "https://example.com",
      "SALE",
    )?.cateNo,
    176,
  )
})

test("Cafe24 category validation removes global widgets and rejects stale category pages", () => {
  const global = product({
    name: "Global recommendation",
    productUrl: "https://shop.test/product/global/100/category/1/display/6/",
  })
  const categoryProduct = product({
    name: "Category product",
    productUrl: "https://shop.test/product/category-product/200/category/24/display/1/",
  })

  assert.deepEqual(filterCafe24ProductsForCategory([global, categoryProduct], 24), [categoryProduct])
  assert.deepEqual(filterCafe24ProductsForCategory([global], 24), [])
})

test("Cafe24 category validation preserves themes whose product URLs carry no category", () => {
  const queryProduct = product({
    productUrl: "https://shop.test/product/detail.html?product_no=200",
  })
  assert.deepEqual(filterCafe24ProductsForCategory([queryProduct], 24), [queryProduct])
})

test("Cafe24 products dedupe by product_no across category-specific URLs", () => {
  const first = product({
    productUrl: "https://shop.test/product/same/200/category/24/display/1/",
  })
  const duplicate = product({
    productUrl: "https://shop.test/product/same/200/category/193/display/1/",
  })
  const other = product({
    productUrl: "https://shop.test/product/other/201/category/24/display/1/",
  })

  const merged: Array<[Product, Product]> = []
  assert.deepEqual(
    dedupeCafe24ProductsByIdentity(
      [first, duplicate, other],
      (existing, incoming) => merged.push([existing, incoming]),
    ),
    [first, other],
  )
  assert.deepEqual(merged, [[first, duplicate]])
})

test("Cafe24 canonical product URL is stable across category and tracking changes", () => {
  assert.equal(
    canonicalizeCafe24ProductUrl("https://shop.test/product/same/200/category/24/display/1/?icid=widget"),
    "https://shop.test/product/detail.html?product_no=200",
  )
  assert.equal(
    canonicalizeCafe24ProductUrl("https://shop.test/product/detail.html?product_no=200&cate_no=24&display_group=1"),
    "https://shop.test/product/detail.html?product_no=200",
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
    ...overrides,
  }
}

test("Cafe24 labeled prices distinguish regular and sale values", () => {
  const text = "판매가 ₩100,000 할인판매가 ₩70,000"

  assert.equal(parseCafe24LabeledPrice(text, "original", "KRW"), 100_000)
  assert.equal(parseCafe24LabeledPrice(text, "sale", "KRW"), 70_000)
  assert.equal(
    parseCafe24LabeledPrice("10% 할인 적립금 5,000원", "sale", "KRW"),
    null,
  )
})

test("Cafe24 detail pricing replaces an unconfirmed listing price coherently", () => {
  const item = product({
    price: 100_000,
    originalPrice: 100_000,
    salePrice: null,
    sourcePrice: 100_000,
    pricingObservation: {
      state: "unknown",
      source: "listing",
      version: 2,
    },
  })

  applyCafe24DetailFallbacks(item, {
    name: null,
    price: 70_000,
    originalPrice: 100_000,
    salePrice: 70_000,
    priceFormatted: "₩70,000",
    sourceCurrency: "KRW",
    sourcePrice: 70_000,
    descriptionFirstLine: null,
  })

  assert.equal(item.price, 70_000)
  assert.equal(item.originalPrice, 100_000)
  assert.equal(item.salePrice, 70_000)
  assert.equal(item.sourcePrice, 70_000)
  assert.deepEqual(item.pricingObservation, {
    state: "sale",
    source: "detail",
    version: 2,
  })
})

test("Cafe24 lower detail price preserves a higher listing price as the sale original", () => {
  const item = product({
    price: 195_000,
    originalPrice: 195_000,
    salePrice: null,
    sourcePrice: 195_000,
    pricingObservation: {state: "unknown", source: "listing", version: 2},
  })

  applyCafe24DetailFallbacks(item, {
    name: null,
    price: 97_500,
    originalPrice: 97_500,
    salePrice: null,
    priceFormatted: "₩97,500",
    sourceCurrency: "KRW",
    sourcePrice: 97_500,
    descriptionFirstLine: null,
  })

  assert.equal(item.price, 97_500)
  assert.equal(item.originalPrice, 195_000)
  assert.equal(item.salePrice, 97_500)
  assert.deepEqual(item.pricingObservation, {
    state: "sale",
    source: "detail",
    version: 2,
  })
})

test("Cafe24 equal product and sale meta prices confirm a regular detail price", async () => {
  const page = {
    evaluate: async () => ({
      names: ["BRICK_black plain"],
      priceText: "price KRW 268,000",
      metaPrice: "268000",
      metaSalePrice: "268000",
      metaCurrency: "KRW",
      jsonLdPrice: "",
      jsonLdCurrency: "",
      scriptProductPrice: "268000",
      scriptSalePrice: "",
      detailPriceText: "",
      descFirstLine: "",
    }),
  } as unknown as Parameters<typeof extractCafe24DetailFallbacks>[0]

  const detail = await extractCafe24DetailFallbacks(page)
  assert.equal(detail.price, 268_000)
  assert.equal(detail.originalPrice, 268_000)
  assert.equal(detail.salePrice, null)

  const item = product({
    pricingObservation: {state: "unknown", source: "listing", version: 2},
  })
  applyCafe24DetailFallbacks(item, detail)
  assert.deepEqual(item.pricingObservation, {
    state: "regular",
    source: "detail",
    version: 2,
  })
})
