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
