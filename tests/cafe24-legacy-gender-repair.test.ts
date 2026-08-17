import test from "node:test"
import assert from "node:assert/strict"

import {
  cafe24CategoryNo,
  cafe24ProductNo,
  indexCrawledGender,
} from "../tools/repair-cafe24-legacy-from-crawl"

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
    {productUrl: "https://shop.test/product/a/1/category/43/display/1/", gender: ["men"]},
    {productUrl: "https://shop.test/product/b/2/category/49/display/1/", gender: ["women"]},
    {productUrl: "https://shop.test/product/c/3/category/1/display/1/", gender: []},
  ])

  assert.deepEqual(index.get("1"), ["men"])
  assert.deepEqual(index.get("2"), ["women"])
  assert.equal(index.has("3"), false)
})

test("같은 product_no의 상충한 크롤 성별은 조용히 덮어쓰지 않는다", () => {
  assert.throws(() => indexCrawledGender([
    {productUrl: "https://shop.test/product/a/1/category/43/display/1/", gender: ["men"]},
    {productUrl: "https://shop.test/product/a/1/category/49/display/1/", gender: ["women"]},
  ]), /성별 충돌/)
})
