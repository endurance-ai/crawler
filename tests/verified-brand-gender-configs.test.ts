import test from "node:test"
import assert from "node:assert/strict"

import {getSiteConfig} from "../src/configs/platforms"

test("웹 검증된 단일 성별 브랜드의 사이트 기본값이 일치한다", () => {
  const blank03 = getSiteConfig("blank03")
  assert.deepEqual(blank03?.defaultGender, ["women"])
  assert.deepEqual(
    blank03?.category && "categories" in blank03.category
      ? blank03.category.categories?.map((category) => category.gender)
      : [],
    [["women"], ["women"]],
  )

  assert.deepEqual(getSiteConfig("heretic")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("twojeys")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("porterna")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("margesherwood")?.defaultGender, ["women"])
  const biteTheBullet = getSiteConfig("brand")
  assert.deepEqual(biteTheBullet?.defaultGender, ["unisex"])
  assert.equal(biteTheBullet?.verifiedUnisexDefault, true)
  const reaven = getSiteConfig("reaven")
  assert.deepEqual(reaven?.defaultGender, ["unisex"])
  assert.equal(reaven?.verifiedUnisexDefault, true)
  const vicinity = getSiteConfig("vicinityclo")
  assert.deepEqual(vicinity?.defaultGender, ["unisex"])
  assert.equal(vicinity?.verifiedUnisexDefault, true)
  assert.deepEqual(getSiteConfig("nude-project")?.genderDepartmentTagPrefixes, {
    men: ["M_", "man_product"],
    women: ["W_", "woman_product"],
  })
  const margeNoise = getSiteConfig("margesherwood")?.kidsGenderNoisePatterns ?? []
  assert.equal(margeNoise.reduce((text, pattern) => text.replace(pattern, " "), "babypinklight summer girls girls club").trim(), "light")
  assert.equal(getSiteConfig("singularisca")?.brand, "singularisca")
  assert.deepEqual(getSiteConfig("singularisca")?.defaultGender, ["men"])
})
