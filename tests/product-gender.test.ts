import test from "node:test"
import assert from "node:assert/strict"

import {
  cleanGenderScope,
  inferGenderFromText,
  inferGenderFromUrl,
  isKidsText,
  isSingleGenderScope,
  resolveProductGenderWithSource,
} from "../src/lib/product-gender"

// ─── 회귀: unisex 세탁 ────────────────────────────────────────────────────
//
// 이 파일이 막는 버그: 상품에서 성별을 못 뽑으면 brand_nodes.gender_scope 를
// 그대로 복사해 "모름"이 "unisex" 로 적재됐고, 검색 RPC 는
// `p.gender && ARRAY[p_gender,'unisex']` 라 그 상품이 남성·여성 양쪽 결과에
// 노출됐다 (= 남성 검색에 여성복이 뜸).

test("unisex 세탁: 브랜드 스코프가 ['unisex'] 여도 상품명이 여성이면 women 으로 결의된다", () => {
  const r = resolveProductGenderWithSource([], ["unisex"], {name: "WOMEN'S WOOL BLEND COAT"})
  assert.deepEqual(r.gender, ["women"])
  assert.equal(r.source, "text")
})

test("unisex 세탁: 신호가 전혀 없으면 브랜드 unisex 로 폴백하지 않고 미확인", () => {
  const r = resolveProductGenderWithSource([], ["unisex"], {name: "Signature Wool Coat"})
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
})

test("unisex 는 명시적 신호가 있을 때만 부여된다", () => {
  const r = resolveProductGenderWithSource([], [], {name: "남녀공용 오버핏 후디"})
  assert.deepEqual(r.gender, ["unisex"])
  assert.equal(r.source, "text")
})

// ─── 우선순위 ────────────────────────────────────────────────────────────

test("우선순위: engine > url > text > brand_scope > 미확인", () => {
  // 1. 엔진 값이 최우선 (URL/텍스트가 반대여도)
  assert.deepEqual(
    resolveProductGenderWithSource(["women"], ["men"], {name: "MEN'S COAT", productUrl: "https://x.com/men/1"}),
    {gender: ["women"], source: "engine"},
  )

  // 2. URL 이 텍스트보다 우선 (크롤러가 실제 진입한 카테고리 랜딩)
  assert.deepEqual(
    resolveProductGenderWithSource([], ["unisex"], {name: "Wool Coat", productUrl: "https://x.com/women/1"}),
    {gender: ["women"], source: "url"},
  )

  // 3. URL 신호가 없으면 텍스트
  assert.deepEqual(
    resolveProductGenderWithSource([], [], {name: "남성 데님 팬츠", productUrl: "https://x.com/p/1"}),
    {gender: ["men"], source: "text"},
  )

  // 4. 둘 다 없으면 단일 성별 브랜드 스코프
  assert.deepEqual(
    resolveProductGenderWithSource([], ["women"], {name: "Signature Coat"}),
    {gender: ["women"], source: "brand_scope"},
  )

  // 5. 그마저 없으면 미확인
  assert.deepEqual(resolveProductGenderWithSource([], [], {name: "Signature Coat"}), {gender: [], source: null})
})

test("URL 과 텍스트가 충돌하면 추측하지 않고 미확인 + conflict 보고", () => {
  const r = resolveProductGenderWithSource([], ["men"], {
    name: "WOMEN'S SILK BLOUSE",
    productUrl: "https://x.com/kr/men/tops/1",
  })
  assert.deepEqual(r.gender, [])
  assert.equal(r.source, null)
  assert.deepEqual(r.conflict, {url: "men", text: "women"})
})

test("엔진 값이 이미 있으면 재호출해도 source 는 engine 으로 유지된다 (멱등)", () => {
  const first = resolveProductGenderWithSource([], [], {name: "여성 코트"})
  const second = resolveProductGenderWithSource(first.gender, [], {name: "여성 코트"})
  assert.deepEqual(second, {gender: ["women"], source: "engine"})
})

