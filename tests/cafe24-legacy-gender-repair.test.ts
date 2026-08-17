import test from "node:test"
import assert from "node:assert/strict"

import {
  cafe24CanonicalDetailGender,
  cafe24CanonicalDetailMatchesProduct,
  cafe24CanonicalDetailUrl,
  cafe24CategoryNo,
  cafe24ListingLastPage,
  cafe24ListingProductNos,
  cafe24OfficialCategoryUrl,
  cafe24ProductNo,
  cafe24SelectedCategoryNo,
  indexCrawledGender,
  mergeDepartmentGenders,
  officialProductGender,
} from "../tools/repair-cafe24-legacy-from-crawl"

test("검증된 Cafe24 사이트만 canonical 상세의 모델·공용 문구를 성별 근거로 쓴다", () => {
  const html = "<p>남성모델 180cm L / 여성 모델 174cm S</p>"
  assert.deepEqual(cafe24CanonicalDetailGender(html, true), ["unisex"])
  assert.equal(cafe24CanonicalDetailGender(html, false), null)
  assert.deepEqual(cafe24CanonicalDetailGender("<p>Man Model : Height 187cm / L Size 착용</p>", true), ["men"])
})

test("canonical 상세가 요청한 product_no의 실제 상품 페이지인지 검증한다", () => {
  const html = '<script>CAFE24.FRONT_JS_CONFIG_SHOP={"aProductPurchaseInfo_1557":{}}</script>'
  assert.equal(cafe24CanonicalDetailMatchesProduct(html, "1557"), true)
  assert.equal(cafe24CanonicalDetailMatchesProduct(html, "155"), false)
  assert.equal(cafe24CanonicalDetailMatchesProduct("<title>홈</title>", "1557"), false)
})

test("Cafe24 canonical 상세 URL과 원본 선택 카테고리를 복구한다", () => {
  assert.equal(
    cafe24CanonicalDetailUrl("https://shop.test/path", "1557"),
    "https://shop.test/product/detail.html?product_no=1557",
  )
  assert.equal(
    cafe24SelectedCategoryNo('<script>$("#category_no option[value=23]").attr("selected", "selected");</script>'),
    23,
  )
  assert.equal(cafe24SelectedCategoryNo("<html></html>"), null)
})

test("공식 Cafe24 목록에서 중복 없는 상품 번호와 마지막 페이지를 추출한다", () => {
  const html = `
    <a href="?cate_no=467&amp;product_no=11933">one</a>
    <a href="/product/detail.html?product_no=11933">duplicate</a>
    <a href="?cate_no=467&product_no=12168">two</a>
    <a href="?cate_no=467&amp;page=2">2</a>
    <a href="?cate_no=467&page=3">last</a>
  `
  assert.deepEqual(cafe24ListingProductNos(html), ["11933", "12168"])
  assert.equal(cafe24ListingLastPage(html, 467), 3)
})

test("LOW CLASSIC 공식 성별 카테고리는 현재 Lc 목록 템플릿을 쓴다", () => {
  assert.equal(
    cafe24OfficialCategoryUrl("lowclassic", "https://lowclassic.com", 467, 3),
    "https://lowclassic.com/product/lc-list.html?cate_no=467&page=3",
  )
})

test("Cafe24 쿼리형과 rewrite형 URL에서 같은 product_no를 추출한다", () => {
  assert.equal(cafe24ProductNo("https://shop.test/product/detail.html?product_no=83&cate_no=43"), "83")
  assert.equal(cafe24ProductNo("https://shop.test/product/some-name/83/category/49/display/1/"), "83")
  assert.equal(cafe24ProductNo("not-a-url"), null)
})

test("Cafe24 쿼리형과 rewrite형 URL에서 공식 cate_no를 추출한다", () => {
  assert.equal(cafe24CategoryNo("https://shop.test/product/detail.html?product_no=83&cate_no=43"), 43)
  assert.equal(cafe24CategoryNo("https://shop.test/product/a/83/category/49/display/1/"), 49)
  assert.equal(cafe24CategoryNo("not-a-url"), null)
})

test("현행 크롤 결과는 단일 성별 product_no만 복구 근거로 색인한다", () => {
  const index = indexCrawledGender([
    {productUrl: "https://shop.test/product/a/1/category/43/display/1/", gender: ["men"], genderSource: "engine"},
    {productUrl: "https://shop.test/product/b/2/category/49/display/1/", gender: ["women"], genderSource: "url"},
    {productUrl: "https://shop.test/product/c/3/category/1/display/1/", gender: [], genderSource: "text"},
    {productUrl: "https://shop.test/product/d/4/category/1/display/1/", gender: ["unisex"]},
  ])

  assert.deepEqual(index.get("1"), ["men"])
  assert.deepEqual(index.get("2"), ["women"])
  assert.equal(index.has("3"), false)
  assert.equal(index.has("4"), false)
})

test("같은 product_no의 남녀 부서 크롤 결과는 unisex로 합친다", () => {
  const index = indexCrawledGender([
    {productUrl: "https://shop.test/product/a/1/category/43/display/1/", gender: ["men"], genderSource: "engine"},
    {productUrl: "https://shop.test/product/a/1/category/49/display/1/", gender: ["women"], genderSource: "engine"},
  ])
  assert.deepEqual(index.get("1"), ["unisex"])
})

test("동일 SKU가 공식 남녀 부서에 모두 있으면 unisex로 합친다", () => {
  assert.deepEqual(mergeDepartmentGenders([["women"], ["men"]]), ["unisex"])
  assert.deepEqual(mergeDepartmentGenders([["women"], ["women"]]), ["women"])
  assert.deepEqual(mergeDepartmentGenders([["unisex"], ["women"]]), ["unisex"])
  assert.equal(mergeDepartmentGenders([]), null)
})

test("THE INNRS의 부서 URL 유실 상품은 공식 상품 근거로 복구한다", () => {
  assert.deepEqual(officialProductGender("theinnrs", "75"), ["women"])
  assert.deepEqual(officialProductGender("theinnrs", "84"), ["unisex"])
  assert.deepEqual(officialProductGender("theinnrs", "89"), ["unisex"])
  assert.deepEqual(officialProductGender("theinnrs", "95"), ["unisex"])
  assert.equal(officialProductGender("theinnrs", "99999"), null)
})
