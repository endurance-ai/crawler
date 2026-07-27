import test from "node:test"
import assert from "node:assert/strict"

import {classifyGenderRepair, summarizeGenderRepair, type ProductGenderRow} from "../src/lib/gender-repair"
import type {ProductGender} from "../src/lib/product-gender"

function row(overrides: Partial<ProductGenderRow> = {}): ProductGenderRow {
  return {
    id: 1,
    gender: ["unisex"],
    gender_source: null,
    name: "Signature Wool Coat",
    category: "outer",
    subcategory: null,
    description: null,
    product_url: "https://shop.example.com/product/detail.html?product_no=1",
    tags: null,
    platform: "exampleshop",
    brand: "EXAMPLE",
    brand_node_id: 10,
    last_seen_at: "2026-07-01T00:00:00Z",
    ...overrides,
  }
}

const scopes = (entries: Array<[number, ProductGender[]]> = []) => new Map<number, ProductGender[]>(entries)

// ─── 교정 대상 ───────────────────────────────────────────────────────────

test("상품명이 여성이면 세탁된 unisex 를 women 으로 교정한다", () => {
  const d = classifyGenderRepair(row({name: "Women's Trench Coat"}), scopes())
  assert.equal(d.bucket, "confirmed_women")
  assert.deepEqual(d.after, ["women"])
  assert.equal(d.gender_source, "repair_text")
  assert.deepEqual(d.before, ["unisex"])
})

test("URL 경로에서 성별을 읽어 교정한다", () => {
  const d = classifyGenderRepair(
    row({name: "Wool Coat", product_url: "https://shop.example.com/category/mens-outer/12"}),
    scopes(),
  )
  assert.equal(d.bucket, "confirmed_men")
  assert.deepEqual(d.after, ["men"])
  assert.equal(d.gender_source, "repair_url")
  assert.equal(d.evidence, "https://shop.example.com/category/mens-outer/12")
})

test("단일 성별 브랜드 스코프로 교정한다", () => {
  const d = classifyGenderRepair(row(), scopes([[10, ["women"]]]))
  assert.equal(d.bucket, "brand_single_gender")
  assert.deepEqual(d.after, ["women"])
  assert.equal(d.gender_source, "repair_brand_scope")
})

// ─── 교정하지 않는 것 ────────────────────────────────────────────────────

test("근거가 없으면 unverified — gender 를 건드리지 않는다", () => {
  const d = classifyGenderRepair(row(), scopes([[10, ["unisex"]]]))
  assert.equal(d.bucket, "unverified")
  assert.equal(d.after, null)
  assert.equal(d.gender_source, "unverified_legacy")
})

test("모호한 브랜드 스코프(men+women)는 근거가 되지 못한다", () => {
  const d = classifyGenderRepair(row(), scopes([[10, ["men", "women"]]]))
  assert.equal(d.bucket, "unverified")
  assert.equal(d.after, null)
})

test("검증된 unisex 는 값이 같으므로 쓰기 없이 출처만 확정된다", () => {
  const d = classifyGenderRepair(row({name: "남녀공용 오버핏 후디"}), scopes())
  assert.equal(d.bucket, "unchanged")
  assert.equal(d.after, null)
  assert.equal(d.gender_source, "repair_text")
})

test("아동복은 kids 버킷 — 성인 성별로 교정하지 않는다", () => {
  const d = classifyGenderRepair(row({name: "KIDS 아동 후드 티셔츠"}), scopes([[10, ["women"]]]))
  assert.equal(d.bucket, "kids")
  assert.equal(d.after, null)
  assert.equal(d.gender_source, "unverified_legacy")
})

test("URL 과 텍스트가 충돌하면 교정하지 않고 conflict 를 남긴다", () => {
  const d = classifyGenderRepair(
    row({name: "WOMEN'S SILK BLOUSE", product_url: "https://shop.example.com/men/tops/9"}),
    scopes([[10, ["women"]]]),
  )
  assert.equal(d.after, null)
  assert.deepEqual(d.conflict, {url: "men", text: "women"})
})

test("저장된 gender 값은 근거로 쓰지 않는다 (그 값이 불신 대상)", () => {
  // 저장값이 ["men"] 이어도 상품명이 여성이면 women 으로 판정되어야 한다.
  const d = classifyGenderRepair(row({gender: ["men"], name: "Women's Wool Coat"}), scopes())
  assert.deepEqual(d.after, ["women"])
  assert.deepEqual(d.before, ["men"])
})

// ─── description 비대칭 ──────────────────────────────────────────────────

test("description 은 기본 제외, --use-description 일 때만 포함", () => {
  const r = row({name: "Oversized Hoodie", description: "여성 사이즈 참고: 55/66 기준"})
  assert.equal(classifyGenderRepair(r, scopes()).bucket, "unverified")

  const withDesc = classifyGenderRepair(r, scopes(), {useDescription: true})
  assert.equal(withDesc.bucket, "confirmed_women")
  assert.deepEqual(withDesc.after, ["women"])
})

// ─── 집계 ────────────────────────────────────────────────────────────────

test("summarizeGenderRepair: 버킷/플랫폼/브랜드 집계와 샘플 상한", () => {
  const decisions = [
    ...Array.from({length: 15}, (_, i) =>
      classifyGenderRepair(row({id: i + 1, name: "Women's Coat", platform: "a"}), scopes()),
    ),
    classifyGenderRepair(row({id: 100, name: "Men's Coat", platform: "b", brand_node_id: 20, brand: "OTHER"}), scopes()),
    classifyGenderRepair(row({id: 101, platform: "b", brand_node_id: 20, brand: "OTHER"}), scopes()),
  ]
  const s = summarizeGenderRepair(decisions)

  assert.equal(s.total, 17)
  assert.equal(s.byBucket.confirmed_women, 15)
  assert.equal(s.byBucket.confirmed_men, 1)
  assert.equal(s.byBucket.unverified, 1)
  // unverified 는 after=null 이므로 쓰기 대상이 아니다
  assert.equal(s.writable, 16)

  assert.equal(s.samples.confirmed_women?.length, 10, "샘플은 버킷당 10건 상한")

  assert.deepEqual(
    s.byPlatform.map((p) => [p.platform, p.total]),
    [["a", 15], ["b", 2]],
  )
  assert.equal(s.byBrandNode[0].brand, "EXAMPLE")
  assert.equal(s.byBrandNode[0].total, 15)
})

test("summarizeGenderRepair: 빈 입력", () => {
  const s = summarizeGenderRepair([])
  assert.equal(s.total, 0)
  assert.equal(s.writable, 0)
  assert.deepEqual(s.byPlatform, [])
})
