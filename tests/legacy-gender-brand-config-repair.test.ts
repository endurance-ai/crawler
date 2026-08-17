import test from "node:test"
import assert from "node:assert/strict"

import {verifiedBrandGenderIndex} from "../tools/repair-legacy-gender-from-brand-configs"

test("공식몰 검증 기본값만 동일 brand_node 레거시 복구에 사용한다", () => {
  const index = verifiedBrandGenderIndex([
    {platform_key: "rough-type", brand_node_id: 1},
    {platform_key: "rollingstudios", brand_node_id: 2},
    {platform_key: "durt", brand_node_id: 3},
  ])
  assert.equal(index.get(1), "women")
  assert.equal(index.get(2), "unisex")
  assert.equal(index.has(3), false)
})

test("같은 brand_node의 검증 기본값이 충돌하면 복구 대상에서 제외한다", () => {
  const index = verifiedBrandGenderIndex([
    {platform_key: "rough-type", brand_node_id: 1},
    {platform_key: "wooyoungmi", brand_node_id: 1},
  ])
  assert.equal(index.has(1), false)
})
