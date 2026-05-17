/**
 * 검증 게이트 적용 헬퍼 (SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-001 / 002 / 005)
 *
 * 두 write 사이트(crawl.ts JSON write, import-products.ts DB upsert)가
 * 동일한 게이트 로직을 공유한다. 게이트는 출력을 변형하지 않는다:
 * 유효 product 는 입력 그대로 통과, 무효 product 만 결과 집합에서 제외 +
 * 구조화 reject 이벤트 emit.
 *
 * Feature flag `CRAWLER_VALIDATION_ENABLED`:
 *  - 미설정 또는 "true" (기본): 게이트 활성 (ON).
 *  - "false": 게이트 완전 우회 → 정확히 레거시 동작 (모든 product 통과,
 *    검증/이벤트 없음). 이것이 롤백 스위치다.
 */

import {validateProduct} from "./product-validator.js"
import {emit} from "./observability.js"

// @MX:NOTE: [AUTO] CRAWLER_VALIDATION_ENABLED=false is the SPEC rollback switch:
//   when OFF the gate is a transparent passthrough (legacy behavior, zero
//   validation, zero events). Only the literal string "false" disables it.

/** flag 미설정/true → 활성. "false" → 우회. */
export function isValidationEnabled(): boolean {
  const v = process.env.CRAWLER_VALIDATION_ENABLED
  if (v === undefined || v === "") return true
  return v.toLowerCase() !== "false"
}

/** reject 이벤트의 sku 식별자: productUrl 우선, 없으면 productCode. */
function skuOf(p: unknown): string {
  if (p !== null && typeof p === "object") {
    const o = p as Record<string, unknown>
    if (typeof o.productUrl === "string" && o.productUrl) return o.productUrl
    if (typeof o.productCode === "string" && o.productCode) return o.productCode
  }
  return ""
}

/**
 * product 배열에 게이트를 적용해 **유효 product 만** 동일 순서로 반환한다.
 *
 * - flag OFF: 입력 배열을 그대로 반환 (레거시 동작, 이벤트 없음).
 * - flag ON: 유효 product 는 입력 객체 참조 그대로 유지(변형 0),
 *   무효 product 는 제외 + `validation_reject` 이벤트 emit.
 *   단일 무효 레코드가 크롤/임포트를 중단시키지 않는다.
 *
 * @param products 검증 대상 (raw parsed product 배열)
 * @param site 사이트/플랫폼 키 (이벤트 site 필드)
 * @returns 유효 product 만 담긴 새 배열 (입력 변형 없음)
 */
export function applyValidationGate<T>(products: T[], site: string): T[] {
  if (!isValidationEnabled()) return products

  const accepted: T[] = []
  for (const p of products) {
    const result = validateProduct(p)
    if (result.ok) {
      accepted.push(p) // 변형 0 — 원본 참조 그대로 통과.
      continue
    }
    emit({
      kind: "validation_reject",
      site,
      sku: skuOf(p),
      failedField: result.failedField,
      rawValue: result.rawValue,
      message: result.message,
    })
  }
  return accepted
}
