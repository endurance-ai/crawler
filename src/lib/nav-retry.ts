/**
 * 내비게이션 재시도 — 일시적 DNS/네트워크 실패를 흡수한다.
 *
 * 왜 필요한가 (실측 2026-08-02, 연구실 배치 서버):
 *   `no_products` 로 가드가 걸린 13개 소스가 전부 사이트 문제가 아니었다.
 *     · curl 로는 같은 URL 이 1.07초에 200 / 165KB 로 온다
 *     · Playwright `page.goto` 만 60초 타임아웃
 *     · 실패가 간헐적이다 — treemingbird 1534 → 1432 → **0**,
 *       blackpurple 818 → 818 → 818 → **0**
 *   호스트 DNS 실측: 60개 도메인 중 완전 실패 7 + 1초 초과 5 (=20%).
 *   `systemd-resolved` 캐시 크기 19개, 히트율 15.7%(82,396/524,000).
 *   외부 리졸버는 전부 막혀 있다(1.1.1.1:53 refused, 8.8.8.8:53 timeout,
 *   DoH 2곳 타임아웃) — 상류 ISP 리졸버 2개에만 의존한다.
 *
 * 즉 실패는 영구적이지 않고 **한 번 더 두드리면 대개 붙는다**. 타임아웃을 더
 * 늘리는 것(이미 60초다)보다 재시도가 맞는 레버다.
 *
 * 호스트 DNS 자체를 고치는 것(로컬 캐싱 리졸버)이 근본 해결이지만 공용 장비라
 * 별건이다. 이 모듈은 그때까지의 완충이 아니라, 배치가 남의 네트워크 위에서
 * 도는 한 계속 필요한 방어다.
 */

/**
 * 재시도까지 소진하고 실패한 내비게이션. 호출자가 "이 소스는 지금 접속 자체가
 * 안 된다"를 판정해 남은 카테고리의 재시도를 끄는 데 쓴다 — 실측 2026-08-02
 * funfromfun 은 3회 × 60초를 전부 태우고도 실패했다. 지속 실패에 재시도를 붙이면
 * 소스당 3분을 버린다.
 */
export class NavFailureError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message)
    this.name = "NavFailureError"
  }
}

export interface NavigablePage {
  goto: (
    url: string,
    options: {waitUntil: "domcontentloaded"; timeout: number},
  ) => Promise<unknown>
}

export interface NavRetryOptions {
  /** 총 시도 횟수 (기본 3 — 최초 1회 + 재시도 2회). */
  attempts?: number
  /** 시도당 타임아웃 ms (기본 60초 — 종전 값 유지). */
  timeoutMs?: number
  /** 재시도 전 대기 ms. 기본은 1.5초 → 4초. */
  backoffMs?: (attempt: number) => number
  /** 테스트에서 실제로 기다리지 않도록 주입한다. */
  sleep?: (ms: number) => Promise<void>
  /** 재시도할 때마다 호출된다(로그용). */
  onRetry?: (attempt: number, error: string) => void
}

export interface NavResult {
  ok: boolean
  /** 실제로 시도한 횟수. 성공했다면 몇 번째에 붙었는지가 된다. */
  attempts: number
  /** 마지막 실패 사유. ok 면 null. */
  error: string | null
}

const DEFAULT_BACKOFF_MS = [1_500, 4_000]

export async function gotoWithRetry(
  page: NavigablePage,
  url: string,
  options: NavRetryOptions = {},
): Promise<NavResult> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const timeout = options.timeoutMs ?? 60_000
  const backoff =
    options.backoffMs ??
    ((attempt: number) => DEFAULT_BACKOFF_MS[attempt - 1] ?? DEFAULT_BACKOFF_MS.at(-1) ?? 4_000)
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  let lastError = "unknown"
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(url, {waitUntil: "domcontentloaded", timeout})
      return {ok: true, attempts: attempt, error: null}
    } catch (err) {
      lastError = err instanceof Error ? err.message.split("\n")[0] : String(err)
      if (attempt < attempts) {
        options.onRetry?.(attempt, lastError)
        await sleep(backoff(attempt))
      }
    }
  }
  return {ok: false, attempts, error: lastError}
}
