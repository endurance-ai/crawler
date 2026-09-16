import test from "node:test"
import assert from "node:assert/strict"

import {
  inferVerifiedSiteGenderFromName,
  SITE_GENDER_DEFAULTS,
} from "../src/configs/gender-defaults"
import {getSiteConfig} from "../src/configs/platforms"

test("8DIVISION의 성별 미구분 상품군을 unisex로 세탁하지 않는다", () => {
  const eightDivision = getSiteConfig("8division")
  assert.ok(eightDivision?.category?.categories?.length)
  assert.ok(eightDivision.category.categories.every((category) => category.gender === undefined))
  assert.equal(eightDivision.defaultGender, undefined)
  assert.notEqual(eightDivision.verifiedUnisexDefault, true)
})

test("Jijivisha 자사몰은 검증된 여성 카탈로그 기본값을 사용한다", () => {
  const jijivisha = getSiteConfig("jijivisha")
  assert.deepEqual(jijivisha?.defaultGender, ["women"])
  assert.notEqual(jijivisha?.verifiedUnisexDefault, true)
})

test("NOIRER 혼성 브랜드의 상품 성별은 공식 MEN/WOMEN 부서에서 가져온다", () => {
  const noirer = getSiteConfig("noirer")
  assert.equal(noirer?.defaultGender, undefined)
  assert.notEqual(noirer?.verifiedUnisexDefault, true)
  assert.deepEqual(noirer?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 76, gender: ["men"]},
    {cateNo: 202, gender: ["men"]},
    {cateNo: 321, gender: ["men"]},
    {cateNo: 341, gender: ["men"]},
    {cateNo: 180, gender: ["women"]},
    {cateNo: 326, gender: ["women"]},
  ])
})

test("999HUMANITY와 COOR는 공식 MEN/WOMEN 상위 부서에서 상품 성별을 가져온다", () => {
  for (const [key, expectedParents, expectedLeaves] of [
    ["humanity", [42, 43, 23, 49], [45, 59, 245, 47, 180, 66, 55, 51, 244, 52, 243, 67, 69]],
    ["en-1111", [75, 74], [94, 95, 76, 78, 79, 80, 81, 82, 83, 93, 92, 84, 85, 86, 87, 102, 88, 98, 97]],
  ] as const) {
    const config = getSiteConfig(key)
    assert.equal(config?.defaultGender, undefined)
    assert.equal(config?.trustedCategory, true)
    const categories = config?.category?.categories ?? []
    assert.ok(expectedParents.every((cateNo) => categories.some((category) => category.cateNo === cateNo)))
    assert.ok(expectedLeaves.every((cateNo) => categories.some((category) => category.cateNo === cateNo)))
    assert.ok(categories.every((category) => category.gender?.length === 1))
  }

  const coorCategories = getSiteConfig("en-1111")?.category?.categories ?? []
  for (const cateNo of [178, 179, 181]) {
    assert.deepEqual(coorCategories.find((category) => category.cateNo === cateNo)?.gender, ["men"])
  }
  assert.deepEqual(coorCategories.find((category) => category.cateNo === 182)?.gender, ["women"])
  assert.deepEqual(coorCategories.find((category) => category.cateNo === 186)?.gender, ["men"])
})

test("TEKET 일반 라인은 공용이고 Women 명시 상품은 여성으로 우선 분리한다", () => {
  const teket = getSiteConfig("te-ket")
  assert.deepEqual(teket?.defaultGender, ["unisex"])
  assert.equal(teket?.verifiedUnisexDefault, true)
  assert.equal(teket?.genderTextPatterns?.women?.some((pattern) => pattern.test("Plan Women Tee White")), true)
  assert.equal(teket?.genderTextPatterns?.women?.some((pattern) => pattern.test("Plan Tee White")), false)
})

test("WOOYOUNGMI 공식 온라인스토어는 남성 카탈로그 기본값을 사용한다", () => {
  assert.deepEqual(getSiteConfig("wooyoungmi")?.defaultGender, ["men"])
})

