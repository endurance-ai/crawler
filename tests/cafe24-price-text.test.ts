/**
 * `isPriceLikeText` — 세일가 셀렉터가 잡은 텍스트를 가격으로 읽어도 되는지.
 *
 * 회귀 대상: cafe24 세일가 셀렉터가 가격 요소가 아니라 상품명이 든 컨테이너를
 * 잡고, 기본 가격 정규식(숫자+콤마)이 거기서 첫 숫자를 집어가던 버그.
 * 상품명에 연도가 들어간 아카이브/빈티지 상품이 전부 "연도 = 세일가" 가 됐다.
 *
 * 실측 2026-08-27: socio 27행 포함 전 카탈로그 51행.
 *   "COMME des GARÇONS HOMME PLUS 1997 Pants" → price 1,997 / 원가 140,000
 *
 * 기존 방어는 크기 하한(₩1,000)뿐이라 4자리 연도를 그대로 통과시켰다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {isPriceLikeText, MAX_PRICE_TEXT_LENGTH} from "../src/lib/cafe24-engine"

test("정상 가격 표기는 통과한다", () => {
  for (const t of [
    "₩140,000",
    "140,000원",
    "140,000",
    "KRW 140,000",
    "￦ 1,997",
    "$9.12",
    "€ 79.00",
    "판매가 : ₩140,000",
    "할인판매가 : 98,000원",
    "9800",
  ]) {
    assert.equal(isPriceLikeText(t), true, `가격으로 인정돼야 함: ${t}`)
  }
})

test("상품명이 섞인 컨테이너 텍스트는 거부한다 — 연도가 가격으로 새던 경로", () => {
  for (const t of [
    "COMME des GARÇONS HOMME PLUS 1997 Pants",
    "COMME des GARÇONS HOMME 2001 Pants",
    "robe de chambre COMME des GARÇONS 2002 Multi",
    "JUNYA WATANABE MAN COMME des GARÇONS 2004 Jacket",
    "1997 Pants",
    "26SS Wool Coat",
  ]) {
    assert.equal(isPriceLikeText(t), false, `가격이 아니어야 함: ${t}`)
  }
})

test("빈 텍스트와 과도하게 긴 텍스트는 거부한다", () => {
  assert.equal(isPriceLikeText(""), false)
  assert.equal(isPriceLikeText("   "), false)
  // 가격 표기가 80자를 넘을 일은 없다 — 넘으면 컨테이너를 잡은 것이다.
  assert.equal(isPriceLikeText("1".repeat(MAX_PRICE_TEXT_LENGTH + 1)), false)
  assert.equal(isPriceLikeText("1".repeat(MAX_PRICE_TEXT_LENGTH)), true)
})

test("숫자만 있는 텍스트는 통과하되 크기 하한이 별도로 막는다", () => {
  // isPriceLikeText 는 구성만 본다. "10%" 는 구성상 가격 같지만 값이 10 이라
  // 엔진의 minPlausiblePrice(KRW 1000) 가 거른다 — 두 가드는 직교한다.
  assert.equal(isPriceLikeText("10%"), true)
  assert.equal(isPriceLikeText("26"), true)
})

test("한글 안내 문구가 섞이면 거부한다", () => {
  assert.equal(isPriceLikeText("무료배송 140,000"), false)
  assert.equal(isPriceLikeText("품절"), false)
  assert.equal(isPriceLikeText("적립금 1,400원"), true, "가격 라벨은 허용어다")
})
