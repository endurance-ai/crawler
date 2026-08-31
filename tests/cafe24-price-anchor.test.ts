/**
 * 가격 앵커 정규식 — 라벨/통화기호에 붙은 숫자만 뽑는다.
 *
 * 회귀 대상(2026-08-27): 리스트 가격 셀렉터가 실패하면 엔진이 아이템 안의
 * span/p/div 를 훑는데, 예전 판정은 "이 텍스트에 원화 기호가 있나"였다.
 * 그런데 이 폴백이 잡는 것은 대개 가격 요소가 아니라 상품명과 가격이 함께
 * 든 Cafe24 spec 블록이라, 블록 전체가 priceText 가 되고 뒤의 숫자 정규식이
 * 상품명의 첫 숫자를 집어갔다.
 *
 *   "상품명 : COMME des GARCONS HOMME 2016 Jacket 판매가 : 380,000" -> 2016
 *
 * 실측: socio 는 이름에 연도가 든 상품 37건 전부가 연도를 가격으로 받았고
 * 정상 가격은 0건이었다. 크기 하한(1000)은 4자리 연도를 그대로 통과시킨다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {
  CURRENCY_ANCHOR,
  FOREIGN_ANCHOR,
  LIST_PRICE_ANCHOR,
  SALE_PRICE_ANCHOR,
} from "../src/lib/cafe24-engine"

/** 엔진 evaluate 본문과 동일한 우선순위/그룹 선택. */
function pick(text: string, foreign = false): number | null {
  const anchored =
    text.match(new RegExp(SALE_PRICE_ANCHOR)) ||
    text.match(new RegExp(LIST_PRICE_ANCHOR)) ||
    text.match(new RegExp(CURRENCY_ANCHOR))
  const value = anchored ? anchored[1] || anchored[2] || anchored[3] : null
  if (value) return Number(value.replace(/,/g, ""))
  if (/^\d{1,3}(,\d{3})+원?$/.test(text)) return Number(text.replace(/[^\d]/g, ""))
  if (foreign) {
    const fx = text.match(new RegExp(FOREIGN_ANCHOR, "i"))
    if (fx?.[1]) return Number(fx[1])
  }
  return null
}

test("spec 블록에서 상품명의 연도가 아니라 라벨에 붙은 가격을 집는다", () => {
  assert.equal(
    pick("상품명 : COMME des GARÇONS HOMME 2016 Jacket 판매가 : ₩380,000"),
    380000,
  )
  assert.equal(
    pick("상품명 : COMME des GARÇONS HOMME 2011 Hooded Military Field Jacket 판매가 : ₩210,000"),
    210000,
  )
  assert.equal(
    pick("상품명 : yohji Yamamoto POUR HOMME 2022 Garment Dye Wrap Pants 판매가 : ₩150,000"),
    150000,
  )
})

test("할인판매가가 있으면 정가보다 먼저 잡는다", () => {
  assert.equal(pick("판매가 : ₩380,000 할인판매가 : ₩290,000"), 290000)
})

test("라벨 없이 통화기호만 있어도 붙은 숫자를 잡는다", () => {
  assert.equal(pick("₩140,000"), 140000)
  assert.equal(pick("￦ 98,000"), 98000)
  assert.equal(pick("KRW 140,000"), 140000)
  assert.equal(pick("140,000원"), 140000)
})

test("라벨도 기호도 없는 순수 가격 표기는 그대로 인정한다", () => {
  assert.equal(pick("140,000"), 140000)
})

test("가격 근거가 전혀 없으면 null — 이름의 숫자를 주워오지 않는다", () => {
  assert.equal(pick("상품명 : COMME des GARÇONS HOMME 2016 Jacket"), null)
  assert.equal(pick("26SS Wool Coat"), null)
  assert.equal(pick("2016"), null, "네 자리 맨숫자는 가격 근거가 아니다")
  assert.equal(pick(""), null)
})

test("해외 통화 사이트는 통화기호에 붙은 소수 가격을 잡는다", () => {
  assert.equal(pick("Price : $79.00", true), 79)
  assert.equal(pick("€ 129.50", true), 129.5)
  assert.equal(pick("Some Jacket 2016 Edition $250.00", true), 250)
})
