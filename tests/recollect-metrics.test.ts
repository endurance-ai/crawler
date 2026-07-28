/**
 * 재수집 지표 + import 전 게이트.
 *
 * 가장 중요한 회귀는 첫 테스트다: 캠페인 KPI(비canonical color)를
 * classifyColorRepair 로 재면 안 된다. normalizeColorField 의 마지막 분기가
 * title-case passthrough 라서 "Coffee Bean" 같은 값은 repair 분류기가
 * "unchanged" 로 판정한다. 실제로 browns 11,455행은 repair 기준 0건이지만
 * canonical 기준 11,443건이 벗어나 있었다 — 지표를 잘못 고르면 게이트가
 * 통째로 무력화된다 (2026-07-28 구현 중 실측으로 발견).
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  computeRecollectMetrics,
  evaluateGate,
  isCanonicalColor,
  type MetricsRow,
} from "../src/lib/recollect-metrics"

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
  return {
    id: 1,
    product_url: "https://example.com/p/1",
    platform: "example",
    brand: "Brand",
    brand_node_id: null,
    name: "Wool Coat",
    category: "outerwear",
    subcategory: "overcoat",
    color: "Black",
    description: "A coat.",
    tags: null,
    gender: ["unisex"],
    gender_source: "engine",
    images: ["https://cdn.example.com/a.jpg"],
    image_url: "https://cdn.example.com/a.jpg",
    in_stock: true,
    updated_at: "2026-07-28T00:00:00.000Z",
    ...overrides,
  }
}

test("비canonical color 는 canonical 멤버십으로 재고, repair 가능 여부와 구분된다", () => {
  const rows = [
    row({id: 1, color: "Black"}),
    // title-case 된 비canonical 값 — repair 분류기는 "unchanged" 로 보지만
    // 검색 필터에는 절대 안 걸리므로 KPI 상으로는 명백한 오염이다.
    row({id: 2, color: "Coffee Bean"}),
    row({id: 3, color: "Pristine"}),
  ]
  const metrics = computeRecollectMetrics(rows)

  assert.equal(metrics.colorNonCanonical, 2, "Coffee Bean/Pristine 이 비canonical 로 잡혀야 한다")
  assert.equal(
    metrics.colorRepairable,
    0,
    "repair 스크립트는 이 값들을 못 고친다 — 두 지표가 서로 다른 질문에 답한다는 것이 요지",
  )
})

test("isCanonicalColor: 다중값은 모든 조각이 canonical 이어야 통과", () => {
  assert.equal(isCanonicalColor("Black"), true)
  assert.equal(isCanonicalColor("black"), true, "대소문자 무시")
  // 검색 RPC 는 UPPER(color) = UPPER(family) 정확 일치라 다중값은 어디에도 안 걸리지만,
  // 조각이 전부 canonical 인지 여부는 별개 질문이므로 여기서는 통과시킨다.
  assert.equal(isCanonicalColor("Black, White"), true)
  assert.equal(isCanonicalColor("Black, Coffee Bean"), false, "한 조각이라도 벗어나면 비canonical")
  assert.equal(isCanonicalColor(""), false)
  assert.equal(isCanonicalColor(null), false)
})

test("color 없는 행은 colorMissing 으로만 세고 비canonical 에 중복 계상하지 않는다", () => {
  const metrics = computeRecollectMetrics([row({color: null}), row({color: "   "})])
  assert.equal(metrics.colorMissing, 2)
  assert.equal(metrics.colorNonCanonical, 0, "없는 값과 잘못된 값은 다른 문제다")
})

test("gender/category/이미지 결손을 각각 센다", () => {
  const metrics = computeRecollectMetrics([
    row({gender: []}),
    row({category: "Cat42"}),
    row({images: [], image_url: ""}),
    row({images: [], image_url: "https://cdn.example.com/b.jpg"}),
  ])
  assert.equal(metrics.genderMissing, 1)
  assert.equal(metrics.categoryInvalid, 1)
  assert.equal(metrics.imageMissing, 1, "images 도 image_url 도 없는 행만 대표이미지 결손")
  assert.equal(metrics.imagesEmpty, 2, "images 빈배열은 payload 회귀 트립와이어라 따로 센다")
})

test("게이트: color/gender 결손이 상한을 넘으면 차단한다", () => {
  // import-products 가 color 없는 행과 gender 빈 행을 조용히 드랍하므로,
  // 이 비율이 높으면 적재해봐야 데이터가 사라진다.
  const bad = computeRecollectMetrics([row({color: null}), row(), row(), row()])
  const gate = evaluateGate(bad, null)
  assert.equal(gate.pass, false)
  assert.ok(gate.failures.some((f) => f.check === "color_missing"), JSON.stringify(gate.failures))
})

test("게이트: 행수가 기존의 60% 미만이면 차단한다", () => {
  const before = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i, color: "Coffee Bean"})))
  const after = computeRecollectMetrics(Array.from({length: 50}, (_, i) => row({id: i})))
  const gate = evaluateGate(after, before)
  assert.equal(gate.pass, false)
  assert.ok(gate.failures.some((f) => f.check === "row_count"), JSON.stringify(gate.failures))
})

test("게이트: 비canonical color 가 안 줄면 차단한다 (캠페인의 존재 이유)", () => {
  const before = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i, color: "Coffee Bean"})))
  const after = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i, color: "Pristine"})))
  const gate = evaluateGate(after, before)
  assert.equal(gate.pass, false)
  assert.ok(gate.failures.some((f) => f.check === "color_not_improved"), JSON.stringify(gate.failures))
})

test("게이트: 개선된 재수집은 통과한다", () => {
  const before = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i, color: "Coffee Bean"})))
  const after = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i, color: "Black"})))
  const gate = evaluateGate(after, before)
  assert.equal(gate.pass, true, JSON.stringify(gate.failures))
})

test("게이트: 브랜드 수가 크게 줄면 차단한다 (브랜드 추출 회귀)", () => {
  // 멀티브랜드 편집샵에서 브랜드 추출이 깨지면 상품이 통째로 유실된다.
  const before = computeRecollectMetrics(
    Array.from({length: 100}, (_, i) => row({id: i, brand: `Brand${i}`, color: "Coffee Bean"})),
  )
  const after = computeRecollectMetrics(
    Array.from({length: 100}, (_, i) => row({id: i, brand: `Brand${i % 50}`})),
  )
  const gate = evaluateGate(after, before)
  assert.equal(gate.pass, false)
  assert.ok(gate.failures.some((f) => f.check === "distinct_brands"), JSON.stringify(gate.failures))
})
