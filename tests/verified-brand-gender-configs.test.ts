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
  assert.deepEqual(getSiteConfig("archthe")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("percentis")?.defaultGender, ["men"])
  assert.equal(getSiteConfig("pottery")?.defaultGender, undefined)
  assert.equal(getSiteConfig("pottery")?.selectors?.productItem, "div.product__item")
  assert.ok(getSiteConfig("pottery")?.category?.categories?.some((category) => category.cateNo === 747 && category.gender?.[0] === "men"))
  assert.ok(getSiteConfig("pottery")?.category?.categories?.some((category) => category.cateNo === 1022 && category.gender?.[0] === "women"))
  for (const key of ["en-2706", "nomanual-shop"]) {
    assert.deepEqual(getSiteConfig(key)?.defaultGender, ["unisex"])
    assert.equal(getSiteConfig(key)?.verifiedUnisexDefault, true)
  }
  for (const key of ["pommedor", "sineadodwyer-1472", "stapleandhue"]) {
    assert.deepEqual(getSiteConfig(key)?.defaultGender, ["women"])
  }
  const stapleAndHue = getSiteConfig("stapleandhue")
  const stapleAndHueNoise = stapleAndHue?.kidsGenderNoisePatterns ?? []
  assert.equal(
    stapleAndHueNoise.reduce((text, pattern) => text.replace(pattern, " "), "Baby Pink Pointelle Dress").trim(),
    "Pointelle Dress",
  )
  const carneBollente = getSiteConfig("carnebollente-1704")
  assert.deepEqual(carneBollente?.defaultGender, ["unisex"])
  assert.equal(carneBollente?.verifiedUnisexDefault, true)
  assert.equal(
    (carneBollente?.kidsGenderNoisePatterns ?? [])
      .reduce((text, pattern) => text.replace(pattern, " "), "Burn Baby Burn Baby Blue").trim(),
    "Burn   Burn   Blue",
  )
  assert.deepEqual(getSiteConfig("abagavelli")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("ceciletulkens")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("ceciletulkens")?.verifiedUnisexDefault, true)
  assert.deepEqual(getSiteConfig("avvattev")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("avvattev")?.verifiedUnisexDefault, true)
  assert.deepEqual(getSiteConfig("sansangear-5471")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("sansangear-5471")?.verifiedUnisexDefault, true)
  assert.deepEqual(getSiteConfig("faneofficiel")?.defaultGender, ["women"])
  assert.equal(getSiteConfig("faneofficiel")?.defaultCategory, "bags")
  assert.deepEqual(getSiteConfig("fandco")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("fandco")?.verifiedUnisexDefault, true)
  assert.equal(getSiteConfig("fandco")?.defaultCategory, "headwear")
  assert.deepEqual(getSiteConfig("luvz")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("luvz")?.verifiedUnisexDefault, true)
  assert.equal(getSiteConfig("luvz")?.defaultCategory, "headwear")
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
  const oscitare = getSiteConfig("oscitare")
  assert.deepEqual(oscitare?.defaultGender, ["men"])
  assert.deepEqual(oscitare?.category?.categories?.map(({name, cateNo}) => ({name, cateNo})), [
    {name: "outer", cateNo: 44},
    {name: "top", cateNo: 45},
    {name: "bottom", cateNo: 46},
    {name: "acc", cateNo: 47},
  ])
  const churchillromper = getSiteConfig("churchillromper")
  assert.deepEqual(churchillromper?.defaultGender, ["men"])
  assert.deepEqual(churchillromper?.category?.categories?.map(({name, cateNo}) => ({name, cateNo})), [
    {name: "아우터", cateNo: 54},
    {name: "니트", cateNo: 77},
    {name: "상의", cateNo: 55},
    {name: "하의", cateNo: 56},
    {name: "악세서리", cateNo: 57},
  ])
  const kibata = getSiteConfig("kibata")
  assert.deepEqual(kibata?.defaultGender, ["men"])
  assert.deepEqual(kibata?.categoryUrls, ["https://www.kibata.kr/Online-Store/"])
  assert.equal(kibata?.defaultCategory, "bottoms")
  assert.equal(kibata?.defaultSubcategory, "jeans")
  const publicfigure = getSiteConfig("publicfigure")
  assert.deepEqual(publicfigure?.defaultGender, ["men"])
  assert.deepEqual(publicfigure?.categoryUrls, ["https://publicfigure.kr/shop"])
  assert.equal(publicfigure?.defaultCategory, "other")
  const wouldbe = getSiteConfig("wouldbe")
  assert.equal(wouldbe?.defaultGender, undefined)
  assert.deepEqual(wouldbe?.category?.categories?.map(({name, cateNo, gender}) => ({name, cateNo, gender})), [
    {name: "Shop", cateNo: 42, gender: ["men"]},
    {name: "Women", cateNo: 83, gender: ["women"]},
  ])
  assert.equal(wouldbe?.verifyStockFromDetail, true)
  const bants = getSiteConfig("bants")
  assert.deepEqual(bants?.defaultGender, ["men"])
  assert.deepEqual(bants?.category?.categories?.map(({name, cateNo, gender}) => ({name, cateNo, gender})), [
    {name: "BANTS", cateNo: 54, gender: ["men"]},
  ])
  const iyso = getSiteConfig("iyso")
  assert.deepEqual(iyso?.defaultGender, ["unisex"])
  assert.equal(iyso?.verifiedUnisexDefault, true)
  assert.deepEqual(iyso?.category?.categories?.map(({name, cateNo, gender}) => ({name, cateNo, gender})), [
    {name: "Shoes", cateNo: 289, gender: ["unisex"]},
    {name: "Shoes", cateNo: 62, gender: ["unisex"]},
    {name: "Shoes", cateNo: 317, gender: ["unisex"]},
    {name: "Shoes", cateNo: 312, gender: ["unisex"]},
    {name: "Shoes", cateNo: 248, gender: ["unisex"]},
    {name: "Shoes", cateNo: 249, gender: ["unisex"]},
    {name: "Shoes", cateNo: 91, gender: ["unisex"]},
    {name: "Socks", cateNo: 292, gender: ["unisex"]},
    {name: "Shoes", cateNo: 246, gender: ["unisex"]},
  ])
  assert.deepEqual(getSiteConfig("refomed")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("omotodenim")?.defaultGender, ["men"])
  const mazi = getSiteConfig("maziuntitled")
  assert.deepEqual(mazi?.defaultGender, ["unisex"])
  assert.equal(mazi?.verifiedUnisexDefault, true)
  assert.equal(mazi?.verifyStockFromDetail, true)
  assert.equal(mazi?.trustedCategory, true)
  assert.deepEqual(mazi?.category?.categories?.map(({name, cateNo, gender}) => ({name, cateNo, gender})), [
    {name: "Bags", cateNo: 101, gender: ["unisex"]},
    {name: "Bags", cateNo: 102, gender: ["unisex"]},
    {name: "Bags", cateNo: 104, gender: ["unisex"]},
    {name: "Bags", cateNo: 105, gender: ["unisex"]},
    {name: "Bags", cateNo: 106, gender: ["unisex"]},
    {name: "Bags", cateNo: 107, gender: ["unisex"]},
    {name: "Accessories", cateNo: 109, gender: ["unisex"]},
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
  assert.equal(getSiteConfig("phingerin")?.genderFromModelDescription, true)
  assert.equal(getSiteConfig("ihnomuhnit")?.genderFromModelDescription, true)
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
