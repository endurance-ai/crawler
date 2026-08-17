import test from "node:test"
import assert from "node:assert/strict"

import {getSiteConfig} from "../src/configs/platforms"
import {classifyGenderRepair, type ProductGenderRow} from "../src/lib/gender-repair"

const loadingroomBabyTee: ProductGenderRow = {
  id: 1,
  gender: ["unisex"],
  gender_source: "unverified_legacy",
  name: "SNAKE BABY TEE",
  category: "tops",
  subcategory: "t-shirt",
  description: null,
  product_url: "https://loading-room.com/products/snake-baby-tee-red",
  tags: ["SS26", "Tops"],
  platform: "loading-room",
  brand: "Loadingroom",
  brand_node_id: 2166,
  last_seen_at: null,
}

test("레거시 복구도 사이트별 아동복 노이즈 예외를 적용한다", () => {
  const config = getSiteConfig("loading-room")
  const decision = classifyGenderRepair(loadingroomBabyTee, {
    siteDefaultGender: config?.defaultGender,
    verifiedUnisexDefault: config?.verifiedUnisexDefault,
    kidsGenderNoisePatterns: config?.kidsGenderNoisePatterns,
    genderTextPatterns: config?.genderTextPatterns,
  })

  assert.equal(decision.bucket, "confirmed_women")
  assert.deepEqual(decision.after, ["women"])
  assert.equal(decision.gender_source, "config_default")
})

test("EPT Spray Boy 성인 상품을 kids로 오인하지 않는다", () => {
  const config = getSiteConfig("eastpacifictrade")
  const decision = classifyGenderRepair({
    ...loadingroomBabyTee,
    id: 2,
    name: "Spray Boy T-Shirt (Blue)",
    product_url: "https://eastpacifictrade.com/products/spray-boy-t-shirt-blue",
    platform: "eastpacifictrade",
    brand: "East Pacific Trade",
  }, {
    siteDefaultGender: config?.defaultGender,
    verifiedUnisexDefault: config?.verifiedUnisexDefault,
    kidsGenderNoisePatterns: config?.kidsGenderNoisePatterns,
  })

  assert.equal(decision.bucket, "unchanged")
  assert.equal(decision.gender_source, "config_default")
})

test("공식 Shopify 부서 태그 prefix를 레거시 교정에도 사용한다", () => {
  const decision = classifyGenderRepair({
    ...loadingroomBabyTee,
    id: 3,
    name: "Plain Sneaker",
    product_url: "https://kith.com/products/plain-sneaker",
    tags: ["footwear", "wmns"],
    platform: "kith",
    brand: "Example",
  }, {
    genderDepartmentTagPrefixes: {men: ["mens"], women: ["wmns"]},
  })

  assert.equal(decision.bucket, "confirmed_women")
  assert.deepEqual(decision.after, ["women"])
  assert.equal(decision.gender_source, "repair_text")
})

test("태그에만 kids가 있는 레거시 상품도 kids 버킷으로 센다", () => {
  const decision = classifyGenderRepair({
    ...loadingroomBabyTee,
    id: 4,
    name: "GS 204L Lace",
    product_url: "https://example.com/products/gs-204l-lace",
    tags: ["footwear", "kids"],
    platform: "kith",
  })

  assert.equal(decision.bucket, "kids")
})
