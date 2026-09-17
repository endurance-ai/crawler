import assert from "node:assert/strict"
import test from "node:test"

import {isUnverifiedUnisexRow} from "../src/lib/unisex-quarantine"

const row = (over: Partial<Parameters<typeof isUnverifiedUnisexRow>[0]> = {}) => ({
  platform: "ordinary-shop",
  gender: ["unisex"],
  genderSource: "unverified_legacy",
  verifiedUnisexDefault: false,
  ...over,
})

test("약한 출처의 unisex와 과거 blanket engine 행을 격리한다", () => {
  assert.equal(isUnverifiedUnisexRow(row()), true)
  assert.equal(isUnverifiedUnisexRow(row({genderSource: "repair_brand_scope"})), true)
  assert.equal(isUnverifiedUnisexRow(row({platform: "8division", genderSource: "engine"})), true)
  assert.equal(isUnverifiedUnisexRow(row({platform: "blankroom", genderSource: "engine"})), true)
})

test("제품 단위 근거와 검증된 사이트 기본값은 격리하지 않는다", () => {
  assert.equal(isUnverifiedUnisexRow(row({genderSource: "text"})), false)
  assert.equal(isUnverifiedUnisexRow(row({genderSource: "engine"})), false)
  assert.equal(isUnverifiedUnisexRow(row({
    genderSource: "config_default",
    verifiedUnisexDefault: true,
  })), false)
  assert.equal(isUnverifiedUnisexRow(row({gender: ["women"]})), false)
})
