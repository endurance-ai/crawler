import {test} from "node:test"
import * as assert from "node:assert/strict"

import type {Product} from "../src/lib/types"
import {
  inferCategoryFromText,
  applyProductQcGate,
  normalizeProductTextFields,
  getProductQcReport,
  resetProductQcReport,
} from "../src/lib/product-qc/normalization"

function product(overrides: Partial<Product> = {}): Product {
  return {
    brand: "Brand",
    name: "Black Wide Pants",
    category: "bottoms",
    // 2026-08 성별 크롤러 회귀: gender 는 필수다. 비어 있으면 QC 가
    // gender_missing 으로 needsReview 를 세워 상품을 드랍한다.
    gender: ["women"],
    price: 1000,
    originalPrice: 1000,
    salePrice: null,
    priceFormatted: "KRW 1,000",
    imageUrl: "https://example.com/image.jpg",
    productUrl: "https://example.com/product/1",
    inStock: true,
    platform: "test-shop",
    crawledAt: "2026-07-07T00:00:00.000Z",
    subcategory: "wide-pants",
    ...overrides,
  }
}

test("QC reviews category conflicts instead of overwriting them", () => {
  const result = normalizeProductTextFields(product({name: "Silk Mini Dress", category: "accessories"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("category_text_conflict"))
})

test("QC auto-fixes a category conflict only after a site-specific text audit", () => {
  const result = normalizeProductTextFields(
    product({name: "Lossy Turtle Neck Pola Knit", category: "tops"}),
    {verifiedCategoryTextOverride: true},
  )

  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.category, "knitwear")
  assert.ok(result.reasons.includes("category_verified_text_override"))
})

test("QC does not read 'Short Sleeve' as shorts (bottoms alias excludes it)", () => {
  // 실측 사고 2026-08-01: "Archive Short Sleeves"(반팔티)를 LLM 이 tops 로 냈는데
  // bottoms 별칭의 `shorts?` 가 홑단어 Short 를 잡아 번복 → 후보가 탈락했다.
  const result = normalizeProductTextFields(product({name: "Archive Short Sleeves", category: "tops"}))
  assert.equal(result.product.category, "tops")
  assert.ok(!result.reasons.includes("category_text_conflict"))
})

test("QC still reads a standalone 'Short' as bottoms", () => {
  // `shorts?` 의 `s?` 는 유지돼야 한다 — 홑단어 Short 를 명사로 쓰는 상품명이
  // 실측상 더 많다 (1,170 vs 304). 예외는 'short sleeve' 한 갈래뿐이다.
  const result = normalizeProductTextFields(product({name: "Logo Biker Short", category: "accessories"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("category_text_conflict"))
})

test("QC still reads 'Short Sleeve Shorts' as bottoms (matches the trailing Shorts)", () => {
  const result = normalizeProductTextFields(product({name: "Short Sleeve Shorts", category: "accessories"}))
  assert.equal(result.product.category, "bottoms")
})

test("trustedCategory skips name-based category override but keeps canonical enforcement", () => {
  // ② 번복은 꺼진다 — LLM 이 본 tops 를 정규식이 뒤집지 않는다.
  const kept = normalizeProductTextFields(
    product({name: "Silk Mini Dress", category: "tops"}),
    {trustedCategory: true},
  )
  assert.equal(kept.product.category, "tops")
  assert.ok(!kept.reasons.includes("category_text_conflict"))

  // ① 계약 강제는 그대로 — 비-canonical 은 여전히 접힌다.
  const folded = normalizeProductTextFields(
    product({name: "Archive Piece 001", category: "sweater"}),
    {trustedCategory: true},
  )
  assert.equal(folded.product.category, "knitwear")
})

test("trustedCategory is off by default (raw DOM path keeps the rescue)", () => {
  const result = normalizeProductTextFields(product({name: "Silk Mini Dress", category: "tops"}))
  assert.equal(result.action, "review")
  assert.ok(result.reasons.includes("category_text_conflict"))
})

test("trustedCategory keeps the subcategory cascade correct", () => {
  // category 가 번복되면 subcategory 가 그 잘못된 family 로 재해석된다 —
  // 실측 사고에서 t-shirt 가 shorts 로 바뀐 것이 그 연쇄였다.
  const result = normalizeProductTextFields(
    product({name: "Archive Short Sleeves", category: "tops", subcategory: "t-shirt"}),
    {trustedCategory: true},
  )
  assert.equal(result.product.category, "tops")
  assert.equal(result.product.subcategory, "t-shirt")
})

test("trustedCategory keeps a verified jewelry category despite apparel words in the name", () => {
  const result = normalizeProductTextFields(
    product({name: "Denim Big Star", category: "Necklace", subcategory: undefined}),
    {trustedCategory: true},
  )
  assert.equal(result.product.category, "jewelry")
  assert.ok(!result.reasons.includes("category_text_conflict"))
})

test("QC folds non-canonical mappable category to canonical family (sweater -> knitwear)", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", category: "sweater"}))
  assert.equal(result.product.category, "knitwear")
  assert.ok(result.reasons.includes("category_canonicalized"))
})

test("QC passes a canonical family through unchanged (knitwear stays knitwear)", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", category: "knitwear"}))
  assert.equal(result.product.category, "knitwear")
  assert.ok(!result.reasons.includes("category_canonicalized"))
})

test("QC stores unresolved category as other so Qwen can normalize it after insert", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", category: "~50%"}))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.category, "other")
  assert.ok(result.reasons.includes("category_unresolved_other_fallback"))
})

