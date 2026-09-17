import assert from "node:assert/strict"
import test from "node:test"

import {getSiteConfig, PLATFORMS} from "../src/configs/platforms"
import {
  classifyLegacyUnisex,
  isSuspectLegacyUnisex,
} from "../tools/reclassify-legacy-unisex"

test("근거 없는 unisex 출처와 과거 blanket 설정만 재검사 대상으로 삼는다", () => {
  assert.equal(isSuspectLegacyUnisex("unverified_legacy", false, false), true)
  assert.equal(isSuspectLegacyUnisex("repair_brand_scope", false, false), true)
  assert.equal(isSuspectLegacyUnisex("config_default", true, false), true)
  assert.equal(isSuspectLegacyUnisex("engine", false, true), true)
  assert.equal(isSuspectLegacyUnisex("text", true, true), false)
  assert.equal(isSuspectLegacyUnisex("engine", false, false), false)
})

test("상품 단위 공식 근거가 사이트·브랜드 기본값보다 우선한다", () => {
  const row = {
    name: "Women Tailored Jacket",
    product_url: "https://example.com/product/jacket/1/category/20/",
    tags: ["women"],
  }
  assert.deepEqual(classifyLegacyUnisex(row, {
    categoryGender: "men",
    verifiedSiteDefault: "women",
    brandGenderScope: ["women"],
  }), {gender: "men", source: "engine", reason: "official_category"})
})

test("명시적 상품명, 검증 사이트 기본값, 단일 브랜드 순으로 회수한다", () => {
  const base = {product_url: "https://example.com/products/1", tags: [] as string[]}
  assert.deepEqual(classifyLegacyUnisex({...base, name: "Women Runner"}, {
    categoryGender: null,
    verifiedSiteDefault: "men",
    brandGenderScope: ["men"],
  }), {gender: "women", source: "repair_text", reason: "explicit_product_text"})
  assert.deepEqual(classifyLegacyUnisex({...base, name: "Runner"}, {
    categoryGender: null,
    verifiedSiteDefault: "women",
    brandGenderScope: ["men"],
  }), {gender: "women", source: "config_default", reason: "verified_site_default"})
  assert.deepEqual(classifyLegacyUnisex({...base, name: "Runner"}, {
    categoryGender: null,
    verifiedSiteDefault: null,
    brandGenderScope: ["men"],
  }), {gender: "men", source: "repair_brand_scope", reason: "single_gender_brand"})
})

test("혼성·미확인 브랜드와 아동 상품은 성인 성별을 만들지 않는다", () => {
  const base = {product_url: "https://example.com/products/1", tags: [] as string[]}
  assert.deepEqual(classifyLegacyUnisex({...base, name: "Plain Jacket"}, {
    categoryGender: null,
    verifiedSiteDefault: null,
    brandGenderScope: ["unisex"],
  }), {gender: null, source: null, reason: "unresolved"})
  assert.deepEqual(classifyLegacyUnisex({...base, name: "Kids Jacket"}, {
    categoryGender: "men",
    verifiedSiteDefault: "men",
    brandGenderScope: ["men"],
  }), {gender: null, source: null, reason: "kids_out_of_scope"})
})

test("검증되지 않은 unisex 기본값과 상품군 blanket 값은 런타임에서 제거한다", () => {
  for (const raw of PLATFORMS) {
    const config = getSiteConfig(raw.key)
    if (config?.defaultGender?.[0] === "unisex") {
      assert.equal(config.verifiedUnisexDefault, true, raw.key)
    }
  }
  for (const key of [
    "sculpstore",
    "takeastreet",
    "chanceclothing",
    "havati",
    "blankroom",
    "taats",
    "franksupply",
    "nnpcs",
    "seygun",
    "demoshop",
  ]) {
    const config = getSiteConfig(key)
    const categories = config?.category && "categories" in config.category
      ? config.category.categories ?? []
      : []
    assert.equal(categories.some(({gender}) => gender?.[0] === "unisex"), false, key)
  }
  const blankroom = getSiteConfig("blankroom")
  const blankroomCategories = blankroom?.category && "categories" in blankroom.category
    ? blankroom.category.categories ?? []
    : []
  assert.deepEqual(blankroomCategories.find(({cateNo}) => cateNo === 87)?.gender, ["men"])
  assert.deepEqual(blankroomCategories.find(({cateNo}) => cateNo === 103)?.gender, ["women"])
  assert.deepEqual(
    getSiteConfig("openyy")?.category && "categories" in getSiteConfig("openyy")!.category!
      ? getSiteConfig("openyy")!.category!.categories?.find(({cateNo}) => cateNo === 215)?.gender
      : undefined,
    ["unisex"],
  )
})
