import test from "node:test"
import assert from "node:assert/strict"

import {
  shouldWidenBrandScopeToUnisex,
  summarizeTrustedBrandGenderEvidence,
} from "../src/lib/brand-gender-scope"

test("신뢰 가능한 남성·여성 상품이 모두 있으면 단일 브랜드 스코프를 unisex로 넓힌다", () => {
  const summary = summarizeTrustedBrandGenderEvidence([
    {gender: ["men"], gender_source: "engine"},
    {gender: ["women"], gender_source: "url"},
  ])
  assert.equal(shouldWidenBrandScopeToUnisex(["men"], summary), true)
  assert.equal(shouldWidenBrandScopeToUnisex(["women"], summary), true)
})

test("config_default와 과거 brand fallback은 양쪽 성별 근거로 쓰지 않는다", () => {
  const summary = summarizeTrustedBrandGenderEvidence([
    {gender: ["men"], gender_source: "config_default"},
    {gender: ["women"], gender_source: "brand_scope"},
    {gender: ["women"], gender_source: "unverified_legacy"},
  ])
  assert.deepEqual(summary, {
    trustedMen: 0,
    trustedWomen: 0,
    trustedUnisex: 0,
    ignored: 3,
    sampleMenProductIds: [],
    sampleWomenProductIds: [],
    sampleUnisexProductIds: [],
  })
  assert.equal(shouldWidenBrandScopeToUnisex(["men"], summary), false)
})

test("unisex 상품 하나만으로 단일 성별 브랜드 전체를 공용으로 넓히지 않는다", () => {
  const summary = summarizeTrustedBrandGenderEvidence([
    {gender: ["unisex"], gender_source: "text"},
  ])
  assert.equal(shouldWidenBrandScopeToUnisex(["women"], summary), false)
  assert.equal(shouldWidenBrandScopeToUnisex(["unisex"], summary), false)
})

test("한쪽 성별만 관측됐다고 브랜드를 축소하거나 반대 성별로 바꾸지 않는다", () => {
  const summary = summarizeTrustedBrandGenderEvidence([
    {gender: ["women"], gender_source: "engine"},
    {gender: ["women"], gender_source: "repair_url"},
  ])
  assert.equal(shouldWidenBrandScopeToUnisex(["men"], summary), false)
  assert.equal(shouldWidenBrandScopeToUnisex(["unisex"], summary), false)
})
