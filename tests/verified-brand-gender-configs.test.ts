import test from "node:test"
import assert from "node:assert/strict"

import {
  inferVerifiedSiteGenderFromName,
  SITE_GENDER_DEFAULTS,
} from "../src/configs/gender-defaults"
import {getSiteConfig} from "../src/configs/platforms"

test("2026-08 Korean/KRW batch keeps the verified live feeds and gender evidence", () => {
  const expectedDefaults: Record<string, string[] | undefined> = {
    auber: ["women"],
    hormoneapparel: undefined,
    casacenido: ["men"],
    surfaceedition: ["men"],
    "global-5264": ["unisex"],
    nieeh: ["women"],
    venecy: ["women"],
    ko: ["women"],
    verbless: ["men"],
    rrace: ["women"],
    hoopoe: ["women"],
    "intl-5270": ["men"],
    bnfrom: ["women"],
    misekiseoul: undefined,
  }
  for (const [key, expected] of Object.entries(expectedDefaults)) {
    assert.deepEqual(getSiteConfig(key)?.defaultGender, expected, key)
  }

  assert.equal(getSiteConfig("global-5264")?.type, "cafe24")
  assert.equal(getSiteConfig("global-5264")?.verifiedUnisexDefault, true)
  assert.equal(getSiteConfig("ko")?.baseUrl, "https://shop.s-e-o.co.kr")
  assert.equal(getSiteConfig("intl-5270")?.baseUrl, "https://curatedparade.com")
  assert.equal(getSiteConfig("rrace")?.baseUrl, "https://www.rrace.co.kr")
  assert.equal(getSiteConfig("nieeh")?.selectors?.productName, ".pName")
  assert.equal(getSiteConfig("verbless")?.selectors?.productName, ".overflow_txt")
  assert.equal(getSiteConfig("hoopoe")?.selectors?.productItem, ".product-item-wrap > .product-item")
  assert.equal(
    getSiteConfig("auber")?.kidsGenderNoisePatterns?.some((pattern) => "Baby Pink".replace(pattern, "").trim() === ""),
    true,
  )
  assert.equal(
    getSiteConfig("ko")?.kidsGenderNoisePatterns?.some((pattern) => "BABY HENLEY TOP".replace(pattern, "").trim() === ""),
    true,
  )
  assert.deepEqual(
    getSiteConfig("misekiseoul")?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})),
    [
      {cateNo: 98, gender: ["women"]},
      {cateNo: 80, gender: ["men"]},
    ],
  )
})

test("inactive Korean/KRW batch keeps official gender departments and defaults", () => {
  assert.deepEqual(getSiteConfig("omirad")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("james-coward")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("rodo")?.defaultGender, ["women"])
  assert.equal(getSiteConfig("rodo")?.shopifyCategoryTextPatterns?.bags?.some((pattern) => pattern.test("Borse a mano")), true)
  assert.equal(getSiteConfig("rodo")?.shopifyCategoryTextPatterns?.shoes?.some((pattern) => pattern.test("Sandali")), true)
  assert.equal(getSiteConfig("maisoncreme")?.selectors?.productName, ".mc-p-name")
  assert.equal(getSiteConfig("maisoncreme")?.selectors?.productPrice, ".mc-p-price")
  const omiradNoise = getSiteConfig("omirad")?.kidsGenderNoisePatterns ?? []
  for (const value of ["omirad-divine-baby-graphic-tee", "retro-spice-girl-pearl-hoodie"]) {
    assert.doesNotMatch(omiradNoise.reduce((text, pattern) => text.replace(pattern, " "), value), /\b(?:baby|girl)\b/)
  }
  assert.deepEqual(getSiteConfig("areyou")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("east-sea")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("erikacavallini")?.defaultGender, ["women"])

  assert.deepEqual(
    getSiteConfig("kyod")?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})),
    [
      {cateNo: 44, gender: ["women"]},
      {cateNo: 30, gender: ["men"]},
    ],
  )
  assert.deepEqual(getSiteConfig("flabelus")?.shopifyGenderCollections, {
    women: ["woman"],
    men: ["for-him", "flabelus-man"],
  })
  assert.equal(getSiteConfig("flabelus")?.shopifyCategoryTextPatterns?.shoes?.length, 1)
  assert.deepEqual(getSiteConfig("kjacques")?.shopifyGenderCollections, {
    women: ["sandale-tropezienne-femme"],
    men: ["homme"],
  })
  assert.equal(getSiteConfig("kjacques")?.shopifyCategoryTextPatterns, undefined)
  assert.equal(getSiteConfig("kjacques")?.defaultCategory, "shoes")
  assert.equal(
    getSiteConfig("erikacavallini")?.shopifyCategoryTextPatterns?.bottoms?.some((pattern) => pattern.test("Pantalone Alfio")),
    true,
  )
})

