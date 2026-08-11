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
  const mosxe = getSiteConfig("mosxe")
  assert.deepEqual(mosxe?.defaultGender, ["women"])
  assert.deepEqual(mosxe?.category?.categories?.map(({name, cateNo}) => ({name, cateNo})), [
    {name: "NEW", cateNo: 52},
  ])
  const butterRing = getSiteConfig("butter-ring")
  assert.deepEqual(butterRing?.defaultGender, ["women"])
  assert.deepEqual(butterRing?.category?.categories?.map(({name, cateNo, gender}) => ({name, cateNo, gender})), [
    {name: "Ring", cateNo: 30, gender: ["women"]},
    {name: "Necklace", cateNo: 31, gender: ["women"]},
    {name: "Bracelet", cateNo: 42, gender: ["women"]},
    {name: "Earring", cateNo: 43, gender: ["women"]},
    {name: "Goods", cateNo: 63, gender: ["women"]},
  ])
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
  const coldCulture = getSiteConfig("coldcultureworldwide")
  assert.deepEqual(coldCulture?.defaultGender, ["men"])
  assert.deepEqual(coldCulture?.genderDepartmentTagPrefixes, {
    men: ["MEN"],
    women: ["woman", "women", "ea#woman"],
  })
  assert.equal(coldCulture?.genderFromModelDescription, true)
  const scuffers = getSiteConfig("scuffers")
  assert.deepEqual(scuffers?.defaultGender, ["unisex"])
  assert.equal(scuffers?.verifiedUnisexDefault, true)
  assert.deepEqual(scuffers?.genderDepartmentTagPrefixes?.unisex, ["BOYS OR GIRLS DROP"])
  assert.deepEqual(getSiteConfig("threetimes333")?.defaultGender, ["women"])
  assert.equal(getSiteConfig("opening-project")?.verifyStockFromDetail, true)
  const openyy = getSiteConfig("openyy")
  assert.equal(openyy?.baseUrl, "https://open-yy.com")
  assert.equal(openyy?.selectors?.productName, ".title a")
  assert.deepEqual(openyy?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 215, gender: ["unisex"]},
    {cateNo: 214, gender: ["women"]},
  ])
  const lowool = getSiteConfig("enlowool")
  assert.equal(lowool?.sourceCurrency, "USD")
  assert.deepEqual(lowool?.defaultGender, ["unisex"])
  assert.equal(lowool?.verifiedUnisexDefault, true)
  assert.equal(lowool?.trustedCategory, true)
  const yuse = getSiteConfig("yuse")
  assert.deepEqual(yuse?.defaultGender, ["women"])
  assert.equal(yuse?.verifyStockFromDetail, true)
  assert.deepEqual(yuse?.category?.categories?.map((category) => category.gender), [
    ["women"], ["women"], ["women"], ["women"], ["women"], ["women"],
  ])
  const orogee = getSiteConfig("orogee")
  assert.deepEqual(orogee?.defaultGender, ["women"])
  assert.deepEqual(orogee?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 24, gender: ["women"]},
    {cateNo: 44, gender: ["women"]},
    {cateNo: 25, gender: ["women"]},
    {cateNo: 42, gender: ["women"]},
  ])
  const threetimesNoise = getSiteConfig("threetimes333")?.kidsGenderNoisePatterns ?? []
  for (const verifiedWomenProduct of [
    "Baby shower swim bolero",
    "Baby boo cardigan",
    "tht Seamless boy short",
    "Organic milky boy short",
  ]) {
    assert.equal(
      threetimesNoise.reduce((text, pattern) => text.replace(pattern, " "), verifiedWomenProduct).trim(),
      verifiedWomenProduct.replace(/baby (?:shower|boo)|boy short/gi, " ").trim(),
    )
  }
  const scuffersNoise = scuffers?.kidsGenderNoisePatterns ?? []
  for (const verifiedAdultLabel of [
    "SCFF Baby",
    "baby tee",
    "Boys or Girls",
    "Boy Green Striped T-Shirt",
    "Kids Purple T-Shirt",
  ]) {
    assert.equal(
      scuffersNoise.reduce((text, pattern) => text.replace(pattern, " "), verifiedAdultLabel).trim(),
      "",
    )
  }
  const coldCultureNoise = coldCulture?.kidsGenderNoisePatterns ?? []
  assert.equal(
    coldCultureNoise.reduce((text, pattern) => text.replace(pattern, " "), "baby blue good boy top boy").trim(),
    "",
  )
  const margeNoise = getSiteConfig("margesherwood")?.kidsGenderNoisePatterns ?? []
  assert.equal(margeNoise.reduce((text, pattern) => text.replace(pattern, " "), "babypinklight summer girls girls club").trim(), "light")
  assert.equal(getSiteConfig("singularisca")?.brand, "singularisca")
  assert.deepEqual(getSiteConfig("singularisca")?.defaultGender, ["men"])
})