test("EPT 공식 신발·의류 카탈로그는 검증된 공용 기본값을 사용한다", () => {
  const ept = getSiteConfig("eastpacifictrade")
  assert.deepEqual(ept?.defaultGender, ["unisex"])
  assert.equal(ept?.verifiedUnisexDefault, true)
})

test("추가 공식몰의 검증된 브랜드 성별 기본값을 유지한다", () => {
  for (const [key, gender] of [
    ["meller", ["unisex"]],
    ["mmmcorp", ["women"]],
    ["intheraw", ["men"]],
    ["sandric", ["women"]],
    ["unaffected-2757", ["men"]],
    ["werkstatt-muenchen", ["unisex"]],
  ] as const) {
    const config = getSiteConfig(key)
    assert.deepEqual(config?.defaultGender, gender)
    assert.equal(config?.verifiedUnisexDefault, gender[0] === "unisex" ? true : undefined)
  }
})

test("LOW CLASSIC·SUADE·NOT4NERD의 공식 혼성 부서를 상품 단위로 보존한다", () => {
  const lowClassic = getSiteConfig("lowclassic")
  assert.deepEqual(lowClassic?.defaultGender, ["women"])
  assert.equal(lowClassic?.kidsGenderNoisePatterns?.[0].test("Hollywood Baby Tee"), true)
  assert.deepEqual(
    lowClassic?.category?.categories?.filter(({cateNo}) => [467, 468].includes(cateNo)).map(({cateNo, gender}) => ({cateNo, gender})),
    [{cateNo: 467, gender: ["unisex"]}, {cateNo: 468, gender: ["unisex"]}],
  )
  assert.deepEqual(getSiteConfig("suade")?.category?.categories?.filter(({cateNo}) => [24, 83].includes(cateNo)).map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 24, gender: ["men"]},
    {cateNo: 83, gender: ["women"]},
  ])
  assert.deepEqual(getSiteConfig("not4nerd")?.category?.categories?.find(({cateNo}) => cateNo === 88)?.gender, ["women"])
  assert.deepEqual(getSiteConfig("not4nerd")?.defaultGender, ["men"])
})

test("NUAKLE·AEKKI의 공식 남녀 부서를 레거시 상품까지 보존한다", () => {
  const nuakle = getSiteConfig("nuakle")!
  assert.deepEqual(nuakle.category?.categories?.find(({cateNo}) => cateNo === 75)?.gender, ["men"])
  assert.deepEqual(nuakle.category?.categories?.find(({cateNo}) => cateNo === 74)?.gender, ["women"])
  assert.equal(nuakle.genderTextPatterns?.men?.[0].test("(m) Safari jacket"), true)
  assert.equal(nuakle.genderTextPatterns?.women?.[0].test("(w) Safari jacket"), true)

  const aekki = getSiteConfig("aekki")!
  assert.deepEqual(aekki.defaultGender, ["men"])
  assert.deepEqual(aekki.category?.categories?.find(({cateNo}) => cateNo === 367)?.gender, ["women"])
})

test("LUNDY·ROARINGRAD·Aieul의 공식 상품 성별 구조를 보존한다", () => {
  assert.deepEqual(getSiteConfig("lundy")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("roaringrad")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("roaringrad")?.verifiedUnisexDefault, true)
  assert.equal(getSiteConfig("roaringrad")?.genderTextPatterns?.women?.[0].test("W.Slub Tee"), true)

  const aieul = getSiteConfig("aieul")!
  assert.deepEqual(aieul.category?.categories?.find(({cateNo}) => cateNo === 88)?.gender, ["men"])
  assert.deepEqual(aieul.category?.categories?.find(({cateNo}) => cateNo === 94)?.gender, ["women"])
})

test("ROLLING STUDIOS·LIBERE의 공식 유니섹스 범위를 보존한다", () => {
  for (const key of ["rollingstudios", "libere-official"]) {
    assert.deepEqual(getSiteConfig(key)?.defaultGender, ["unisex"])
    assert.equal(getSiteConfig(key)?.verifiedUnisexDefault, true)
  }
})

