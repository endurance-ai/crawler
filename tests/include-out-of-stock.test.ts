/**
 * 품절 상품 수집 스위치 (--include-out-of-stock) 회귀 테스트.
 *
 * 배경: 품절 상품은 import 플래그(--in-stock-only)가 아니라 **크롤 레이어**에서
 * 버려진다. 2026-06 코호트 재수집 실측 기준 대상 60,634행 중 14,971행(24.7%)이
 * 품절이었고 (mohawk-general/bodega 는 각각 83%), 이 필터를 끄지 못하면 그 행들만
 * 옛 추출 로직 산물로 영구히 남는다.
 *
 * 두 가지를 잠근다:
 *   1. 기본 동작 불변 — 플래그 없이는 종전과 동일하게 품절이 빠진다 (골든 마스터
 *      불변식. shopify-parse.characterization.test.ts 가 이 전제 위에 서 있다).
 *   2. listingOnly 재사용 금지 — cafe24 에서 listingOnly 는 상세 크롤을 끄는
 *      스위치를 겸하므로 재수집에 쓸 수 없다. 별도 플래그여야 한다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {parseShopifyProducts} from "../src/lib/shopify-engine"
import {
  cafe24BrandOverride,
  cafe24ManualCategoryUrl,
  cafe24ProductIdentityKey,
  inferCafe24DetailStock,
  inferCafe24ListingStock,
  mergeCafe24DuplicateCategory,
  mergeCafe24DuplicateGender,
  reuseExistingCafe24Detail,
  shouldKeepOutOfStock,
} from "../src/lib/cafe24-engine"

import type {Product} from "../src/lib/types"
import fixture from "./fixtures/shopify-products.fixture.json" with {type: "json"}

test("cafe24: restart reuses cached detail and restores its completion marker", () => {
  const product = {
    productUrl: "https://shop.test/product/item/1/category/24/display/1/",
  } as Product
  const detail = {material: null, productCode: "P-1"}

  assert.equal(reuseExistingCafe24Detail(product, detail, false), detail)
  assert.match(product.detailFetchedAt ?? "", /^\d{4}-\d{2}-\d{2}T/)

  const stockVerified = {...product, detailFetchedAt: undefined}
  assert.equal(reuseExistingCafe24Detail(stockVerified, detail, true), null)
  assert.equal(stockVerified.detailFetchedAt, undefined)
})

test("cafe24: custom shop page can be used as a manual category URL", () => {
  assert.equal(
    cafe24ManualCategoryUrl("https://sideservice.store", {cateNo: 1, url: "/shop/all.html"}),
    "https://sideservice.store/shop/all.html",
  )
  assert.equal(
    cafe24ManualCategoryUrl("https://example.com", {cateNo: 24}),
    "https://example.com/product/list.html?cate_no=24",
  )
})

test("cafe24: product-name sold-out evidence overrides an empty badge placeholder", () => {
  assert.equal(inferCafe24ListingStock(true, "[SOLD OUT] Layered T-Shirt"), false)
  assert.equal(inferCafe24ListingStock(true, "Out of stock Knit"), false)
  assert.equal(inferCafe24ListingStock(true, "품절 Wool Coat"), false)
  assert.equal(inferCafe24ListingStock(true, "Layered T-Shirt"), true)
})

test("cafe24: 멀티브랜드 편집샵은 config.brand를 상품 브랜드로 고정하지 않는다", () => {
  assert.equal(cafe24BrandOverride({brand: "KAMADEVA", multiBrand: true}), undefined)
  assert.equal(cafe24BrandOverride({brand: "LOWOOL", multiBrand: false}), "LOWOOL")
})

test("cafe24: 상세 옵션 중 판매 가능 재고가 하나라도 있으면 재고 있음으로 판정한다", () => {
  assert.equal(inferCafe24DetailStock({
    optionStockData: JSON.stringify({
      sold: {is_display: "T", is_selling: "T", use_stock: true, stock_number: 0},
      available: {is_display: "T", is_selling: "T", use_stock: true, stock_number: 34},
    }),
    buyVisible: false,
    soldOutVisible: true,
  }), true)
})

test("cafe24: 상세 옵션이 모두 품절이면 구매 버튼보다 옵션 재고를 우선한다", () => {
  assert.equal(inferCafe24DetailStock({
    optionStockData: {
      sold: {is_display: "T", is_selling: "T", use_stock: "T", stock_number: 0},
    },
    buyVisible: true,
    soldOutVisible: false,
  }), false)
})

test("cafe24: 같은 상품이 공식 Man/Woman 부서에 모두 있으면 공용 근거로 병합한다", () => {
  const product = (gender: string[]): Product => ({
    brand: "Opening Project", name: "Shared Bag", category: "department", gender,
    genderSource: "engine", price: 1000, originalPrice: 1000, salePrice: null,
    priceFormatted: "₩1,000", imageUrl: "https://example.com/image.jpg",
    productUrl: "https://example.com/product/1", inStock: true, platform: "opening-project",
  })
  const existing = product(["men"])
  mergeCafe24DuplicateGender(existing, product(["women"]))
  assert.deepEqual(existing.gender, ["unisex"])
  assert.equal(existing.genderSource, "engine")
})

test("cafe24: 동일한 unisex 기본값 중복은 engine 근거로 승격하지 않는다", () => {
  const product = (): Product => ({
    brand: "NOMANUAL", name: "T-SHIRT (WOMAN)", category: "all", gender: ["unisex"],
    genderSource: "config_default", price: 1000, originalPrice: 1000, salePrice: null,
    priceFormatted: "₩1,000", imageUrl: "https://example.com/image.jpg",
    productUrl: "https://example.com/product/1", inStock: true, platform: "nomanual-shop",
  })
  const existing = product()
  mergeCafe24DuplicateGender(existing, product())
  assert.deepEqual(existing.gender, ["unisex"])
  assert.equal(existing.genderSource, "config_default")
})

test("cafe24: 범용 Shop보다 뒤에서 발견한 구체 상품 카테고리를 보존한다", () => {
  const product = (category: string, subcategory: string | null = null): Product => ({
    brand: "LOWOOL", name: "Sang", category, subcategory, gender: ["unisex"],
    genderSource: "config_default", price: 100, originalPrice: 100, salePrice: null,
    priceFormatted: "$100", imageUrl: "https://example.com/image.jpg",
    productUrl: "https://example.com/product/1", inStock: true, platform: "enlowool",
  })
  const existing = product("Shop")
  mergeCafe24DuplicateCategory(existing, product("jewelry", "necklace"))
  assert.equal(existing.category, "jewelry")
  assert.equal(existing.subcategory, "necklace")

  mergeCafe24DuplicateCategory(existing, product("other"))
  assert.equal(existing.category, "jewelry")
})

test("cafe24: 카테고리 경로가 달라도 같은 상품번호는 하나의 상품으로 본다", () => {
  const man = "https://opening-project.com/product/shared-bag/1368/category/137/display/1/"
  const woman = "https://opening-project.com/product/shared-bag/1368/category/138/display/1/"
  assert.equal(cafe24ProductIdentityKey(man), cafe24ProductIdentityKey(woman))
  assert.equal(
    cafe24ProductIdentityKey("https://example.com/product/detail.html?product_no=1368&cate_no=137"),
    "example.com:product:1368",
  )
})

const BASE_URL = "https://example-shop.com"
const KEY = "example-shop"

// 픽스처의 "Sold Out Wool Coat" 는 모든 variant 가 available:false 인 유일한 상품이다.
const SOLD_OUT_TITLE = "Sold Out Wool Coat"

test("shopify: 기본값은 품절 상품을 제외한다 (골든 마스터 불변)", () => {
  const products = parseShopifyProducts(fixture as never, BASE_URL, KEY, {})
  const titles = products.map((p) => p.name)
  assert.ok(
    !titles.includes(SOLD_OUT_TITLE),
    `기본 파싱에 품절 상품이 섞였다: ${titles.join(", ")}`,
  )
  assert.ok(products.every((p) => p.inStock), "기본 파싱 결과는 전부 재고 보유여야 한다")
})

test("shopify: keepOutOfStock 이면 품절 상품이 남고, 재고 상품 집합은 그대로다", () => {
  const withoutOos = parseShopifyProducts(fixture as never, BASE_URL, KEY, {})
  const withOos = parseShopifyProducts(fixture as never, BASE_URL, KEY, {keepOutOfStock: true})

  const oosTitles = withOos.filter((p) => !p.inStock).map((p) => p.name)
  assert.deepEqual(oosTitles, [SOLD_OUT_TITLE], "품절 상품이 정확히 하나 남아야 한다")

  // 품절을 남기는 것 외에 재고 상품의 파싱 결과는 한 글자도 달라지면 안 된다.
  const inStockNames = (list: typeof withOos) => list.filter((p) => p.inStock).map((p) => p.productUrl)
  assert.deepEqual(
    inStockNames(withOos),
    inStockNames(withoutOos),
    "keepOutOfStock 은 재고 상품 파싱에 영향을 주면 안 된다",
  )
})

test("cafe24: shouldKeepOutOfStock 은 listingOnly 와 includeOutOfStock 을 각각 인정한다", () => {
  assert.equal(shouldKeepOutOfStock({}), false)
  assert.equal(shouldKeepOutOfStock({listingOnly: true}), true)
  assert.equal(shouldKeepOutOfStock({includeOutOfStock: true}), true)
  assert.equal(shouldKeepOutOfStock({listingOnly: true, includeOutOfStock: true}), true)

  // 재수집은 품절까지 상세를 받아야 하므로 listingOnly 로 대체할 수 없다.
  // (crawlCafe24 의 Step 3 상세 크롤 게이트가 !options.listingOnly 이기 때문)
  assert.equal(
    shouldKeepOutOfStock({includeOutOfStock: true}),
    shouldKeepOutOfStock({listingOnly: true}),
    "두 플래그의 품절 판정 결과는 같아야 한다 — 다른 것은 상세 크롤 게이트뿐이다",
  )
})
