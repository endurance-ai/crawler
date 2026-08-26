/**
 * `shouldCrawlDetails` — 상세 크롤 기본값 계약.
 *
 * 2026-08-26 에 opt-in 에서 opt-out 으로 뒤집었다. opt-in 이던 동안
 * cafe24/imweb 사이트가 조용히 상품당 이미지 1장에 묶였다 — 리스트 페이지는
 * 썸네일 하나만 주고 갤러리는 PDP 에만 있다. 대표컷(모델샷) 선별은 후보가
 * 여러 장이어야 성립하므로 1장이면 기능 자체가 불가능하다.
 *
 * 실측 당시: 전체 248,093행 중 39,469행(16%)이 이미지 1장 이하,
 * 상세가 꺼진 imweb 사이트 51.4% vs 켜진 사이트 0%.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {shouldCrawlDetails} from "../src/lib/platform-config-lifecycle"

test("미설정은 켬 — config 120개를 일일이 고치지 않아도 전체 이미지를 받는다", () => {
  assert.equal(shouldCrawlDetails({}), true)
  assert.equal(shouldCrawlDetails({crawlDetails: undefined}), true)
})

test("명시적 true 는 그대로 켬", () => {
  assert.equal(shouldCrawlDetails({crawlDetails: true}), true)
})

test("끄려면 명시적 false 여야 한다 — --no-detail 과 refresh-listing 만 이 경로다", () => {
  assert.equal(shouldCrawlDetails({crawlDetails: false}), false)
})

test("falsy 값이 실수로 끔이 되지 않는다", () => {
  // `!config.crawlDetails` 로 판정하던 옛 코드는 undefined 를 끔으로 봤다.
  // 이제 undefined/null 은 켬이고 오직 false 만 끔이다.
  assert.equal(shouldCrawlDetails({crawlDetails: null as unknown as undefined}), true)
})