test("ROUGHTYPE·ANIV의 공식 여성 카탈로그 기본값을 보존한다", () => {
  assert.deepEqual(getSiteConfig("rough-type")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("aniv")?.defaultGender, ["women"])
})

test("0Tape 여성 카탈로그를 과거 편집샵 unisex 값으로 분류하지 않는다", () => {
  const tape = getSiteConfig("tape00")
  assert.deepEqual(tape?.defaultGender, ["women"])
  assert.notEqual(tape?.verifiedUnisexDefault, true)
})

test("Loadingroom 여성 카탈로그를 레거시 unisex 값으로 분류하지 않는다", () => {
  const loadingroom = getSiteConfig("loading-room")
  assert.deepEqual(loadingroom?.defaultGender, ["women"])
  assert.notEqual(loadingroom?.verifiedUnisexDefault, true)
  assert.equal(
    loadingroom?.kidsGenderNoisePatterns?.some((pattern) => "BABY TEE".replace(pattern, "").trim() === ""),
    true,
  )
})

test("ERER 혼성 카탈로그는 공식 WOMEN/MEN 부서로 상품 성별을 분류한다", () => {
  const erer = getSiteConfig("erer")
  assert.equal(erer?.defaultGender, undefined)
  assert.notEqual(erer?.verifiedUnisexDefault, true)
  assert.equal(erer?.cafe24CanonicalDetailGender, true)
  assert.equal(erer?.genderTextPatterns?.unisex?.[0]?.test("[UN] Basic Logo T-Shirt"), true)
  assert.deepEqual(erer?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 118, gender: ["women"]},
    {cateNo: 119, gender: ["men"]},
  ])
})

test("여성 자사몰과 혼성 브랜드의 검증된 여성 상품 예외를 보존한다", () => {
  assert.deepEqual(getSiteConfig("innir")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("odlyworkshop")?.defaultGender, ["women"])
  assert.equal(
    inferVerifiedSiteGenderFromName("blackpurple", "[REFURB]Deux-Eyelet Long Handle Bag_Red"),
    "women",
  )
  assert.equal(
    inferVerifiedSiteGenderFromName("mmmcorp", "Cotton Check Pattern T-Shirts_Check"),
    "women",
  )
  assert.equal(inferVerifiedSiteGenderFromName("blackpurple", "Basic Chain Necklace"), null)
  assert.equal(inferVerifiedSiteGenderFromName("mmmcorp", "Basic Logo T-Shirt"), null)
})

test("추가 여성 브랜드와 혼성 편집샵의 상품 단위 성별 근거를 보존한다", () => {
  assert.deepEqual(getSiteConfig("ballew")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("chiyagistore")?.defaultGender, ["women"])

  const swallowLounge = getSiteConfig("swallowlounge")
  assert.equal(swallowLounge?.defaultGender, undefined)
  assert.ok(swallowLounge?.category?.categories?.length)
  assert.ok(swallowLounge.category.categories.every((category) => category.gender?.length === 1))
  assert.ok(swallowLounge.category.categories.some((category) => category.gender?.[0] === "men"))
  assert.ok(swallowLounge.category.categories.some((category) => category.gender?.[0] === "women"))
  assert.equal(
    inferVerifiedSiteGenderFromName("swallowlounge", "Inside Out Tote S / CERATO BRIGHT"),
    "women",
  )
  assert.equal(inferVerifiedSiteGenderFromName("swallowlounge", "ITTI MARY SACOCHE"), null)
})

