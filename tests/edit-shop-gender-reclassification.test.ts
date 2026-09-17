import test from "node:test"
import assert from "node:assert/strict"

import {
  classifyEditShopProduct,
  mergeOfficialDepartmentMemberships,
  resolveOfficialDepartmentMemberships,
  shouldDeactivateUnresolvedUnisex,
  type EditShopProductRow,
} from "../tools/reclassify-edit-shop-gender"

const base: EditShopProductRow = {
  id: "1",
  platform: "8division",
  name: "Plain jacket",
  product_url: "https://shop.test/product/plain-jacket/101/category/1/display/1/",
  tags: null,
  gender: ["unisex"],
  gender_source: "engine",
  brand_node_id: 10,
  in_stock: true,
}

test("공식 남녀 부서에 모두 속한 상품만 unisex로 합친다", () => {
  assert.equal(mergeOfficialDepartmentMemberships(new Set(["men", "women"])), "unisex")
  assert.equal(mergeOfficialDepartmentMemberships(new Set(["men"])), "men")
  assert.equal(mergeOfficialDepartmentMemberships(new Set()), null)
})

test("FR8IGHT의 별도 WOMAN 라인은 일반 브랜드 All보다 우선한다", () => {
  assert.equal(resolveOfficialDepartmentMemberships("fr8ight", new Set(["men", "women"])), "women")
  assert.equal(resolveOfficialDepartmentMemberships("8division", new Set(["men", "women"])), "unisex")
})

test("공식 상품 부서가 편집샵의 과거 blanket unisex보다 우선한다", () => {
  assert.deepEqual(
    classifyEditShopProduct(base, {officialGender: "women", brandGenderScope: ["men"]}),
    {gender: "women", source: "engine", reason: "official_department"},
  )
})

test("KITH의 공식 mens/wmns 태그는 단일 및 양쪽 부서를 구분한다", () => {
  const kith = {...base, platform: "kith", tags: ["apparel", "wmns"]}
  assert.deepEqual(
    classifyEditShopProduct(kith, {officialGender: null, brandGenderScope: ["unisex"]}),
    {gender: "women", source: "engine", reason: "official_department_tag"},
  )
  assert.deepEqual(
    classifyEditShopProduct({...kith, tags: ["mens", "wmns"]}, {officialGender: null, brandGenderScope: []}),
    {gender: "unisex", source: "engine", reason: "official_department_tag"},
  )
  assert.deepEqual(
    classifyEditShopProduct({...kith, name: "NikeSKIMS WMNS Rift", tags: ["mens", "wmns"]}, {
      officialGender: null,
      brandGenderScope: [],
    }),
    {gender: "women", source: "engine", reason: "official_department_tag"},
  )
})

test("KITH kids 태그 상품은 성인 성별로 세탁하지 않고 범위 밖으로 분리한다", () => {
  assert.deepEqual(
    classifyEditShopProduct({...base, platform: "kith", tags: ["kids", "wmns"]}, {
      officialGender: "women",
      brandGenderScope: ["women"],
    }),
    {gender: null, source: null, reason: "kids_out_of_scope"},
  )
})

test("공식 부서가 없으면 명시적 상품명, 검증된 단일 성별 브랜드 순으로 사용한다", () => {
  assert.deepEqual(
    classifyEditShopProduct({...base, name: "WOMEN'S PLEATED SKIRT"}, {
      officialGender: null,
      brandGenderScope: ["men"],
    }),
    {gender: "women", source: "repair_text", reason: "explicit_product_text"},
  )
  assert.deepEqual(
    classifyEditShopProduct(base, {officialGender: null, brandGenderScope: ["men"]}),
    {gender: "men", source: "repair_brand_scope", reason: "single_gender_brand"},
  )
})

test("혼성·미확인 브랜드는 상품 근거 없이 unisex로 만들지 않는다", () => {
  assert.equal(
    classifyEditShopProduct(base, {officialGender: null, brandGenderScope: ["unisex"]}),
    null,
  )
  assert.equal(
    classifyEditShopProduct(base, {officialGender: null, brandGenderScope: ["men", "women"]}),
    null,
  )
})

test("판정 불가인 과거 blanket unisex 활성 행만 격리한다", () => {
  assert.equal(shouldDeactivateUnresolvedUnisex(base), true)
  assert.equal(shouldDeactivateUnresolvedUnisex({...base, gender_source: "unverified_legacy"}), true)
  assert.equal(shouldDeactivateUnresolvedUnisex({...base, gender_source: "repair_brand_scope"}), true)
  assert.equal(shouldDeactivateUnresolvedUnisex({...base, gender_source: "text"}), false)
  assert.equal(shouldDeactivateUnresolvedUnisex({...base, gender: ["men"]}), false)
  assert.equal(shouldDeactivateUnresolvedUnisex({...base, in_stock: false}), false)
})
