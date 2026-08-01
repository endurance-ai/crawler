import test from "node:test"
import assert from "node:assert/strict"

import {isBlockingEnabled, shouldBlockRequest} from "../src/lib/request-blocking"

test("콘텐츠에 기여하지 않는 리소스 타입을 막는다", () => {
  for (const type of ["image", "media", "font", "stylesheet"]) {
    assert.equal(shouldBlockRequest("https://shop.example.com/a", type), true, type)
  }
})

test("문서·스크립트·XHR 은 막지 않는다", () => {
  // cafe24 테마는 상품 목록 일부를 앱 스크립트로 그린다. 스크립트를 전면
  // 차단하면 상품 수가 조용히 줄어든다 — 타입이 아니라 호스트로만 막는다.
  for (const type of ["document", "script", "xhr", "fetch"]) {
    assert.equal(shouldBlockRequest("https://shop.example.com/a", type), false, type)
  }
})

test("분석·광고 호스트는 스크립트여도 막는다", () => {
  // 실측(2026-08-01) newrim 리스트 페이지에서 실제로 조회되던 것들.
  const blocked = [
    "https://wcs.naver.net/wcslog.js",
    "https://wcs.naver.com/b?t=pv",
    "https://nam.veta.naver.com/onepick",
    "https://connect.facebook.net/en_US/fbevents.js",
    "https://ca-log.cafe24data.com/log",
    "https://www.googletagmanager.com/gtm.js",
    "https://www.google-analytics.com/collect",
  ]
  for (const url of blocked) {
    assert.equal(shouldBlockRequest(url, "script"), true, url)
  }
})

test("cafe24 앱 호스트는 막지 않는다 — 콘텐츠를 그릴 수 있다", () => {
  // ca-log.cafe24data.com(순수 로그)과 달리 앱 호스트는 렌더링에 관여할 여지가
  // 있어 의도적으로 목록에서 뺐다. 이 구분이 무너지면 상품이 사라진다.
  assert.equal(shouldBlockRequest("https://app4you.cafe24.com/widget.js", "script"), false)
  assert.equal(shouldBlockRequest("https://calendar-app.cafe24.com/a.js", "script"), false)
})

test("자기 도메인 스크립트는 통과한다", () => {
  assert.equal(shouldBlockRequest("https://newrim.co.kr/theme/list.js", "script"), false)
})

test("경로까지 봐야 하는 패턴을 처리한다 (facebook.com/tr)", () => {
  assert.equal(shouldBlockRequest("https://www.facebook.com/tr?id=1", "script"), true)
  assert.equal(shouldBlockRequest("https://www.facebook.com/shop", "document"), false)
})

test("URL 파싱 실패는 차단하지 않는다 (fail-open)", () => {
  // 판정 불가일 때 막으면 정상 요청을 잃는다. 모호하면 통과시킨다.
  assert.equal(shouldBlockRequest("not-a-url", "script"), false)
})

test("CRAWLER_REQUEST_BLOCKING=off 로 전체 비활성화된다", () => {
  assert.equal(isBlockingEnabled({} as NodeJS.ProcessEnv), true)
  assert.equal(isBlockingEnabled({CRAWLER_REQUEST_BLOCKING: "off"} as NodeJS.ProcessEnv), false)
  assert.equal(isBlockingEnabled({CRAWLER_REQUEST_BLOCKING: "OFF"} as NodeJS.ProcessEnv), false)
  assert.equal(isBlockingEnabled({CRAWLER_REQUEST_BLOCKING: "on"} as NodeJS.ProcessEnv), true)
})