test("신규 공식몰의 검증된 성별 기본값과 상품명 예외를 보존한다", () => {
  assert.deepEqual(getSiteConfig("girlsgirls")?.defaultGender, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.amiment, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.soonsuofficial, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS["afb-afb-afb"], ["men"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.twentyoneaugust, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.findoubt, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.jabberwocky, ["men"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.sirena, ["women"])
  assert.equal(inferVerifiedSiteGenderFromName("afb-afb-afb", "WMS POLO DRESS"), "women")
  assert.equal(inferVerifiedSiteGenderFromName("afb-afb-afb", "TECH SKULLCAP"), null)
  assert.equal(inferVerifiedSiteGenderFromName("whateverwewant", "W'S ZIP KNIT"), "women")
})

test("FEYRE는 공식 여성 SHOP 전체 목록을 수집한다", () => {
  const feyre = getSiteConfig("feyre")
  assert.equal(feyre?.disabled, undefined)
  assert.deepEqual(feyre?.defaultGender, ["women"])
  assert.equal(feyre?.trustedCategory, true)
  assert.deepEqual(feyre?.category?.categories?.map(({cateNo}) => cateNo), [30, 31, 50, 29])
})

test("NOS COULEURS는 공식 남녀 모델 근거의 공용 All 목록을 수집한다", () => {
  const nosCouleurs = getSiteConfig("noscouleurs")
  assert.equal(nosCouleurs?.disabled, undefined)
  assert.deepEqual(nosCouleurs?.defaultGender, ["unisex"])
  assert.equal(nosCouleurs?.verifiedUnisexDefault, true)
  assert.equal(nosCouleurs?.trustedCategory, true)
  assert.deepEqual(nosCouleurs?.category?.categories?.map(({cateNo}) => cateNo), [24, 25, 27, 28])
})

test("KIJIKO는 공식 여성 카탈로그의 메인 상품 피드를 수집한다", () => {
  const kijiko = getSiteConfig("kijiko")
  assert.equal(kijiko?.disabled, undefined)
  assert.deepEqual(kijiko?.defaultGender, ["women"])
  assert.equal(kijiko?.selectors?.productName, 'img[id^="eListPrdImage"]')
  assert.deepEqual(kijiko?.category?.categories, [
    {name: "SHOP", cateNo: 1, gender: ["women"], url: "/"},
  ])
})

test("ROYAL OAK은 공식 26HS 여성 카탈로그 범위를 유지한다", () => {
  const royalOak = getSiteConfig("royaloakseoul")
  assert.equal(royalOak?.disabled, undefined)
  assert.deepEqual(royalOak?.defaultGender, ["women"])
  assert.deepEqual(royalOak?.category?.categories?.map(({cateNo}) => cateNo), [24])
  assert.equal(
    royalOak?.kidsGenderNoisePatterns?.some((pattern) => "BABY WAVE SHORTS".replace(pattern, "").trim() === "SHORTS"),
    true,
  )
})

test("SIDE는 검증된 공식 전체 목록 설정으로 활성화한다", () => {
  const side = getSiteConfig("sideservice")
  assert.equal(side?.disabled, undefined)
  assert.deepEqual(side?.category?.categories, [{name: "ALL", cateNo: 1, url: "/shop/all.html"}])
  assert.equal(side?.crawlDetails, true)
})

test("LYJEL SERVICE는 공식 MEN/WOMEN 카테고리 근거를 상품별로 유지한다", () => {
  const lyjel = getSiteConfig("lyjelservice")
  assert.equal(lyjel?.defaultGender, undefined)
  assert.equal(lyjel?.selectors?.productItem, "li.mun-prdlist__item")
  assert.deepEqual(lyjel?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 63, gender: ["men"]},
    {cateNo: 70, gender: ["women"]},
  ])
})

test("NOMANUAL의 공식 WOMAN baby tee는 아동복으로 오인하지 않는다", () => {
  const patterns = getSiteConfig("nomanual-shop")?.genderTextPatterns?.women ?? []
  assert.equal(patterns.some((pattern) => pattern.test("NO RELIGION HENLEY BABY TEE")), true)
})

