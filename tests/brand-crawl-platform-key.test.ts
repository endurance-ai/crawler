/**
 * platform_key UNIQUE 충돌 폴백 회귀 테스트.
 *
 * platform_key 는 홈페이지 호스트의 첫 라벨(keyFromUrl)에서 파생되므로 서로
 * 무관한 brand_node 가 같은 키로 수렴할 수 있다 (예: 수동 config 의 "goyowear"
 * 와 intl.goyowear.kr). 폴백이 없으면 detect 단계의 upsert 가 유니크 위반으로
 * throw 되고, 바깥 catch 가 정상 감지된 브랜드를 "blocked" 로 잘못 마킹해
 * 이후 크롤 배치에서 조용히 누락됐다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {isPlatformKeyConflict, uniquePlatformKey} from "../src/brand-crawl"

test("platform_key 유니크 위반 에러를 충돌로 판정한다", () => {
  const err = new Error(
    'duplicate key value violates unique constraint "idx_product_crawl_status_platform_key"',
  )
  assert.equal(isPlatformKeyConflict(err), true)
})

test("Error 가 아닌 값으로 던져진 충돌도 판정한다", () => {
  const thrown = {message: "idx_product_crawl_status_platform_key conflict"}
  assert.equal(isPlatformKeyConflict(String(thrown.message)), true)
})

test("무관한 에러는 충돌로 판정하지 않는다 (그대로 rethrow 되어야 함)", () => {
  assert.equal(isPlatformKeyConflict(new Error("network timeout")), false)
  assert.equal(
    isPlatformKeyConflict(new Error('null value in column "brand_node_id" violates not-null')),
    false,
  )
})

test("다른 유니크 인덱스 위반은 충돌로 판정하지 않는다", () => {
  const err = new Error(
    'duplicate key value violates unique constraint "idx_product_crawl_status_brand_node_id"',
  )
  assert.equal(isPlatformKeyConflict(err), false)
})

test("고유화 키는 brand_node_id 를 접미사로 붙인다", () => {
  assert.equal(uniquePlatformKey("goyowear", 5734), "goyowear-5734")
})

test("서로 다른 brand_node 는 같은 원본 키에서 서로 다른 고유 키를 얻는다", () => {
  assert.notEqual(uniquePlatformKey("goyowear", 5734), uniquePlatformKey("goyowear", 5735))
})
