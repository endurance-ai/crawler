/**
 * product_features 의 VLM(비전 모델) 색상을 재수집 보강의 1순위 color
 * 소스로 쓴다.
 *
 * 배경 (2026-07-28, 재수집 캠페인 배치 2 중 발견): product_features 는 이미
 * 상품 이미지를 실제로 보는 VLM(Qwen3-VL)이 feature_metadata.primary_color
 * 로 색상을 뽑아 두고 있다. 어휘가 정확히 검색 RPC 가 필터링에 쓰는 16개
 * COLOR_FAMILIES(BLACK/BLUE/GREY/...)와 같아서, 여기서 가져온 값은 항상
 * canonical 이고 항상 검색에 걸린다 — 우리 텍스트 전용 LLM 보강
 * (llm-product-enrichment.ts)이 DOM/breadcrumb 텍스트만 보고 색상을
 * "추측"하는 것과 달리, 실제 이미지 기반 판단이라 신뢰도도 더 높다.
 * 커버리지 실측(2026-07-28): 26개 코호트 키 대부분 70~100%, mohawk-general
 * 만 예외적으로 0% — 커버리지가 없는 상품은 기존 텍스트 LLM 추측으로
 * 폴백한다 (enrich-products-file.ts 가 그 폴백을 담당).
 *
 * 트레이드오프: VLM 값은 16개 coarse family 뿐이라 "Charcoal"/"Cognac"
 * 같은 세부 색상명은 못 준다. 재수집 캠페인은 검색 필터링이 실제로
 * 동작하는 것을 우선했다 — products.color 의 세부성보다.
 */

import type {SupabaseClient} from "@supabase/supabase-js"

const PAGE_SIZE = 1000

/** COLOR_FAMILIES 값("BLACK")을 크롤러 관례인 Title Case("Black")로 맞춘다. */
export function titleCaseColorFamily(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
}

export interface VlmColorRow {
  product_url: string
  primary_color: string | null
}

/**
 * 주어진 platform 의 상품들에 대해 product_url → canonical color(Title Case)
 * 매핑을 만든다. products.product_url 로 조인하므로, 재수집 대상(이미 DB에
 * 존재하는 product_url)만 매칭되고 완전 신규 상품은 자연히 빈 채로 남는다
 * (신규 상품은 product_features 자체가 아직 없다 — 별도 배치가 채운다).
 */
export async function fetchVlmColorsByPlatform(
  db: SupabaseClient,
  platform: string,
): Promise<Map<string, string>> {
  const colorByUrl = new Map<string, string>()
  let cursor = 0
  for (;;) {
    const {data, error} = await db
      .from("products")
      .select("id,product_url,product_features(feature_metadata)")
      .eq("platform", platform)
      .gt("id", cursor)
      .order("id", {ascending: true})
      .limit(PAGE_SIZE)
    if (error) throw new Error(`product_features 조회 실패: ${error.message}`)
    // PostgREST 는 product_features 를 products.id 기준 1:0..1 관계로 임베드해
    // 실제로는 단일 객체를 돌려주지만(직접 확인함), supabase-js 의 제네릭
    // 타입 추론은 임베드 리소스를 배열로 가정한다 — 런타임 형태와 타입
    // 추론이 갈리므로 unknown 을 거쳐 두 형태(배열/객체) 모두 방어적으로 처리한다.
    type FeatureRow = {feature_metadata: Record<string, unknown> | null}
    const rows = (data ?? []) as unknown as Array<{
      id: number
      product_url: string
      product_features: FeatureRow | FeatureRow[] | null
    }>
    for (const row of rows) {
      const feature = Array.isArray(row.product_features)
        ? row.product_features[0]
        : row.product_features
      const primaryColor = feature?.feature_metadata?.primary_color
      if (typeof primaryColor === "string" && primaryColor.trim()) {
        colorByUrl.set(row.product_url, titleCaseColorFamily(primaryColor))
      }
    }
    if (rows.length < PAGE_SIZE) break
    cursor = rows[rows.length - 1]!.id
  }
  return colorByUrl
}