test("QC recovers canonical from name when category is noise (모두 보기 -> dresses)", () => {
  const result = normalizeProductTextFields(product({name: "Silk Mini Dress", category: "모두 보기"}))
  assert.equal(result.product.category, "dresses")
  assert.ok(result.reasons.includes("category_noise_text_fallback"))
})

test("QC resolves common Korean top names and skort deterministically", () => {
  for (const name of ["피그먼트 반팔", "컨피던스 브이넥 롱 슬리브", "스터드 포인트 골지 홀터넥", "백 트위스트 슬리브리스"]) {
    const result = normalizeProductTextFields(product({name, category: "other"}))
    assert.equal(result.product.category, "tops", name)
  }
  const skort = normalizeProductTextFields(product({name: "SEQUIN MINI SKORT / CREAM", category: "other"}))
  assert.equal(skort.product.category, "bottoms")
})

test("QC canonicalizes jewelry category labels even when the product name is abbreviated", () => {
  for (const category of ["Necklace", "Bracelet", "Earrings", "Ring"]) {
    const result = normalizeProductTextFields(product({name: "thorn B", category}))
    assert.equal(result.product.category, "jewelry", category)
  }
})

test("QC keeps briefs in an explicit official swim category as swimwear", () => {
  const result = normalizeProductTextFields(product({name: "FIG PURPLE BRIEF", category: "Let's Swim"}))
  assert.equal(result.product.category, "swimwear")
  assert.ok(!result.reasons.includes("category_text_conflict"))
})

test("QC treats swimming caps as swimwear before the generic headwear rule", () => {
  for (const name of ["SPELLING SWIMMING CAP", "MIML SWIM CAP"]) {
    const result = normalizeProductTextFields(product({name, category: "Let's Swim"}))
    assert.equal(result.product.category, "swimwear")
    assert.ok(!result.reasons.includes("category_text_conflict"))
  }
})

test("QC classifies underscore-suffixed apparel and accessories after text normalization", () => {
  const cases: Array<[string, string]> = [
    ["LACE TANK-BK", "tops"],
    ["AMALFI SPORTY MOTO JERSEY_IVORY", "tops"],
    ["THIRSTY CAMEL T-SHIRTS_DARK GREY", "tops"],
    ["COTTON 160`S LOOSE SHIRTS_IVORY", "tops"],
    ["SHELL KNIT COWBOY BUCKET HAT_NAVY", "headwear"],
    ["Tangled Swim Knit Bag_Red", "bags"],
    ["Tanning Knit Cap_Navy", "headwear"],
    ["PUNTA PERDIZ SCRUNCHIE", "accessories"],
  ]
  for (const [name, expected] of cases) {
    assert.equal(inferCategoryFromText(name), expected, name)
  }
})

test("QC classifies plural shirts and underscore-suffixed tees through category and subcategory", () => {
  const shirt = normalizeProductTextFields(product({name: "COTTON PAPER LOOSE SHIRTS_IVORY", category: "other"}))
  assert.equal(shirt.product.category, "tops")
  assert.equal(shirt.product.subcategory, "shirt")

  const tee = normalizeProductTextFields(product({name: "SORONA COTTON S/S TEE_BLACK", category: "other"}))
  assert.equal(tee.product.category, "tops")
  assert.equal(tee.product.subcategory, "t-shirt")
})

