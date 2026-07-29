/**
 * 재수집 지표 + import 전 게이트.
 *
 * color/gender 는 크롤러가 더 이상 만들지 않으므로(2026-07-29 VLM 이관) 이
 * 모듈의 KPI/게이트에서 빠졌다 — 남은 것은 subcategory/category/image 품질과
 * row-count/brand-count 회귀 감지다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  computeRecollectMetrics,
  evaluateGate,
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
    tags: null,
    images: ["https://cdn.example.com/a.jpg"],
    image_url: "https://cdn.example.com/a.jpg",
    in_stock: true,
    updated_at: "2026-07-28T00:00:00.000Z",
    ...overrides,
  }
}

test("subcategory/category/이미지 결손을 각각 센다", () => {
  const metrics = computeRecollectMetrics([
    row({subcategory: null}),
    row({category: "Cat42"}),
    row({images: [], image_url: ""}),
    row({images: [], image_url: "https://cdn.example.com/b.jpg"}),
  ])
  assert.equal(metrics.subcategoryMissing, 1)
  assert.equal(metrics.categoryInvalid, 1)
  assert.equal(metrics.imageMissing, 1, "images 도 image_url 도 없는 행만 대표이미지 결손")
  assert.equal(metrics.imagesEmpty, 2, "images 빈배열은 payload 회귀 트립와이어라 따로 센다")
})

test("게이트: taxonomy 밖 category 비율이 상한을 넘으면 차단한다", () => {
  const bad = computeRecollectMetrics(
    Array.from({length: 100}, (_, i) => row({id: i, category: i < 10 ? "Cat42" : "outerwear"})),
  )
  const gate = evaluateGate(bad, null)
  assert.equal(gate.pass, false)
  assert.ok(gate.failures.some((f) => f.check === "category_invalid"), JSON.stringify(gate.failures))
})

test("게이트: 행수가 기존의 60% 미만이면 차단한다", () => {
  const before = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i})))
  const after = computeRecollectMetrics(Array.from({length: 50}, (_, i) => row({id: i})))
  const gate = evaluateGate(after, before)
  assert.equal(gate.pass, false)
  assert.ok(gate.failures.some((f) => f.check === "row_count"), JSON.stringify(gate.failures))
})

test("게이트: 정상 재수집은 통과한다", () => {
  const before = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i})))
  const after = computeRecollectMetrics(Array.from({length: 100}, (_, i) => row({id: i})))
  const gate = evaluateGate(after, before)
  assert.equal(gate.pass, true, JSON.stringify(gate.failures))
})

test("게이트: 브랜드 수가 크게 줄면 차단한다 (브랜드 추출 회귀)", () => {
  // 멀티브랜드 편집샵에서 브랜드 추출이 깨지면 상품이 통째로 유실된다.
  const before = computeRecollectMetrics(
    Array.from({length: 100}, (_, i) => row({id: i, brand: `Brand${i}`})),
  )
  const after = computeRecollectMetrics(
    Array.from({length: 100}, (_, i) => row({id: i, brand: `Brand${i % 50}`})),
  )
  const gate = evaluateGate(after, before)
  assert.equal(gate.pass, false)
  assert.ok(gate.failures.some((f) => f.check === "distinct_brands"), JSON.stringify(gate.failures))
})