// ─── config_default (사이트 전역 defaultGender) ──────────────────────────
//
// 카테고리가 교차하는 사이트(yearsago: 여성 라인 상품이 "상의"에도 함께 걸린다)
// 에서 전역 기본값이 카테고리 유래 값과 동순위이면 dedup merge 가 union 을 만들어
// ['men','women'] → 남녀 양쪽 노출이 된다. 반드시 상품 단위 근거보다 아래여야 한다.

test("config_default 는 상품 단위 근거(카테고리/URL/텍스트)보다 아래다", () => {
  // 카테고리 유래 값은 그대로 engine
  assert.deepEqual(resolveProductGenderWithSource(["women"], [], {name: "Coat"}, "engine"), {
    gender: ["women"],
    source: "engine",
  })

  // 전역 기본값이 men 이어도 카테고리/텍스트가 women 이면 women 이 이긴다
  assert.deepEqual(
    resolveProductGenderWithSource(["men"], [], {name: "Years Ago Women Wool Coat"}, "config_default"),
    {gender: ["women"], source: "text"},
  )
  assert.deepEqual(
    resolveProductGenderWithSource(["men"], [], {name: "Coat", productUrl: "https://x.com/women/1"}, "config_default"),
    {gender: ["women"], source: "url"},
  )
})

test("config_default 는 상품 단위 근거가 없을 때만 쓰이고, 브랜드 스코프보다는 위다", () => {
  assert.deepEqual(resolveProductGenderWithSource(["men"], [], {name: "Vintage Blank T"}, "config_default"), {
    gender: ["men"],
    source: "config_default",
  })
  // 브랜드 스코프가 women 이어도 사이트 기본값이 이긴다 (사이트가 더 구체적)
  assert.deepEqual(resolveProductGenderWithSource(["men"], ["women"], {name: "Tee"}, "config_default"), {
    gender: ["men"],
    source: "config_default",
  })
})

test("config_default 라도 kids 는 성인 성별을 받지 않는다", () => {
  assert.deepEqual(resolveProductGenderWithSource(["men"], [], {name: "KIDS 아동 티셔츠"}, "config_default"), {
    gender: [],
    source: null,
  })
})

// ─── 한글 + \b 함정 ──────────────────────────────────────────────────────
//
// \b 는 한글에 적용되지 않으므로 한글 대안은 반드시 \b() 그룹 밖에 있어야 한다.

test("한글 성별 토큰", () => {
  assert.equal(inferGenderFromText("여성 울 코트"), "women")
  assert.equal(inferGenderFromText("남자 데님 팬츠"), "men")
  assert.equal(inferGenderFromText("남녀공용 후디"), "unisex")
  assert.equal(inferGenderFromText("유니섹스 볼캡"), "unisex")
  // 라틴 문자에 붙어 있어도 매치 — \b 그룹 밖이라는 증거
  assert.equal(inferGenderFromText("NEW여성COAT"), "women")
})

test("women 은 men 으로 오인되지 않는다", () => {
  assert.equal(inferGenderFromText("Women's Navy Coat"), "women")
  assert.equal(inferGenderFromText("WOMEN OUTERWEAR"), "women")
})

test("남성·여성이 함께 잡히면 모호 → null", () => {
  assert.equal(inferGenderFromText("남성 여성 공용 아님"), "unisex") // 공용 토큰이 있으면 unisex 우선
  assert.equal(inferGenderFromText("Men and Women Collection"), null)
})

// ─── URL 추론 ────────────────────────────────────────────────────────────

test("inferGenderFromUrl: 경로에서만 읽는다", () => {
  assert.equal(inferGenderFromUrl("https://www.zara.com/kr/ko/woman-coats-l1234.html"), "women")
  assert.equal(inferGenderFromUrl("https://www.farfetch.com/kr/shopping/men/coats/items.aspx"), "men")
  assert.equal(inferGenderFromUrl("https://shop.com/category/mens-outerwear/"), "men")
  assert.equal(inferGenderFromUrl("https://shop.com/c/women/tops?page=2"), "women")
})