test("QC keeps fashion trunks out of swimwear and recovers REFOMED product nouns", () => {
  assert.equal(normalizeProductTextFields(product({name: 'REPT-064 | "KINCHAKU" WOOL TRUNKS', category: "other"})).product.category, "bottoms")
  assert.equal(normalizeProductTextFields(product({name: "Classic Swim Trunks", category: "other"})).product.category, "swimwear")
  assert.equal(normalizeProductTextFields(product({name: "RECU-YN01 | WOOL BASE", category: "other"})).product.category, "tops")
  assert.equal(normalizeProductTextFields(product({name: 'REPF-003 | FRAGRANCE "NEXT MAN"', category: "other"})).product.category, "accessories")
})

test("QC resolves explicit compound product names before broad category aliases", () => {
  const cases: Array<[string, string]> = [
    ["W Biker Jersey Jacket", "outerwear"],
    ["Oversized Shirt Jacket", "outerwear"],
    ["EASTPAK x Opening Project DAY PAK'R", "bags"],
    ["Double Knee Bermuda Sweatpant", "bottoms"],
    ["Logo Football Jersey", "tops"],
    ["Shirring Slim Long Sleeve", "tops"],
    ["Ribbon Tie Down Cap", "headwear"],
    ["BANTS Anchor Logo 8oz Denim Vintage Baseball Cap - Indigo", "headwear"],
    ["BANTS HDR Cotton Double Roll Watch Cap - Navy", "headwear"],
    ["BANTS HDR Silk Stripe Knit Tie - Navy x Blue", "accessories"],
    ["W 2Way Hoodie Scarf", "accessories"],
    ["BALLET SLOUCHY SHORT BOOTS", "shoes"],
    ["METALLIC PILLOW HANDLE MINI", "bags"],
    ["LEATHER MOTO HOBO MINI", "bags"],
    ["CUT OUT LEG WARMERS", "accessories"],
    ["YY CRINKLED BRALETTE", "underwear"],
    ["ALPACA TURTLE SHRUG", "knitwear"],
    ["SHIRRING WORK VEST", "outerwear"],
    ["CORDUROY LOOSE BOOTCUT", "bottoms"],
    ["DAWN GRAPHIC U-NECK TOP", "tops"],
    ["COTTON OXFORD LOOSE SHIRTS_IVORY", "tops"],
    ["PLEATED ZIP KNIT VEST", "knitwear"],
    ["CONVERTIBLE HOOK TOP DRESS", "dresses"],
    ["Pignose pearl belt necklace", "jewelry"],
    ["White dew earcuff", "jewelry"],
    ["Blue heart keyring", "accessories"],
    ["Clear color hair clip (4color)", "accessories"],
    ["White cat hair brush", "accessories"],
    ["Minimal hand mirror (3color)", "accessories"],
    ["Logo iphone jelly case", "accessories"],
    ["Shearing bear gripp tok (3color)", "accessories"],
    ["FLUFFY BEAR KEY RIING", "accessories"],
    ["[925silver] Letter pendent", "jewelry"],
    ["[925silver] Color cubic piercing (3color)", "jewelry"],
  ]

  for (const [name, expected] of cases) {
    assert.equal(inferCategoryFromText(name), expected, name)
  }
})

test("QC promotes fallback other when product-name evidence becomes available", () => {
  const result = normalizeProductTextFields(product({name: "Oversized Shirt Jacket", category: "other"}))
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.category, "outerwear")
  assert.ok(result.reasons.includes("category_other_text_fallback"))
})

test("QC auto-fixes only explicit priority phrases when a previous category conflicts", () => {
  const vest = normalizeProductTextFields(product({name: "CARGO POCKET FIELD VEST", category: "bottoms"}))
  assert.equal(vest.action, "auto_fix")
  assert.equal(vest.product.category, "outerwear")
  assert.ok(vest.reasons.includes("category_priority_text_override"))

  const knitVest = normalizeProductTextFields(product({name: "PLEATED ZIP KNIT VEST", category: "knitwear"}))
  assert.equal(knitVest.product.category, "knitwear")
  assert.ok(!knitVest.reasons.includes("category_priority_text_override"))
})

// ─── subcategory ───────────────────────────────────────────────────────────

test("QC collapses mini/midi/plural skirt variants to canonical 'skirt'", () => {
  for (const raw of ["midi skirt", "midi skirts", "mini check skirt", "mini skirt", "mini skirts", "miniskirts"]) {
    const result = normalizeProductTextFields(product({subcategory: raw}))
    assert.equal(result.product.subcategory, "skirt", `input: ${raw}`)
    assert.ok(result.reasons.includes("subcategory_canonicalized"), `input: ${raw}`)
  }
})