test("TEXTURE SEOUL은 빈 표준 목록 대신 공식 pretty URL 카테고리를 수집한다", () => {
  const texture = getSiteConfig("textureseoul")
  assert.equal(texture?.category?.discovery, "manual")
  assert.equal(texture?.selectors?.productName, "h3.project-excerpt-title-inner")
  assert.equal(
    texture?.selectors?.productPrice,
    ".project-excerpt-tags > .project-excerpt-tags-inner:nth-of-type(2)",
  )
  assert.deepEqual(texture?.category?.categories?.map(({cateNo, gender, url}) => ({cateNo, gender, url})), [
    {cateNo: 42, gender: undefined, url: "/category/outerwears/42/"},
    {cateNo: 43, gender: undefined, url: "/category/top/43/"},
    {cateNo: 132, gender: undefined, url: "/category/knitwears/132/"},
    {cateNo: 44, gender: undefined, url: "/category/bottoms/44/"},
    {cateNo: 45, gender: ["women"], url: "/category/dresses/45/"},
    {cateNo: 81, gender: undefined, url: "/category/accessories/81/"},
    {cateNo: 128, gender: undefined, url: "/category/本-texture/128/"},
  ])
  assert.equal(texture?.paginate, false)
})

test("웹 검증된 단일 성별 브랜드의 사이트 기본값이 일치한다", () => {
  const cacele = getSiteConfig("cacele")
  assert.deepEqual(cacele?.defaultGender, ["women"])
  assert.equal(cacele?.selectors?.productItem, 'li[id^="anchorBoxId_"]')
  assert.deepEqual(cacele?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 52, gender: ["women"]},
    {cateNo: 53, gender: ["women"]},
    {cateNo: 54, gender: ["women"]},
    {cateNo: 55, gender: ["women"]},
    {cateNo: 56, gender: ["women"]},
  ])
  const blank03 = getSiteConfig("blank03")
  assert.deepEqual(blank03?.defaultGender, ["women"])
  assert.deepEqual(
    blank03?.category && "categories" in blank03.category
      ? blank03.category.categories?.map((category) => category.gender)
      : [],
    [["women"], ["women"]],
  )

  assert.deepEqual(getSiteConfig("heretic")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("toomuch")?.defaultGender, ["women"])
  assert.equal(getSiteConfig("toomuch")?.kidsGenderNoisePatterns?.length, 1)
  assert.deepEqual(getSiteConfig("twojeys")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("porterna")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("margesherwood")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("archthe")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("percentis")?.defaultGender, ["men"])
  assert.equal(getSiteConfig("pottery")?.defaultGender, undefined)
  assert.equal(getSiteConfig("pottery")?.selectors?.productItem, "div.product__item")
  assert.ok(getSiteConfig("pottery")?.category?.categories?.some((category) => category.cateNo === 747 && category.gender?.[0] === "men"))
  assert.ok(getSiteConfig("pottery")?.category?.categories?.some((category) => category.cateNo === 1022 && category.gender?.[0] === "women"))
  const liha = getSiteConfig("liha")
  assert.deepEqual(liha?.defaultGender, ["unisex"])
  assert.equal(liha?.verifiedUnisexDefault, true)
  assert.equal(liha?.defaultCategory, "other")
  assert.equal(liha?.sourceCurrency, "GBP")
  const tatras = getSiteConfig("tatras-official")
  assert.deepEqual(tatras?.shopifyGenderCollections, {
    men: ["all-products-men"],
    women: ["all-products-women"],
  })
  assert.equal(tatras?.sourceCurrency, "EUR")
  assert.deepEqual(tatras?.shopifyExcludedTags, ["KIDS"])
  const cantonCollective = getSiteConfig("canton-collective")
  assert.equal(cantonCollective?.multiBrand, true)
  assert.deepEqual(cantonCollective?.defaultGender, ["women"])
  assert.deepEqual(cantonCollective?.shopifyExcludedHandles, ["canton-collective-express"])
  const cantonNoise = cantonCollective?.kidsGenderNoisePatterns ?? []
  assert.equal(cantonNoise.reduce((text, pattern) => text.replace(pattern, " "), "Y2K Baby Tee Babydoll").trim(), "Y2K")
  assert.equal(cantonCollective?.sourceCurrency, "USD")
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
  // TOJI's legacy platform key was consolidated into the generated sansangear entry.
  assert.deepEqual(SITE_GENDER_DEFAULTS["sansangear-5471"], ["unisex"])
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
  const sculptor = getSiteConfig("sculptorpage")
  assert.deepEqual(sculptor?.defaultGender, ["women"])
  assert.equal(sculptor?.trustedCategory, true)
  assert.deepEqual(sculptor?.category?.categories, [{name: "All", cateNo: 1532, gender: ["women"]}])
  const sundayCeremony = getSiteConfig("ensundayceremony")
  assert.equal(sundayCeremony?.genderTextPatterns?.men?.[0]?.test("BASIC TEE (M)"), true)
  assert.equal(sundayCeremony?.genderTextPatterns?.women?.[0]?.test("BASIC TEE (W)"), true)
  assert.equal(sundayCeremony?.genderTextPatterns?.men?.[0]?.test("BASIC TEE"), false)
  const fritt = getSiteConfig("fritt")
  assert.deepEqual(fritt?.category?.categories, [{name: "그녀를 위한 기프트", cateNo: 156, gender: ["women"]}])
  const jinochio = getSiteConfig("jinochio")
  assert.equal(jinochio?.genderTextPatterns?.women?.[0]?.test("(w)All day top"), true)
  assert.equal(jinochio?.genderTextPatterns?.unisex?.[0]?.test("(uni)Breeze pajamas"), true)
  assert.equal(jinochio?.defaultGender, undefined)
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

