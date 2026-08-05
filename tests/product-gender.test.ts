import test from "node:test"
import assert from "node:assert/strict"

import {
  cleanGenderScope,
  hasGenderToken,
  inferDualDepartmentFromTags,
  inferGenderFromText,
  inferGenderFromUrl,
  isKidsText,
  resolveProductGenderWithSource,
} from "../src/lib/product-gender"

// ─── 회귀: unisex 세탁 ────────────────────────────────────────────────────
//
// 이 파일이 막는 버그: 성별을 못 뽑은 상품이 "모름" 대신 "unisex" 로 적재되면,
// 검색 RPC 가 `p.gender && ARRAY[p_gender,'unisex']` 로 그 상품을 남성·여성
// 양쪽 결과에 노출시킨다 (= 남성 검색에 여성복이 뜸).
//
// 2026-08 회귀에서 브랜드 스코프 폴백은 복원하지 않았다 — 근거는
// engine/url/text/config_default 4단뿐이다.

test("unisex 세탁: 신호가 전혀 없으면 미확인으로 떨어진다", () => {
  const r = resolveProductGenderWithSource([], {name: "Signature Wool Coat"})
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("unisex 는 명시적 신호가 있을 때만 부여된다", () => {
  const r = resolveProductGenderWithSource([], {name: "남녀공용 오버핏 후디"})
  assert.deepEqual(r.gender, ["unisex"])
  assert.equal(r.source, "text")
})

test("브랜드 스코프 폴백은 존재하지 않는다", () => {
  // 예전 시그니처는 (productGender, brandGenderScope, evidence, source) 였고
  // 2번째 인자로 브랜드 스코프가 들어와 최후 폴백으로 쓰였다. 지금 2번째 인자는
  // evidence 이므로, 브랜드 스코프처럼 생긴 값을 넘겨도 성별이 생기지 않는다.
  const r = resolveProductGenderWithSource([], {} as never)
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

// ─── 우선순위 ────────────────────────────────────────────────────────────

test("우선순위: engine > url > text > config_default > 미확인", () => {
  // 1. 엔진 값이 최우선 (URL/텍스트가 반대여도)
  assert.deepEqual(
    resolveProductGenderWithSource(["women"], {name: "MEN'S COAT", productUrl: "https://x.com/men/1"}),
    {gender: ["women"], source: "engine"},
  )
  // 2. 엔진 값이 없으면 URL
  assert.deepEqual(
    resolveProductGenderWithSource([], {name: "Wool Coat", productUrl: "https://x.com/kr/ko/men/coat-1"}),
    {gender: ["men"], source: "url"},
  )
  // 3. URL 도 없으면 텍스트
  assert.deepEqual(
    resolveProductGenderWithSource([], {name: "WOMEN'S WOOL BLEND COAT"}),
    {gender: ["women"], source: "text"},
  )
  // 4. 아무 근거도 없으면 미확인
  assert.deepEqual(resolveProductGenderWithSource([], {name: "Wool Coat"}), {gender: [], source: null})
})

test("URL 과 텍스트가 충돌하면 추측하지 않고 미확인 + conflict 보고", () => {
  const r = resolveProductGenderWithSource([], {
    name: "WOMEN'S COAT",
    productUrl: "https://x.com/kr/ko/men/coat-1",
  })
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
  assert.deepEqual(r.conflict, {url: "men", text: "women"})
})

test("엔진 값이 이미 있으면 재호출해도 source 는 engine 으로 유지된다 (멱등)", () => {
  const first = resolveProductGenderWithSource([], {name: "WOMEN'S COAT"})
  assert.equal(first.source, "text")
  const second = resolveProductGenderWithSource(first.gender, {name: "WOMEN'S COAT"}, "text")
  assert.deepEqual(second, {gender: ["women"], source: "text"})
})

// ─── 다중값 거부 ─────────────────────────────────────────────────────────
//
// products.gender 는 men/women/unisex 중 하나다 (migration 105,
// cardinality(gender) = 1). 검색 RPC 가 `p.gender && ARRAY[p_gender,'unisex']`
// 로 매칭하므로 ['men','women'] 은 unisex 와 똑같이 남녀 양쪽에 노출된다 —
// "남녀공용 확인됨"이 아니라 "판정 실패"인데도 구별되지 않는다.

test("엔진이 다중값을 넘기면 근거로 쓰지 않는다", () => {
  // 구 shopify 태그 union 잔재: ["men","women","unisex"]. 실측 16,468행.
  const r = resolveProductGenderWithSource(["men", "women", "unisex"], {name: "Ribbed Knit Cap"})
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("다중값을 버려도 URL·텍스트 근거는 살아남는다", () => {
  // 엔진이 모호했다는 사실이 URL 경로 근거까지 무효로 만들지는 않는다.
  assert.deepEqual(
    resolveProductGenderWithSource(["men", "women"], {name: "Wool Coat", productUrl: "https://x.com/women/coat-1"}),
    {gender: ["women"], source: "url"},
  )
  assert.deepEqual(
    resolveProductGenderWithSource(["men", "women"], {name: "WOMEN'S WOOL BLEND COAT"}),
    {gender: ["women"], source: "text"},
  )
})

test("사이트 기본값이 다중값이어도 부여되지 않는다", () => {
  const r = resolveProductGenderWithSource(["men", "women"], {name: "Signature Wool Coat"}, "config_default")
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("결의 결과는 항상 0개 또는 1개다", () => {
  const cases: Array<[unknown, string]> = [
    [["men", "women"], "Ribbed Knit Cap"],
    [["women", "unisex"], "남녀공용 후디"],
    [[], "WOMEN'S COAT"],
    [["unisex"], "Signature Wool Coat"],
  ]
  for (const [engine, name] of cases) {
    assert.ok(resolveProductGenderWithSource(engine, {name}).gender.length <= 1, name)
  }
})

// ─── config_default ──────────────────────────────────────────────────────

test("config_default 는 상품 단위 근거(URL/텍스트)보다 아래다", () => {
  // 사이트 기본값이 men 이어도 상품명이 여성이면 women 이 이긴다.
  // 이게 무너지면 카테고리 교차 사이트에서 dedup merge 가 ['men','women'] union 을 만든다.
  const r = resolveProductGenderWithSource(["men"], {name: "Silk Mini Dress for women"}, "config_default")
  assert.deepEqual(r.gender, ["women"])
  assert.equal(r.source, "text")
})

test("config_default 는 상품 단위 근거가 전혀 없을 때 쓰인다", () => {
  const r = resolveProductGenderWithSource(["men"], {name: "Signature Wool Coat"}, "config_default")
  assert.deepEqual(r.gender, ["men"])
  assert.equal(r.source, "config_default")
})

test("config_default unisex 는 미확정을 공용으로 세탁하지 않는다", () => {
  const r = resolveProductGenderWithSource(["unisex"], {name: "Signature Wool Coat"}, "config_default")
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("명시적인 unisex 상품 신호는 config_default 와 무관하게 유지한다", () => {
  const r = resolveProductGenderWithSource(["unisex"], {name: "Unisex Crewneck"}, "config_default")
  assert.deepEqual(r.gender, ["unisex"])
  assert.equal(r.source, "text")
})

test("config_default 라도 kids 는 성인 성별을 받지 않는다", () => {
  const r = resolveProductGenderWithSource(["men"], {name: "Kids Puffer Jacket"}, "config_default")
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

// ─── 텍스트 추론 ─────────────────────────────────────────────────────────

test("한글 성별 토큰", () => {
  // 한글은 \b 가 적용되지 않아 규칙에서 contains 로 처리된다 — "남성코트" 를 놓치면 안 된다.
  assert.equal(inferGenderFromText("남성코트"), "men")
  assert.equal(inferGenderFromText("여성 원피스"), "women")
  assert.equal(inferGenderFromText("남녀공용 후디"), "unisex")
})

test("women 은 men 으로 오인되지 않는다", () => {
  assert.equal(inferGenderFromText("WOMEN'S WOOL COAT"), "women")
})

test("남성·여성이 함께 잡히면 모호 → null", () => {
  assert.equal(inferGenderFromText("men and women coat"), null)
})

// ─── 어휘 확장 (2026-08-05) ──────────────────────────────────────────────

test("menswear/womenswear 는 성별 토큰이 아니다", () => {
  // 코퍼스 최다 후보였지만(600 / 1,006행) 실측에서 탈락했다. Shopify 의
  // `/products/<slug>` 는 상품명 그 자체라 URL 단에서도 구조적 신호가 아니고,
  // "menswear-inspired" 는 여성복 관용어다. 실측: Tibi "Thomas Menswear Check
  // Detached Shirt"(태그 woman/Women/Womens)가 men 으로 뒤집혔다.
  assert.equal(inferGenderFromText("Thomas Menswear Check Detached Shirt"), null)
  assert.equal(inferGenderFromUrl("https://x.com/products/tibi-thomas-menswear-shirt-tan"), null)
  assert.equal(hasGenderToken("menswear", "men"), false)
})

test("'womens' 안의 'men' 을 남성으로 읽지 않는다", () => {
  // wo[men]s — contains 로 넣었으면 여성 상품이 전부 다중값이 된다.
  // `"womens".includes("men")` 사고(실측 41.7%)와 같은 계열이라 회귀로 고정한다.
  assert.equal(inferGenderFromText("womens jacket"), "women")
  assert.equal(inferGenderFromText("WOMENS JACKET"), "women")
  assert.equal(hasGenderToken("womens jacket", "men"), false)
  assert.equal(hasGenderToken("womens jacket", "women"), true)
})

test("고유명사·스타일 묘사어는 성별로 읽지 않는다", () => {
  // 실측으로 거부한 토큰들. lady 9행은 전부 고유명사였고, 그중 하나는 아동복이다.
  assert.equal(inferGenderFromText("Lady Liberty Vintage Graphic Tee"), null)
  assert.equal(inferGenderFromText("Lady Lunetta Small Shoulder Bag"), null)
  assert.equal(inferGenderFromText("Relaxed Lady Luck Tee"), null)
  assert.equal(inferGenderFromText("Feminine Silhouette Blazer"), null)
  assert.equal(inferGenderFromText("Masculine Cut Trousers"), null)
})

// ─── 태그 부서 분류 → unisex ─────────────────────────────────────────────
//
// 편집샵이 같은 상품을 Men·Women 두 부서에 올린 것은 "판정 실패"가 아니라
// "확인된 남녀공용"이다. 2026-08-05 에 이 근거로 1,063행을 unisex 로 확정했고,
// 그 규칙을 write-path 에도 통일한다 (그러지 않으면 같은 성격의 신규 상품이
// 계속 import 에서 드랍된다 — browns 는 live 6,416행짜리 활성 소스다).

test("태그가 Men·Women 두 부서에 걸려 있으면 확인된 unisex", () => {
  // browns 실측 행.
  const r = resolveProductGenderWithSource([], {
    name: "Icon Low Glance snow boots",
    category: "shoes",
    subcategory: "boots",
    tags: ["Boots", "Men", "Rain Boots", "Shoes", "Women"],
  })
  assert.deepEqual(r.gender, ["unisex"])
  assert.equal(r.source, "text")
})

test("상품명의 성별 어휘는 부서 분류로 승격되지 않는다", () => {
  // 상품명이 남성, 태그가 여성이면 **모호**다 — unisex 가 아니다. 부서 분류
  // 규칙이 태그만 보는 이유가 이것이다. 상품명까지 합쳐서 "둘 다 나왔으니
  // 남녀공용" 으로 읽으면 마케팅 카피가 부서 분류로 둔갑한다.
  const r = resolveProductGenderWithSource([], {
    name: "Mens Style Check Detached Shirt",
    tags: ["Tops", "woman", "Women", "Womens"],
  })
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("mohawk-general Tibi 회귀: 여성 태그 + 남성풍 상품명은 women 을 유지한다", () => {
  // 실측 행. "Menswear" 는 성별 토큰이 아니므로(위 기각 항목) 남성 신호가 되지
  // 않고, 태그가 여성 전용이라 women 으로 확정된다. 이 행이 men 이나 unisex 로
  // 새면 여성복이 남성 검색에 뜬다.
  const r = resolveProductGenderWithSource([], {
    name: "Thomas Menswear Check Detached Shirt in Tan Multi",
    category: "tops",
    subcategory: "shirt",
    tags: ["AW24", "Girl", "Girls", "Tops", "woman", "Women", "Womens"],
    productUrl: "https://www.mohawkgeneralstore.com/products/tibi-thomas-menswear-shirt-tan-multi",
  })
  assert.deepEqual(r.gender, ["women"])
})

test("태그가 한쪽 성별만이면 부서 규칙이 개입하지 않는다", () => {
  const r = resolveProductGenderWithSource([], {name: "Wool Coat", tags: ["Clothing", "Women"]})
  assert.deepEqual(r.gender, ["women"])
  assert.equal(r.source, "text")
})

test("kids 가드가 태그 부서 분류보다 먼저다", () => {
  // `["Kids","Men","Women"]` 이 아동복에 성인 unisex 를 주면 안 된다 —
  // unisex 는 검색에서 남녀 양쪽에 노출되므로 정확히 이 모듈이 막으려는 세탁이다.
  const r = resolveProductGenderWithSource([], {
    name: "Puffer Jacket",
    tags: ["Kids", "Men", "Women"],
  })
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("URL 이 구체 성별이면 태그 부서 분류를 이긴다", () => {
  // unisex 는 "둘 다"라는 약한 주장이고 men/women 은 적극적 단언이다 — 기존 규율 그대로.
  const r = resolveProductGenderWithSource([], {
    name: "Wool Coat",
    tags: ["Men", "Women"],
    productUrl: "https://x.com/collections/women/coat-1",
  })
  assert.deepEqual(r.gender, ["women"])
  assert.equal(r.source, "url")
})

test("inferDualDepartmentFromTags 는 태그가 없거나 한쪽뿐이면 null", () => {
  assert.equal(inferDualDepartmentFromTags(null), null)
  assert.equal(inferDualDepartmentFromTags([]), null)
  assert.equal(inferDualDepartmentFromTags(["Women"]), null)
  assert.equal(inferDualDepartmentFromTags(["Men", "Women"]), "unisex")
  assert.equal(inferDualDepartmentFromTags(["accessories", "men", "mykita", "women"]), "unisex")
})

test("hasGenderToken 은 GENDER_RULES 를 단일 출처로 노출한다", () => {
  // 교정 스크립트가 자체 정규식을 새로 쓰지 않게 하려는 것이 이 함수의 목적이다.
  assert.equal(hasGenderToken("MEN'S COAT", "men"), true)
  assert.equal(hasGenderToken("MEN'S COAT", "women"), false)
  assert.equal(hasGenderToken("남녀공용 후디", "unisex"), true)
})

// ─── URL 추론 ────────────────────────────────────────────────────────────

test("inferGenderFromUrl: 경로에서만 읽는다", () => {
  assert.equal(inferGenderFromUrl("https://www.zara.com/kr/ko/woman/coat-p1.html"), "women")
  assert.equal(inferGenderFromUrl("https://x.com/collections/mens-outerwear"), "men")
})

test("inferGenderFromUrl: hostname 은 절대 보지 않는다", () => {
  // hommes.kr 같은 도메인이 전 상품을 남성으로 만들어 버리는 것을 막는다.
  assert.equal(inferGenderFromUrl("https://hommes.kr/product/1"), null)
})

test("inferGenderFromUrl: 모호하거나 신호가 없으면 null", () => {
  assert.equal(inferGenderFromUrl("https://x.com/men/women/1"), null)
  assert.equal(inferGenderFromUrl("https://x.com/product/1"), null)
  assert.equal(inferGenderFromUrl(""), null)
  assert.equal(inferGenderFromUrl(null), null)
})

test("inferGenderFromUrl: malformed percent-encoding 에도 throw 하지 않는다", () => {
  assert.doesNotThrow(() => inferGenderFromUrl("https://x.com/%E0%A4%A/men/1"))
})

// ─── kids 가드 ───────────────────────────────────────────────────────────

test("kids 가드: 성인 토큰 없는 아동복은 사이트 기본값을 타지 않는다", () => {
  // zara/uniqlo 엔진은 ["kids"] 를 반환한다. cleanGenderScope 가 그걸 [] 로 떨구는데,
  // 가드가 없으면 그 빈 값이 config_default 로 흘러 아동복이 성인 성별을 얻는다.
  const r = resolveProductGenderWithSource(["kids"], {name: "Kids Puffer Jacket"})
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("kids 가드: 성인 성별 신호가 명시되면 그 값을 쓴다", () => {
  const r = resolveProductGenderWithSource([], {name: "여성 키즈 라인 코트"})
  assert.deepEqual(r.gender, ["women"])
})

test("isKidsText", () => {
  assert.equal(isKidsText("Kids Puffer"), true)
  assert.equal(isKidsText("베이비 보디슈트"), true)
  assert.equal(isKidsText("Wool Coat"), false)
})

// ─── cleanGenderScope ────────────────────────────────────────────────────

test("cleanGenderScope 는 kids 등 미지원 값을 버린다", () => {
  assert.deepEqual(cleanGenderScope(["kids"]), [])
  assert.deepEqual(cleanGenderScope(["baby", "unknown"]), [])
  assert.deepEqual(cleanGenderScope(["WOMEN", "women"]), ["women"])
  assert.deepEqual(cleanGenderScope(" men " as unknown), [])
  assert.deepEqual(cleanGenderScope([" men "]), ["men"])
  assert.deepEqual(cleanGenderScope(null), [])
})

// ─── 구체 성별 vs unisex ─────────────────────────────────────────────────

test("구체 성별이 unisex 를 이긴다 (사이트 공용 Unisex 태그 오염 방지)", () => {
  // 실측(sportyandrich): 전 상품에 머천다이징 태그 "Unisex" 가 달려 있어,
  // unisex 를 우선하면 상품명·URL 이 모두 men 인 남성 상품이 unisex 로 접힌다.
  // unisex 는 검색 RPC 에서 남녀 양쪽에 노출되므로 그 방향의 오판이 세탁이다.
  assert.equal(inferGenderFromText("SRC Oversized Oxford Shirt Men Unisex"), "men")
  assert.equal(inferGenderFromText("Silk Slip Dress women unisex fit"), "women")
})

test("unisex 단독이면 여전히 unisex", () => {
  assert.equal(inferGenderFromText("남녀공용 오버핏 후디"), "unisex")
  assert.equal(inferGenderFromText("Unisex Crewneck"), "unisex")
})

test("men 과 women 이 함께면 모호 — unisex 근거가 없을 때", () => {
  assert.equal(inferGenderFromText("men and women coat"), null)
})

test("men + women + unisex 는 명시적 남녀공용이므로 unisex", () => {
  // 실측(shopify 픽스처): 태그 "unisex, MALE, Female, footwear".
  // 남녀 상충이 아니라 사이트가 남녀공용을 명시한 것 — 근거이지 추측이 아니다.
  assert.equal(inferGenderFromText("unisex MALE Female footwear"), "unisex")
  assert.equal(inferGenderFromText("men women unisex"), "unisex")
})

test("태그가 evidence 에 포함돼 URL 과 함께 판정된다", () => {
  // 태그의 Unisex 가 name/URL 의 men 을 뒤집지 않으므로 충돌이 나지 않는다.
  const r = resolveProductGenderWithSource([], {
    name: "SRC Oversized Oxford Shirt Men - Forest striped",
    tags: ["Unisex", "Shirts"],
    productUrl: "https://www.sportyandrich.com/products/src-oversized-oxford-shirt-forest-striped-men",
  })
  assert.deepEqual(r.gender, ["men"])
  assert.equal(r.conflict, undefined)
})

test("unisex 는 구체 성별과 충돌하지 않는다 (URL 우선)", () => {
  // 실측(jadedldn): URL 이 `.../top-women` 인데 사이트 blanket "unisex" 태그가
  // 텍스트를 unisex 로 만들어 충돌 처리됐고, 명백한 여성 상품이 드랍됐다.
  const r = resolveProductGenderWithSource([], {
    name: "Irbis Waffle Long Sleeve Top",
    tags: ["unisex"],
    productUrl: "https://jadedldn.com/en-kr/products/irbis-waffle-long-sleeve-top-women",
  })
  assert.deepEqual(r.gender, ["women"])
  assert.equal(r.conflict, undefined)
})

test("men vs women 은 여전히 진짜 충돌", () => {
  const r = resolveProductGenderWithSource([], {
    name: "WOMEN'S COAT",
    productUrl: "https://x.com/kr/ko/men/coat-1",
  })
  assert.deepEqual(r.gender, [])
  assert.deepEqual(r.conflict, {url: "men", text: "women"})
})
