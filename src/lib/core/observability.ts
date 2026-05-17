/**
 * 구조화 관측 이벤트 훅 (SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-005)
 *
 * Phase 1 스코프: 검증(validation) 이벤트만 배선한다. parse / field-extraction
 * fallback / site-error 등 광범위 계측은 Phase 1 범위 밖이며 후속 작업으로 남긴다.
 * 본 모듈은 단일 진입점 `emit()` 만 노출해, 향후 sink 교체(metrics/JSON line/
 * 외부 수집기)를 호출부 변경 없이 가능하게 한다.
 */

// @MX:NOTE: [AUTO] Single structured-event sink for the crawler. Phase 1 wires
//   only validation_success / validation_reject. Other REQ-CRAWLER-005 event
//   kinds (parse, fallback, site_error) are intentionally deferred.
// @MX:ANCHOR: [AUTO] emit() is the sole observability entry point — every
//   structured crawler event must flow through here, not ad-hoc console.log.
// @MX:REASON: REQ-CRAWLER-005 mandates a single hook so per-site parse-health
//   metrics can be derived from one consistent event stream; bypassing it
//   reintroduces the ad-hoc logging the SPEC removes.

/** 상품 검증 통과 (선택적 — 노이즈 억제를 위해 기본 미배선 가능). */
export interface ValidationSuccessEvent {
  kind: "validation_success"
  /** 사이트/플랫폼 키 (예: "uniqlo-kr", "8division"). */
  site: string
  /** 식별자 (product_url 또는 productCode). 없으면 빈 문자열. */
  sku: string
}

/** 상품 검증 실패 (REQ-CRAWLER-002 — 필수). write 차단 사유 구조화. */
export interface ValidationRejectEvent {
  kind: "validation_reject"
  /** 사이트/플랫폼 키. */
  site: string
  /** 식별자 (product_url 또는 productCode). 없으면 빈 문자열. */
  sku: string
  /** 첫 번째 실패 필드 경로 (예: "name", "gender.0"). */
  failedField: string
  /** 실패 필드의 원본 값 (직렬화된 형태, 200자 제한). */
  rawValue: string
  /** 사람이 읽을 수 있는 실패 메시지. */
  message: string
}

export type CrawlerEvent = ValidationSuccessEvent | ValidationRejectEvent

/**
 * 구조화 이벤트 단일 진입점.
 *
 * Phase 1 sink 구현: 한 줄 구조화 콘솔 출력 (ad-hoc console.log 와 구분되는
 * `[crawler-event]` 프리픽스 + JSON payload). sink 자체가 throw 해도 크롤을
 * 중단시키지 않는다 (관측은 본 흐름의 부수 효과여야 한다).
 */
export function emit(event: CrawlerEvent): void {
  try {
    if (event.kind === "validation_reject") {
      console.warn(`[crawler-event] ${JSON.stringify(event)}`)
    } else {
      console.log(`[crawler-event] ${JSON.stringify(event)}`)
    }
  } catch {
    // 관측 sink 실패는 흡수한다 — 검증 게이트/크롤 본 흐름을 멈추지 않는다.
  }
}