test("THE INNRS 과거 공식 WOMEN/MEN 카테고리 성별을 보존한다", () => {
  const config = getSiteConfig("theinnrs")
  assert.ok(config?.category && "categories" in config.category)
  const genders = new Map(config.category.categories?.map(({cateNo, gender}) => [cateNo, gender]))
  assert.deepEqual(genders.get(29), ["women"])
  assert.deepEqual(genders.get(139), ["women"])
  assert.deepEqual(genders.get(33), ["men"])
  assert.deepEqual(genders.get(49), ["men"])
  assert.deepEqual(genders.get(167), ["unisex"])
  assert.equal(genders.get(170), undefined)
})

test("공식 남녀 모델 근거 브랜드와 남성 브랜드의 기본값을 보존한다", () => {
  for (const site of ["cayl", "plasticproduct", "blackpurple", "goyowear"]) {
    const config = getSiteConfig(site)
    assert.deepEqual(config?.defaultGender, ["unisex"])
    assert.equal(config?.verifiedUnisexDefault, true)
  }
  assert.equal(getSiteConfig("goyowear")?.genderTextPatterns?.women?.[0]?.test("W LIGHT ASKIN SINGLET"), true)
  assert.equal(getSiteConfig("cayl")?.genderTextPatterns?.men?.[0]?.test("러닝화 (남성)"), true)
  assert.deepEqual(getSiteConfig("birthofroyalchild")?.defaultGender, ["men"])
})

test("Kith 공식 mens/wmns 부서 태그를 상품 성별 근거로 사용한다", () => {
  const prefixes = getSiteConfig("kith")?.genderDepartmentTagPrefixes
  assert.deepEqual(prefixes, {men: ["mens"], women: ["wmns"]})
  assert.deepEqual(getSiteConfig("kith")?.shopifyGenderCollections, {
    men: ["menswear-new-arrivals"],
    women: ["womens-new-arrivals"],
  })
  assert.deepEqual(getSiteConfig("bodega")?.shopifyGenderCollections, {
    men: ["mens"],
    women: ["womens-apparel", "womens-footwear"],
  })
})

test("FORMLICH와 SPORT CHAMBER의 공식 전체 상품 성별을 보존한다", () => {
  assert.deepEqual(getSiteConfig("formlich")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("sport-chamber")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("sport-chamber")?.verifiedUnisexDefault, true)
})

test("HOMLY는 공식 남성 카탈로그를 쓰고 DURT 혼성몰은 전역 기본값을 쓰지 않는다", () => {
  assert.deepEqual(getSiteConfig("homly")?.defaultGender, ["men"])
  assert.equal(getSiteConfig("durt")?.defaultGender, undefined)
})
