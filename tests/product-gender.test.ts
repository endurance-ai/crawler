import test from "node:test"
import assert from "node:assert/strict"

import {
  cleanGenderScope,
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
