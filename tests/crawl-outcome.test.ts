import assert from "node:assert/strict"
import test from "node:test"

import {blockingSignals} from "../src/lib/crawl-outcome"

test("온보딩은 품질 경고도 차단 신호로 본다", () => {
  // 가격/이름이 대부분 빈 상품을 적재할 이유가 없다 → qc_failed 로 남아 재시도 대상.
  assert.deepEqual(
    blockingSignals({errors: [], qualityWarnings: ["Cafe24 quality failed: price_missing_rate=100"]}),
    ["Cafe24 quality failed: price_missing_rate=100"],
  )
})

test("엔진 오류와 품질 경고가 함께 있으면 둘 다 남는다", () => {
  assert.deepEqual(
    blockingSignals({errors: ["navigation timeout"], qualityWarnings: ["generic_name_rate=80"]}),
    ["navigation timeout", "generic_name_rate=80"],
  )
})

test("qualityWarnings 가 없는 엔진 결과도 그대로 동작한다", () => {
  // cafe24 외 엔진은 이 필드를 채우지 않는다 — undefined 여도 깨지면 안 된다.
  assert.deepEqual(blockingSignals({errors: ["boom"]}), ["boom"])
  assert.deepEqual(blockingSignals({errors: []}), [])
})

test("갱신 경로는 이 헬퍼를 쓰지 않는다 — errors 만 본다", () => {
  // 이 테스트는 계약을 문서화한다. refresh-listing.ts 의 guardOk / failed 판정이
  // qualityWarnings 를 보기 시작하면 42개 소스가 다시 갱신 불가 상태로 돌아간다
  // (실측 2026-07-30: price_missing_rate≈100 인 소스가 재고 이탈 감지까지 막혔다).
  const result = {errors: [], qualityWarnings: ["Cafe24 quality failed: price_missing_rate=100"]}
  // 갱신이 보는 값
  assert.equal(result.errors.length, 0)
  // 온보딩이 보는 값
  assert.equal(blockingSignals(result).length, 1)
})
