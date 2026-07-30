import assert from "node:assert/strict"
import test from "node:test"

import {detectStatusPatch, isInconclusiveDetection, type DetectResult} from "../src/brand-crawl"

const result: DetectResult = {
  platform_type: "cafe24",
  category_discovery: "manual",
  platform_key: "acme",
  categories: [{cateNo: 42}, {cateNo: 43}],
  detection: {cate_no_count: 2},
}

const args = {platformKey: "acme", result, detectedAt: "2026-07-30T00:00:00Z"}

test("--preserve-status 는 status/config_status 를 patch 에서 아예 뺀다", () => {
  // upsert(onConflict=brand_node_id) 라 키를 빼면 기존 값이 남는다. 2026-07-30
  // 이전에는 status 를 무조건 세팅한 뒤 no-op spread 를 붙여 아무것도 보존하지
  // 못했고, imported 비KR 브랜드가 tech_detected 로 되돌아 config 생성에서
  // 조용히 탈락했다 (실측 19개 브랜드 / 재고 2,513건).
  const patch = detectStatusPatch({...args, preserveStatus: true})
  assert.equal("status" in patch, false)
  assert.equal("config_status" in patch, false)
})

test("preserve 아닐 때는 tech_detected/needed 로 되돌린다", () => {
  const patch = detectStatusPatch({...args, preserveStatus: false})
  assert.equal(patch.status, "tech_detected")
  assert.equal(patch.config_status, "needed")
})

test("탐지 산출물은 preserve 여부와 무관하게 항상 쓴다", () => {
  // platform_type/categories 를 못 쓰면 detect 를 돌린 의미가 없다 —
  // generate-platform-configs 가 platform_type 으로 후보를 가른다.
  for (const preserveStatus of [true, false]) {
    const patch = detectStatusPatch({...args, preserveStatus})
    assert.equal(patch.platform_type, "cafe24")
    assert.equal(patch.category_discovery, "manual")
    assert.deepEqual(patch.categories, [{cateNo: 42}, {cateNo: 43}])
    assert.equal(patch.platform_key, "acme")
    assert.equal(patch.detected_at, "2026-07-30T00:00:00Z")
    // 재탐지 성공 시 이전 실패 흔적은 지운다.
    assert.equal(patch.last_error, null)
    assert.equal(patch.blocked_reason, null)
  }
})

// ── 판정 실패(차단/레이트리밋) 처리 ──────────────────────────────────────────

const blockedResult: DetectResult = {
  platform_type: "custom",
  category_discovery: "auto",
  platform_key: "rasario",
  categories: [],
  detection: {bot_protected: true, homepage_status: 429},
}

test("차단·레이트리밋으로 신호를 못 찾았으면 플랫폼 필드를 쓰지 않는다", () => {
  // platform_type='custom' 은 "cafe24 도 shopify 도 아니다" 라는 단정이다.
  // 429 를 받아 페이지를 못 본 경우까지 custom 으로 기록하면 아직 미탐지라는
  // 뜻인 unknown 을 거짓 단정으로 덮어쓴다 (실측: rasario / harriet-allure).
  assert.equal(isInconclusiveDetection(blockedResult), true)
  const patch = detectStatusPatch({
    platformKey: "rasario",
    result: blockedResult,
    detectedAt: "2026-07-30T00:00:00Z",
    preserveStatus: true,
  })
  assert.equal("platform_type" in patch, false)
  assert.equal("category_discovery" in patch, false)
  assert.equal("categories" in patch, false)
  // 실패 근거는 남긴다 — 조용히 넘어가면 왜 미탐지인지 알 수 없다.
  assert.deepEqual(patch.detection, blockedResult.detection)
  assert.match(String(patch.last_error), /inconclusive/)
  // 성공했다고 착각하게 만드는 blocked_reason 초기화는 하지 않는다.
  assert.equal("blocked_reason" in patch, false)
})

test("신호가 잡혔으면 차단 페이지였어도 판정을 채택한다", () => {
  // 챌린지 페이지에 cafe24 마커가 남아 있는 경우가 실제로 있다.
  const signalled: DetectResult = {
    ...blockedResult,
    platform_type: "cafe24",
    category_discovery: "manual",
    categories: [{cateNo: 42}],
  }
  assert.equal(isInconclusiveDetection(signalled), false)
  const patch = detectStatusPatch({
    platformKey: "x",
    result: signalled,
    detectedAt: "2026-07-30T00:00:00Z",
    preserveStatus: true,
  })
  assert.equal(patch.platform_type, "cafe24")
  assert.deepEqual(patch.categories, [{cateNo: 42}])
})

test("차단이 아닌 정상 custom 판정은 그대로 기록한다", () => {
  const genuineCustom: DetectResult = {
    platform_type: "custom",
    category_discovery: "auto",
    platform_key: "imweb-shop",
    categories: [],
    detection: {bot_protected: false, homepage_status: 200, platform_family: "imweb"},
  }
  assert.equal(isInconclusiveDetection(genuineCustom), false)
  const patch = detectStatusPatch({
    platformKey: "imweb-shop",
    result: genuineCustom,
    detectedAt: "2026-07-30T00:00:00Z",
    preserveStatus: true,
  })
  assert.equal(patch.platform_type, "custom")
  assert.equal(patch.last_error, null)
})
