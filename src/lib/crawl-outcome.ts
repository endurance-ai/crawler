import type {CrawlResult} from "./types"

/**
 * 크롤 결과의 두 신호를 어떻게 해석할지 — 경로마다 다르다. 그 비대칭이 이 파일의 요지다.
 *
 * | 신호 | 뜻 | 온보딩(crawl.ts) | 갱신(refresh-listing.ts) |
 * |---|---|---|---|
 * | `errors` | 크롤 자체가 실패/불완전 | 차단 | 차단 |
 * | `qualityWarnings` | 크롤은 됐으나 내용 품질이 낮음 | **차단** | **차단 안 함** |
 *
 * 온보딩은 가격/이름이 대부분 빈 상품을 적재할 이유가 없으므로 품질 실패를
 * `qc_failed` 로 본다. 갱신은 다르다 — 가격을 못 읽어도 **재고 이탈 판정은 유효**하고,
 * 리스트는 끝까지 열렸다.
 *
 * 2026-07-30 이전에는 둘이 `errors` 한 채널을 공유했다. 그 결과 갱신 경로에서
 * `price_missing_rate=100` 이 완전성 가드를 무력화해 품절 감지를 막고, 런을 failed 로
 * 만들어 성공 이력이 영구히 안 쌓였다 — 42개 소스 / 재고 6,182건이 그 상태였다.
 */
export function blockingSignals(
  result: Pick<CrawlResult, "errors" | "qualityWarnings">,
): string[] {
  return [...result.errors, ...(result.qualityWarnings ?? [])]
}
