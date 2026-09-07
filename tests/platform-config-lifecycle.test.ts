import assert from "node:assert/strict"
import test from "node:test"

import {
  generatedPlatformType,
  queuePlatformType,
  shouldGeneratePlatformConfig,
  type PlatformConfigLifecycleRow,
} from "../src/lib/platform-config-lifecycle"

function row(patch: Partial<PlatformConfigLifecycleRow> = {}): PlatformConfigLifecycleRow {
  return {
    status: "tech_detected",
    config_status: "needed",
    origin_country: "KR",
    kr_eligibility_status: "eligible_origin",
    platform_type: "cafe24",
    detection: {},
    ...patch,
  }
}

test("신규 온보딩 후보는 KR origin 또는 검증된 KR storefront만 생성한다", () => {
  assert.equal(shouldGeneratePlatformConfig(row()), true)
  assert.equal(shouldGeneratePlatformConfig(row({status: "qc_failed"})), true)
  assert.equal(
    shouldGeneratePlatformConfig(row({origin_country: "US", kr_eligibility_status: "eligible_storefront"})),
    true,
  )
  for (const kr_eligibility_status of ["unchecked", "price_only", "unsupported", "inconclusive", "retryable_error"]) {
    assert.equal(
      shouldGeneratePlatformConfig(row({origin_country: "US", kr_eligibility_status})),
      false,
      kr_eligibility_status,
    )
  }
})

test("이미 수집된 설정은 상태와 국가가 바뀌어도 보존한다", () => {
  for (const status of ["crawled", "imported", "embedded", "active"] as const) {
    assert.equal(
      shouldGeneratePlatformConfig(row({status, origin_country: "US"})),
      true,
      status,
    )
  }
})

test("blocked 설정도 삭제하지 않고 generator에 남긴다", () => {
  assert.equal(
    shouldGeneratePlatformConfig(
      row({status: "blocked", config_status: "blocked", origin_country: "JP"}),
    ),
    true,
  )
})

test("custom detection은 지원되는 구체 엔진 설정으로 복원한다", () => {
  assert.equal(
    generatedPlatformType(
      row({platform_type: "custom", detection: {platform_family: "imweb"}}),
    ),
    "imweb",
  )
  assert.equal(
    generatedPlatformType(
      row({platform_type: "custom", detection: {platform_family: "sixshop"}}),
    ),
    "sixshop",
  )
  assert.equal(generatedPlatformType(row({platform_type: "custom"})), null)
  assert.equal(queuePlatformType("imweb"), "custom")
  assert.equal(queuePlatformType("sixshop"), "custom")
  assert.equal(queuePlatformType("structured"), "custom")
})