test("inferGenderFromUrl: hostname 은 절대 보지 않는다", () => {
  // 도메인 하나가 전 상품을 남성으로 만들면 안 된다
  assert.equal(inferGenderFromUrl("https://hommes.kr/product/detail.html?product_no=123"), null)
  assert.equal(inferGenderFromUrl("https://ladies-shop.com/p/1"), null)
})

test("inferGenderFromUrl: 모호하거나 신호가 없으면 null", () => {
  assert.equal(inferGenderFromUrl("https://x.com/men/women/1"), null)
  assert.equal(inferGenderFromUrl("https://x.com/product/detail.html?product_no=123"), null)
  assert.equal(inferGenderFromUrl("https://x.com/menu/lunch"), null) // "menu" 는 men 이 아니다
  assert.equal(inferGenderFromUrl(""), null)
  assert.equal(inferGenderFromUrl(undefined), null)
  assert.equal(inferGenderFromUrl(42), null)
})

test("inferGenderFromUrl: malformed percent-encoding 에도 throw 하지 않는다", () => {
  assert.equal(inferGenderFromUrl("https://x.com/%E0%A4%A/men/1"), "men")
  assert.doesNotThrow(() => inferGenderFromUrl("https://x.com/%"))
})

// ─── kids 가드 ───────────────────────────────────────────────────────────
//
// kids 는 PRODUCT_GENDER_VALUES 에 없어 cleanGenderScope 가 조용히 버린다.
// 가드가 없으면 아동복이 브랜드 폴백으로 성인 성별을 얻는 제2의 세탁 경로가 된다.

test("kids 가드: 성인 토큰 없는 아동복은 브랜드 폴백을 타지 않는다", () => {
  assert.deepEqual(resolveProductGenderWithSource([], ["women"], {name: "KIDS 아동 티셔츠"}), {
    gender: [],
    source: null,
  })
  assert.deepEqual(resolveProductGenderWithSource([], ["men"], {name: "Boys' Puffer Jacket"}), {
    gender: [],
    source: null,
  })
  assert.deepEqual(
    resolveProductGenderWithSource([], ["women"], {
      name: "Dress",
      productUrl: "https://www.zara.com/kr/ko/kids-girl-dress-l1234.html",
    }),
    {gender: [], source: null},
  )
})

test("kids 가드: 성인 성별 신호가 명시되면 그 값을 쓴다", () => {
  const r = resolveProductGenderWithSource([], [], {name: "여성 키즈맘 원피스"})
  assert.deepEqual(r.gender, ["women"])
})

test("isKidsText", () => {
  assert.equal(isKidsText("KIDS TEE"), true)
  assert.equal(isKidsText("유아 배냇저고리"), true)
  assert.equal(isKidsText("Wool Coat"), false)
})

// ─── 스코프 판정 ─────────────────────────────────────────────────────────

test("isSingleGenderScope", () => {
  assert.equal(isSingleGenderScope(["men"]), true)
  assert.equal(isSingleGenderScope(["women"]), true)
  assert.equal(isSingleGenderScope(["unisex"]), false)
  assert.equal(isSingleGenderScope(["men", "women"]), false)
  assert.equal(isSingleGenderScope([]), false)
})

test("cleanGenderScope 는 kids 등 미지원 값을 버린다", () => {
  assert.deepEqual(cleanGenderScope(["Women", "MEN", "kids", "women"]), ["women", "men"])
  assert.deepEqual(cleanGenderScope("women"), [])
  assert.deepEqual(cleanGenderScope(null), [])
})

// ─── description 비대칭 ──────────────────────────────────────────────────

test("description 은 useDescription 일 때만 텍스트 추론에 포함된다", () => {
  const evidence = {name: "Oversized Hoodie", description: "여성 사이즈 참고: 55/66 기준"}
  assert.deepEqual(resolveProductGenderWithSource([], [], evidence), {gender: [], source: null})
  assert.deepEqual(resolveProductGenderWithSource([], [], {...evidence, useDescription: true}), {
    gender: ["women"],
    source: "text",
  })
})
