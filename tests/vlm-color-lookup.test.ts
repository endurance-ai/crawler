/**
 * VLM color 우선순위 (2026-07-28, product_features 발견 — 재수집 배치 2).
 *
 * titleCaseColorFamily 만 순수 로직 단위 테스트로 잠근다. fetchVlmColorsByPlatform
 * 은 실 Supabase 클라이언트 없이는 의미 있게 테스트하기 어려운 얇은 I/O
 * 래퍼라(PostgREST 임베드 응답이 배열/객체 두 형태로 올 수 있다는 것 자체가
 * 런타임 확인 사항), 여기서는 값 변환 규칙만 고정한다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {titleCaseColorFamily} from "../src/lib/vlm-color-lookup"
import {isCanonicalColor} from "../src/lib/recollect-metrics"

test("titleCaseColorFamily: COLOR_FAMILIES 값을 크롤러 Title Case 관례로 맞춘다", () => {
  assert.equal(titleCaseColorFamily("BLACK"), "Black")
  assert.equal(titleCaseColorFamily("MULTI"), "Multi")
  assert.equal(titleCaseColorFamily("  GREY  "), "Grey")
})

test("titleCaseColorFamily: 빈 값은 그대로 돌려준다", () => {
  assert.equal(titleCaseColorFamily(""), "")
  assert.equal(titleCaseColorFamily("   "), "")
})

test("VLM 이 줄 수 있는 모든 COLOR_FAMILIES 값이 우리 canonical 집합에 포함된다", () => {
  // product_features 가 실제로 쓰는 16개 family — 실측(2026-07-28)으로 확인.
  // 이 값들이 COLOR_CANONICAL_NAMES 밖으로 나가면 VLM 소스가 오히려
  // "비canonical" 로 잘못 카운트되는 회귀가 생긴다.
  const OBSERVED_VLM_FAMILIES = [
    "BEIGE", "BLACK", "BLUE", "BROWN", "CREAM", "GREEN", "GREY", "KHAKI",
    "MULTI", "NAVY", "ORANGE", "PINK", "PURPLE", "RED", "WHITE", "YELLOW",
  ]
  for (const family of OBSERVED_VLM_FAMILIES) {
    const titleCased = titleCaseColorFamily(family)
    assert.equal(isCanonicalColor(titleCased), true, `${family} -> ${titleCased} 가 canonical 이어야 한다`)
  }
})