test("QC leaves an already-canonical subcategory untouched", () => {
  const result = normalizeProductTextFields(product({subcategory: "skirt"}))
  assert.equal(result.product.subcategory, "skirt")
  assert.ok(!result.reasons.includes("subcategory_canonicalized"))
})

test("QC drops a subcategory with no keyword match instead of leaking raw noise", () => {
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", subcategory: "New Arrival"}))
  assert.equal(result.product.subcategory, null)
  assert.ok(result.reasons.includes("subcategory_noncanonical_dropped"))
  assert.equal(result.action, "auto_fix")
})

test("QC infers subcategory from the product name when the field is missing", () => {
  const result = normalizeProductTextFields(product({name: "Pleated Midi Skirt", subcategory: undefined}))
  assert.equal(result.product.subcategory, "skirt")
  assert.ok(result.reasons.includes("subcategory_missing_text_fallback"))
})

test("QC does not classify a hair tie as neckwear", () => {
  const result = normalizeProductTextFields(
    product({name: "Heart pattern hair tie (8color)", category: "NEW", subcategory: undefined}),
  )
  assert.equal(result.product.category, "accessories")
  assert.equal(result.product.subcategory ?? null, null)
})

test("QC nulls subcategory when category falls back to other", () => {
  const result = normalizeProductTextFields(
    product({name: "Archive Piece 001", category: "~50%", subcategory: "skirt"}),
  )
  assert.equal(result.action, "auto_fix")
  assert.equal(result.product.category, "other")
  assert.equal(result.product.subcategory, null)
  assert.ok(result.reasons.includes("subcategory_no_category"))
})

test("QC resolves subcategory against the canonicalized category, not the raw alias", () => {
  const result = normalizeProductTextFields(product({category: "sweater", name: "Wool Turtleneck", subcategory: null}))
  assert.equal(result.product.category, "knitwear")
  assert.equal(result.product.subcategory, "turtleneck")
})

test("QC preserves a narrow official category as subcategory evidence for code-only names", () => {
  for (const [category, expected] of [
    ["Ring", "ring"],
    ["Necklace", "necklace"],
    ["Bracelet", "bracelet"],
    ["Earring", "earrings"],
  ] as const) {
    const result = normalizeProductTextFields(
      product({name: "BR0077S", category, subcategory: undefined}),
    )
    assert.equal(result.product.category, "jewelry")
    assert.equal(result.product.subcategory, expected)
  }
})


// ─── 성별 (2026-08 크롤러 회귀) ────────────────────────────────

test("QC canonicalizes gender tokens", () => {
  const result = normalizeProductTextFields(product({gender: ["WOMEN"]}))
  assert.deepEqual(result.product.gender, ["women"])
  assert.ok(result.reasons.includes("gender_canonicalized"))
})

test("QC infers gender from the product name when the field is empty", () => {
  const result = normalizeProductTextFields(product({name: "여성 와이드 팬츠", gender: []}))
  assert.deepEqual(result.product.gender, ["women"])
  assert.ok(result.reasons.includes("gender_missing_text_fallback"))
})

test("QC reviews (drops) a product with no gender and no text signal", () => {
  // 미확인을 unisex 로 채우면 검색 RPC 가 남녀 양쪽에 노출시킨다 — 드랍이 맞다.
  const result = normalizeProductTextFields(product({name: "Archive Piece 001", gender: []}))
  // 해결 못 하면 입력값을 그대로 두고 needsReview 만 세운다 — 게이트가 드랍한다.
  assert.deepEqual(result.product.gender, [])
  assert.ok(result.reasons.includes("gender_missing"))
  assert.equal(result.action, "review")
})

test("QC kids 가드는 사이트별 캠페인명 노이즈를 제거한 뒤 defaultGender를 쓴다", () => {
  const result = normalizeProductTextFields(
    product({
      name: "Summer Kids Tee",
      category: "tops",
      subcategory: "t-shirt",
      gender: ["men"],
      genderSource: "config_default",
      tags: ["summer-kids-2026"],
    }),
    {kidsGenderNoisePatterns: [/\bsummer[-\s]kids(?:[-\s]2026)?\b/gi]},
  )
  assert.equal(result.action, "keep")
  assert.deepEqual(result.product.gender, ["men"])
})

