/**
 * 규칙 기반 텍스트 매칭 공용 헬퍼.
 *
 * product-qc/normalization.ts 의 private 구현을 그대로 옮긴 것으로, color /
 * category / gender 세 도메인이 동일한 매칭 규약을 공유하기 위한 leaf 모듈이다
 * (import 0개 — product-gender.ts 가 이 파일에 의존해도 순환이 생기지 않는다).
 */

export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/**
 * `patterns` 는 raw / NFKD-정규화 두 형태 모두에 시도하고, `contains` 는 raw
 * 에만 시도한다 — normalizeForMatch 의 NFKD 가 한글을 자모로 분해하므로 조합형
 * 한글 토큰("여성", "남녀공용")은 raw 에서만 매치되기 때문이다.
 */
export function matchesAny(text: string, patterns: RegExp[], contains?: string[]): boolean {
  const stripped = normalizeForMatch(text)
  if (patterns.some((re) => re.test(text) || re.test(stripped))) return true
  return (contains ?? []).some((needle) => text.includes(needle))
}