test("신규 공식몰의 검증된 성별 기본값과 상품명 예외를 보존한다", () => {
  assert.deepEqual(getSiteConfig("girlsgirls")?.defaultGender, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.amiment, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.soonsuofficial, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS["afb-afb-afb"], ["men"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.twentyoneaugust, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.baserange, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.khaite, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.franmeriko, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.dared, ["unisex"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.lossyrow, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.samostuff, ["men"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.thewarld, ["unisex"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.ulikasanctus, ["women"])
  assert.deepEqual(SITE_GENDER_DEFAULTS.kuko, ["unisex"])
  assert.deepEqual(getSiteConfig("baserange")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("khaite")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("franmeriko")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("franmeriko")?.category?.categories, [
    {name: "SHOP", cateNo: 88, url: "/category/shop/88/"},
  ])
  assert.equal(
    getSiteConfig("franmeriko")?.kidsGenderNoisePatterns
      ?.some((pattern) => "Baby Blue".replace(pattern, "").trim() === ""),
    true,
  )
  assert.deepEqual(getSiteConfig("dared")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("dared")?.verifiedUnisexDefault, true)
  assert.deepEqual(getSiteConfig("lossyrow")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("samostuff")?.defaultGender, ["men"])
  assert.deepEqual(getSiteConfig("thewarld")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("thewarld")?.verifiedUnisexDefault, true)
  assert.deepEqual(getSiteConfig("ulikasanctus")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("kuko")?.defaultGender, ["unisex"])
  assert.equal(getSiteConfig("kuko")?.verifiedUnisexDefault, true)
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

test("Aieul은 공식 MEN/WOMEN 하위 메뉴에서 카테고리와 성별을 함께 보존한다", () => {
  const aieul = getSiteConfig("aieul")
  assert.equal(aieul?.trustedCategory, true)
  assert.equal(aieul?.defaultGender, undefined)
  assert.deepEqual(aieul?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 90, gender: ["men"]},
    {cateNo: 91, gender: ["men"]},
    {cateNo: 92, gender: ["men"]},
    {cateNo: 93, gender: ["men"]},
    {cateNo: 95, gender: ["women"]},
    {cateNo: 96, gender: ["women"]},
    {cateNo: 97, gender: ["women"]},
    {cateNo: 98, gender: ["women"]},
  ])
})

test("ANIV는 공식 상품 부서만 수집하고 성별은 상품의 명시적 표기만 사용한다", () => {
  const aniv = getSiteConfig("aniv")
  assert.equal(aniv?.trustedCategory, true)
  assert.equal(aniv?.defaultGender, undefined)
  assert.deepEqual(aniv?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 28, gender: undefined},
    {cateNo: 25, gender: undefined},
    {cateNo: 27, gender: undefined},
    {cateNo: 23, gender: undefined},
  ])
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

  for (const key of ["bohemseo", "naats", "osoi", "maisoncreme", "slyisis", "leface"]) {
    assert.deepEqual(getSiteConfig(key)?.defaultGender, ["women"], key)
  }
  for (const key of ["jichoi", "shop2", "ignota", "sleeqsteel", "lemok"]) {
    assert.deepEqual(getSiteConfig(key)?.defaultGender, ["unisex"], key)
    assert.equal(getSiteConfig(key)?.verifiedUnisexDefault, true, key)
  }
  assert.deepEqual(getSiteConfig("thomasmore")?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 111, gender: ["men"]},
    {cateNo: 98, gender: ["women"]},
    {cateNo: 101, gender: ["kids"]},
  ])
  assert.deepEqual(getSiteConfig("saint-james-3903")?.category?.categories?.map(({cateNo, gender}) => ({cateNo, gender})), [
    {cateNo: 176, gender: ["women"]},
    {cateNo: 170, gender: ["men"]},
    {cateNo: 200, gender: ["kids"]},
  ])
  assert.equal(getSiteConfig("sleeqsteel")?.defaultCategory, "eyewear")
  assert.equal(getSiteConfig("lemok")?.defaultCategory, "eyewear")
  for (const key of ["foruseoul", "hoyeon", "nonfiction", "tune", "theopenproduct", "global-5331"]) {
    assert.equal(getSiteConfig(key)?.disabled, true, key)
  }
  const amun = getSiteConfig("amunofficial")
  assert.equal(amun?.disabled, undefined)
  assert.equal(amun?.baseUrl, "https://amunofficial.kr")
  assert.deepEqual(amun?.defaultGender, ["women"])
  assert.equal(amun?.defaultCategory, "swimwear")
  assert.deepEqual(amun?.category?.categories, [{name: "SHOP AMUN", cateNo: 130, gender: ["women"]}])
  assert.equal(getSiteConfig("en-3885")?.baseUrl, "https://enzoblues.com")
  assert.equal(getSiteConfig("en-3885")?.selectors?.productItem, '.item[id^="anchorBoxId_"]')
  assert.deepEqual(getSiteConfig("en-3885")?.category?.categories?.map(({cateNo, gender, url}) => ({cateNo, gender, url})), [
    {cateNo: 97, gender: ["women"], url: "/category/outer/97/"},
    {cateNo: 98, gender: ["women"], url: "/category/top/98/"},
    {cateNo: 99, gender: ["women"], url: "/category/bottom/99/"},
    {cateNo: 118, gender: ["women"], url: "/category/dress/118/"},
    {cateNo: 101, gender: ["women"], url: "/category/acc/101/"},
    {cateNo: 100, gender: ["women"], url: "/category/bag/100/"},
  ])
  assert.equal(getSiteConfig("global-5403")?.type, "cafe24")
  assert.deepEqual(getSiteConfig("global-5403")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("global-5403")?.category?.categories?.map(({cateNo, url}) => ({cateNo, url})), [
    {cateNo: 53, url: "/category/Outer/53/"},
    {cateNo: 47, url: "/category/Top/47/"},
    {cateNo: 27, url: "/category/Bottom/27/"},
    {cateNo: 63, url: "/category/Dress/63/"},
    {cateNo: 60, url: "/category/Acc/60/"},
  ])
  const maisonMichel = getSiteConfig("michel-paris")
  assert.equal(maisonMichel?.sourceCurrency, "KRW")
  assert.equal(maisonMichel?.defaultCategory, "headwear")
  assert.equal(maisonMichel?.shopifyCategoryTextPatterns?.headwear?.length, 1)
  assert.deepEqual(maisonMichel?.shopifyGenderCollections, {
    unisex: ["fedoras", "berets", "canotiers"],
  })
  const saySaySay = getSiteConfig("global-5463")
  assert.equal(saySaySay?.type, "cafe24")
  assert.equal(saySaySay?.defaultGender, undefined)
  assert.equal(saySaySay?.genderTextPatterns?.women?.[0]?.test("(W) CLASSIC TOP"), true)
  assert.equal(saySaySay?.genderTextPatterns?.unisex?.[0]?.test("(UNISEX) FIELD PANTS"), true)
  assert.equal(saySaySay?.genderTextPatterns?.unisex?.[0]?.test("FIELD PANTS"), false)
  assert.deepEqual(saySaySay?.category?.categories, [
    {name: "Outer", cateNo: 44, url: "/category/outer/44/"},
    {name: "Top", cateNo: 52, url: "/category/top/52/"},
    {name: "Bottom", cateNo: 54, url: "/category/bottom/54/"},
    {name: "Acc", cateNo: 58, url: "/category/acc/58/"},
  ])
  const subcategory = getSiteConfig("en-5510")
  assert.equal(subcategory?.defaultGender, undefined)
  assert.equal(subcategory?.genderTextPatterns?.unisex?.[0]?.test("SUB_F751 Black & Cream 모두보기"), true)
  assert.equal(subcategory?.genderTextPatterns?.unisex?.[0]?.test("SUB_F113 Black 모두보기"), false)
  assert.deepEqual(subcategory?.category?.categories, [
    {name: "Shoes", cateNo: 24, url: "/category/모두보기/24/"},
  ])
  const simuero = getSiteConfig("simuero")
  assert.equal(simuero?.defaultGender, undefined)
  assert.deepEqual(simuero?.shopifyGenderCollections, {
    men: ["gift-guide-pieces-for-him"],
  })
  assert.deepEqual(getSiteConfig("asif-calie")?.defaultGender, ["women"])
  assert.deepEqual(getSiteConfig("asif-calie")?.category?.categories, [
    {name: "SHOP", cateNo: 50, gender: ["women"]},
  ])
  assert.deepEqual(getSiteConfig("le17septembre")?.category?.categories, [
    {name: "WOMEN VIEW ALL", cateNo: 100, gender: ["women"]},
    {name: "MEN VIEW ALL", cateNo: 103, gender: ["men"]},
  ])
  assert.deepEqual(getSiteConfig("lvir")?.category?.categories, [
    {name: "26 SPRING SUMMER", cateNo: 342, gender: ["women"]},
  ])
  assert.deepEqual(getSiteConfig("yujiofficial")?.category?.categories, [
    {name: "WOMEN", cateNo: 58, gender: ["women"]},
    {name: "MEN", cateNo: 59, gender: ["men"]},
  ])
  assert.deepEqual(getSiteConfig("safarispot")?.category?.categories, [
    {name: "SIGNATURE", cateNo: 287, gender: ["unisex"]},
  ])
  assert.deepEqual(getSiteConfig("colocynth")?.category?.categories, [
    {name: "ALL", cateNo: 87, gender: ["women"]},
  ])
  assert.deepEqual(getSiteConfig("en-208")?.category?.categories, [
    {name: "WOMEN", cateNo: 48, gender: ["women"]},
    {name: "MEN", cateNo: 49, gender: ["men"]},
  ])
  assert.deepEqual(getSiteConfig("en-1190")?.category?.categories, [
    {name: "ALL", cateNo: 784, gender: ["unisex"]},
  ])
  for (const key of ["safarispot", "en-1190"]) {
    assert.equal(getSiteConfig(key)?.verifiedUnisexDefault, true, key)
  }
})
