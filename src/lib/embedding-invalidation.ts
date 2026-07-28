/**
 * 재수집으로 대표 이미지가 실제로 바뀐 행을 찾아낸다 — 순수 판정부.
 * DB 접근/삭제는 tools/invalidate-changed-embeddings.ts.
 *
 * 배경: product_embeddings 에는 무효화 트리거도 이미지 해시도 없다.
 * kiko.ai-app/scripts/aws/embed_products.py 의 pending 판정은 순수하게
 * "product_embeddings 행이 없음" 안티조인이라, 재수집으로 images 가 바뀌어도
 * 임베딩은 조용히 stale 상태로 남는다. **행을 지우는 것이 유일한 무효화 수단**이다.
 *
 * 그렇다고 전량 삭제하면 6만 건을 다시 임베딩해야 하므로, 실제로 바뀐 것만
 * 골라야 한다. 문제는 Shopify CDN 이 같은 이미지에 매번 다른 쿼리스트링
 * (?v=1699…&width=1024)과 사이즈 접미사(_1024x1024)를 붙인다는 점이다 —
 * 정규화 없이 비교하면 "전부 바뀜"으로 나온다.
 */

/**
 * embed_products.py 의 대표 이미지 선택과 **동일한** 규칙.
 * `imgs[0] if imgs and imgs[0] else row.get("image_url")` — 빈 문자열인 첫
 * 원소를 걸러내는 부분까지 그대로 옮겨야 한다.
 */
export function representativeImage(row: {
  images?: string[] | null
  image_url?: string | null
}): string | null {
  const first = row.images?.[0]
  if (first) return first
  return row.image_url || null
}

/**
 * 같은 이미지를 가리키는 URL 들을 하나로 모은다.
 *
 * - 쿼리스트링 제거: Shopify 의 `?v=<epoch>&width=…`, zara 의 `?ts=…` 는
 *   캐시 버스터라서 값이 바뀌어도 이미지는 그대로다.
 * - Shopify 사이즈 접미사 제거: `shirt_1024x1024.jpg` / `shirt_800x.jpg` 는
 *   같은 원본의 리사이즈본이다.
 * - 호스트 소문자화 + 스킴 제거: http→https 전환이나 대소문자 차이는 변경이 아니다.
 *
 * 파싱 불가한 값은 원문을 그대로 돌려준다 (같은 쓰레기끼리는 같다고 판정돼
 * 불필요한 무효화가 안 생긴다).
 */
export function normalizeImageUrl(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    const pathname = url.pathname
      .replace(/_(\d+x\d*|x\d+)(?=\.[a-z0-9]+$)/i, "")
      // 2026-07-28 파일럿 032c 실측: 같은 상품의 각도별 파일명
      // ("32_00245-2_top.jpg" vs "32_00245-2.jpg")이 변경 비율 20% 경보를
      // 넘겨 임베딩 무효화가 자동 보류됐다. embed_products.py 는 어차피
      // images[0] 하나만 쓰므로, 어느 각도 파일이 오든 "그 상품 사진"이라는
      // 사실은 같다 — 사이즈 접미사와 같은 취급.
      .replace(/_(top|bottom|back|front|side|detail|alt|flat)(?=\.[a-z0-9]+$)/i, "")
    return `${host}${pathname}`
  } catch {
    return trimmed
  }
}

export type ImageChangeBucket =
  | "unchanged"
  | "changed"
  | "was_null_now_set"
  | "was_set_now_null"
  /** 스냅샷에 없던 id — 새로 생긴 행이라 임베딩도 없다. 할 일 없음. */
  | "new_row"
  /** 스냅샷에는 있는데 지금은 없는 id. upsert 경로는 행을 지우지 않으므로 드물다. */
  | "missing_row"

export interface ImageSnapshotRow {
  id: number
  images?: string[] | null
  image_url?: string | null
}

export interface ImageChangeDecision {
  id: number
  bucket: ImageChangeBucket
  before: string | null
  after: string | null
}

export interface ImageChangeSummary {
  total: number
  byBucket: Record<ImageChangeBucket, number>
  /** 임베딩을 지워야 하는 id — changed 와 was_null_now_set 만. */
  invalidateIds: number[]
  samples: ImageChangeDecision[]
}

/**
 * was_set_now_null 은 무효화 대상이 아니다: 대표 이미지가 사라진 행은 새로
 * 임베딩할 원본이 없으므로, 기존 임베딩을 지우면 검색에서 그냥 사라진다.
 * 옛 벡터라도 있는 편이 낫다 — 지우는 판단은 사람이 따로 해야 한다.
 */
const INVALIDATING: ReadonlySet<ImageChangeBucket> = new Set<ImageChangeBucket>([
  "changed",
  "was_null_now_set",
])

export function diffImageSnapshots(
  before: readonly ImageSnapshotRow[],
  after: readonly ImageSnapshotRow[],
  options: {sampleLimit?: number} = {},
): ImageChangeSummary {
  const sampleLimit = options.sampleLimit ?? 20
  const beforeById = new Map(before.map((row) => [row.id, row]))
  const afterById = new Map(after.map((row) => [row.id, row]))

  const byBucket: Record<ImageChangeBucket, number> = {
    unchanged: 0,
    changed: 0,
    was_null_now_set: 0,
    was_set_now_null: 0,
    new_row: 0,
    missing_row: 0,
  }
  const invalidateIds: number[] = []
  const samples: ImageChangeDecision[] = []

  const record = (decision: ImageChangeDecision): void => {
    byBucket[decision.bucket] += 1
    if (INVALIDATING.has(decision.bucket)) invalidateIds.push(decision.id)
    if (decision.bucket === "changed" && samples.length < sampleLimit) samples.push(decision)
  }

  for (const afterRow of after) {
    const beforeRow = beforeById.get(afterRow.id)
    const afterImage = normalizeImageUrl(representativeImage(afterRow))
    if (!beforeRow) {
      record({id: afterRow.id, bucket: "new_row", before: null, after: afterImage})
      continue
    }
    const beforeImage = normalizeImageUrl(representativeImage(beforeRow))
    if (beforeImage === afterImage) {
      record({id: afterRow.id, bucket: "unchanged", before: beforeImage, after: afterImage})
    } else if (!beforeImage) {
      record({id: afterRow.id, bucket: "was_null_now_set", before: null, after: afterImage})
    } else if (!afterImage) {
      record({id: afterRow.id, bucket: "was_set_now_null", before: beforeImage, after: null})
    } else {
      record({id: afterRow.id, bucket: "changed", before: beforeImage, after: afterImage})
    }
  }

  for (const beforeRow of before) {
    if (afterById.has(beforeRow.id)) continue
    record({
      id: beforeRow.id,
      bucket: "missing_row",
      before: normalizeImageUrl(representativeImage(beforeRow)),
      after: null,
    })
  }

  return {total: after.length, byBucket, invalidateIds, samples}
}

/**
 * 변경 비율이 이 값을 넘으면 정규화가 CDN 패턴 하나를 놓쳤을 가능성이 훨씬 크다
 * — 상품 사진 20%가 한 번에 재촬영되는 일은 없다. 자동 적용을 막고 사람이 본다.
 */
export const CHANGE_RATIO_ALERT = 0.2

export function changeRatio(summary: ImageChangeSummary): number {
  if (summary.total === 0) return 0
  return summary.invalidateIds.length / summary.total
}