test("QC kids 가드는 검증된 처칠롬퍼 성인 FREE 사이즈 캡 상품명을 제거한 뒤 defaultGender를 쓴다", () => {
  const result = normalizeProductTextFields(
    product({
      name: "NEW KIDS - VINTAGE 5 PANEL CAP BLACK",
      category: "headwear",
      subcategory: "cap",
      gender: ["men"],
      genderSource: "config_default",
    }),
    {kidsGenderNoisePatterns: [/\bkids[-\s]+vintage[-\s]+5[-\s]+panel[-\s]+cap\b/gi]},
  )
  assert.equal(result.action, "keep")
  assert.deepEqual(result.product.gender, ["men"])
})

test("QC tie-dye는 액세서리 tie로 오인하지 않는다", () => {
  const result = normalizeProductTextFields(product({name: "Tie-dye Zipper", category: "tops"}))
  assert.equal(result.product.category, "tops")
  assert.ok(!result.reasons.includes("category_text_conflict"))
})

test("QC gate excludes gender-less products from the batch", () => {
  resetProductQcReport()
  const kept = applyProductQcGate(
    [product({gender: ["women"]}), product({name: "Archive Piece 002", gender: [], productUrl: "https://example.com/product/2"})],
    "test-shop",
  )
  assert.equal(kept.length, 1)
  assert.deepEqual(kept[0].gender, ["women"])
})

test("QC checkpoint mode normalizes without duplicating the final report", () => {
  resetProductQcReport()
  const input = [product({name: "Clear color hair clip", category: "NEW", subcategory: undefined})]
  const checkpoint = applyProductQcGate(input, "checkpoint-shop", {recordReport: false})
  assert.equal(checkpoint[0].category, "accessories")
  assert.equal(getProductQcReport().has("checkpoint-shop"), false)

  applyProductQcGate(input, "checkpoint-shop")
  assert.equal(getProductQcReport().get("checkpoint-shop")?.total, 1)
})

test("QC does not launder an unresolvable gender into unisex", () => {
  const result = normalizeProductTextFields(product({name: "Object No. 7", gender: []}))
  assert.notDeepEqual(result.product.gender, ["unisex"])
})

test("QC 는 write-path 와 같은 결의를 쓴다 — tags/URL 까지 본다", () => {
  // 회귀: 예전 QC 는 name+category 만 봐서, write-path 가 URL↔태그 충돌로
  // 미확인 처리한 상품을 name 만으로 되살려 충돌 가드를 무력화했다.
  const result = normalizeProductTextFields(
    product({
      name: "Archive Piece 001",
      gender: [],
      tags: ["여성"],
      productUrl: "https://example.com/product/1",
    }),
  )
  assert.deepEqual(result.product.gender, ["women"])
})

test("QC 는 URL 과 텍스트가 충돌하면 되살리지 않는다", () => {
  const result = normalizeProductTextFields(
    product({
      name: "여성 코트",
      gender: [],
      productUrl: "https://example.com/men/coat-1",
    }),
  )
  assert.ok(result.reasons.includes("gender_missing"))
  assert.equal(result.action, "review")
})

test("QC 가 gender 를 채우면 genderSource 도 함께 갱신한다", () => {
  // 회귀: 예전에는 gender 만 바꾸고 source 를 stale 하게 뒀다. import 결의가
  // 그 라벨(config_default)을 보고 isConfigDefault 분기를 타 오판했다.
  const result = normalizeProductTextFields(
    product({name: "Archive Piece 001", gender: [], genderSource: "config_default", productUrl: "https://example.com/women/1"}),
  )
  assert.deepEqual(result.product.gender, ["women"])
  assert.equal(result.product.genderSource, "url")
})

test("QC는 공식 검증된 config_default unisex를 보존한다", () => {
  const result = normalizeProductTextFields(
    product({
      name: "Archive Piece 001",
      category: "tops",
      gender: ["unisex"],
      genderSource: "config_default",
    }),
    {verifiedUnisexDefault: true},
  )
  assert.notEqual(result.action, "review")
  assert.deepEqual(result.product.gender, ["unisex"])
})

test("BMUET Korean product names resolve before the import conflict gate", () => {
  assert.equal(inferCategoryFromText("아플리케 로고 자수 티셔츠 화이트"), "tops")
  assert.equal(inferCategoryFromText("깅엄 체크 라인 디테일 볼륨 스커트 블랙"), "bottoms")
  assert.equal(inferCategoryFromText("도트 리본 디테일 미니 원피스"), "dresses")
})
