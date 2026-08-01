/**
 * 크롤에 불필요한 요청을 차단한다. 목적은 대역폭이 아니라 **DNS 부하**다.
 *
 * 왜 필요한가 (실측 2026-08-01, 연구실 배치 서버):
 *   리스트 페이지 1개를 열 때 조회되는 고유 호스트명이 17개인데 그 중 자기
 *   도메인은 1개뿐이었다(newrim 기준). 나머지 16개는 구글 폰트·네이버 애널리틱스·
 *   페이스북 픽셀·리뷰 위젯 등 크롤에 전혀 쓰이지 않는 것들이다.
 *
 *   이 낭비가 배치를 무너뜨렸다. 동시성 8 에서 런 성공률이 74% 로 떨어졌고
 *   (동시성 4 는 98%), 실패 17건 중 11건이 **이전에 잘 되던 소스**였다. 증상은
 *   전부 네트워크였다 — no categories discovered / fetch failed /
 *   robots.txt fetch failed. 같은 시각 호스트에서:
 *
 *     배치 정지 시   DNS 실패 0/60   (병렬 16 에서도)
 *     배치 가동 시   DNS 실패 29/60  (병렬 1 에서도)
 *     UdpNoPorts 94,693 — 응답이 5초 타임아웃 뒤에야 도착한 횟수
 *
 *   즉 상류 리졸버가 질의량을 감당 못 해 지연이 타임아웃을 넘긴 것이다. 캐시는
 *   정상이었다(배치를 멈추면 항목이 그대로 유지됨) — 소스마다 도메인이 달라
 *   재사용될 일이 없었을 뿐이다. 그래서 캐시를 키우는 것보다 **질의 자체를 줄이는
 *   것**이 유효한 레버다.
 *
 * 종전 방식과 무엇이 다른가:
 *   기존에는 `**\/*.{png,jpg,css,woff,...}` 확장자 글롭으로 막았다. 확장자가 없거나
 *   `.js` 인 추적 스크립트는 전부 통과했고, 위 16개가 정확히 그것들이다.
 *
 * 안전 원칙 — 상품 렌더링을 깨뜨리지 않는다:
 *   · 리소스 타입 차단은 DOM 구조에 영향이 없는 것만 (image/media/font/stylesheet).
 *     상품 데이터는 셀렉터로 DOM 에서 뽑으므로 스타일·이미지가 없어도 무관하다.
 *   · 스크립트는 **전면 차단하지 않는다.** cafe24 테마는 상품 목록 일부를 앱
 *     스크립트로 그리기도 한다. 명백한 분석·광고 호스트만 이름으로 막는다.
 *   · `app4you.cafe24.com` / `calendar-app.cafe24.com` 같은 cafe24 앱 호스트는
 *     의도적으로 목록에 넣지 않았다 — 콘텐츠를 그릴 여지가 있다.
 *
 * 되돌리기: `CRAWLER_REQUEST_BLOCKING=off` 로 전체 비활성화.
 */

/** 콘텐츠에 기여하지 않는 리소스 타입. */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"])

/**
 * 분석·광고·픽셀 호스트. 부분 문자열로 매칭한다(서브도메인 변형 대응).
 * 상품 렌더링에 관여할 수 있는 호스트는 넣지 않는다 — §안전 원칙 참조.
 */
const BLOCKED_HOST_PATTERNS = [
  // Google
  "google-analytics.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "googleadservices.com",
  "doubleclick.net",
  // Meta
  "connect.facebook.net",
  "facebook.com/tr",
  // Naver (국내 쇼핑몰에 거의 항상 붙는다)
  "wcs.naver.net",
  "wcs.naver.com",
  "veta.naver.com",
  // Cafe24 로깅 (앱 호스트와 구분된다 — 이건 순수 로그 수집)
  "ca-log.cafe24data.com",
  // 기타 추적·히트맵
  "criteo.",
  "taboola.com",
  "hotjar.com",
  "clarity.ms",
  "mixpanel.com",
  "amplitude.com",
  "segment.io",
  "sentry.io",
]

export function isBlockingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CRAWLER_REQUEST_BLOCKING ?? "").toLowerCase() !== "off"
}

/**
 * 이 요청을 차단해야 하는가.
 *
 * 순수 함수로 분리해 둔 이유는 테스트 때문이다 — Playwright 라우트 핸들러를
 * 통째로 돌리지 않고 판정 규칙만 고정할 수 있다.
 */
export function shouldBlockRequest(url: string, resourceType: string): boolean {
  if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return true
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  const haystack = `${host}${safePath(url)}`
  return BLOCKED_HOST_PATTERNS.some((pattern) => haystack.includes(pattern))
}

/** `facebook.com/tr` 처럼 경로까지 봐야 하는 패턴이 있어 경로를 붙인다. */
function safePath(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return ""
  }
}

interface RoutableContext {
  route: (
    pattern: string,
    handler: (route: {
      abort: () => unknown
      continue: () => unknown
      request: () => {url: () => string; resourceType: () => string}
    }) => unknown,
  ) => Promise<unknown>
}

/**
 * 브라우저 컨텍스트에 차단 규칙을 건다. 페이지를 만들기 **전에** 호출해야 한다.
 */
export async function installRequestBlocking(context: RoutableContext): Promise<void> {
  if (!isBlockingEnabled()) return
  await context.route("**/*", (route) => {
    const request = route.request()
    if (shouldBlockRequest(request.url(), request.resourceType())) {
      route.abort()
      return
    }
    route.continue()
  })
}
