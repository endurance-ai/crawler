/**
 * `product_crawl_status.platform_type = 'unknown'` 백필 계획 (순수 로직).
 *
 * 왜 필요한가 (실측 2026-07-30):
 *   `products.platform` 이 소스 키가 아니라 엔진 타입(`cafe24`/`shopify`)으로 박힌
 *   재고 상품이 5,505건(54개 브랜드) 있다. 이들은 refresh 워크리스트에 못 들어가
 *   가격·재고가 영구히 갱신되지 않는다.
 *
 *   `tools/repair-product-platforms.ts` 로는 한 건도 못 고친다 — 그 도구는 URL
 *   호스트를 기존 config 에 매핑하는데, 54개 호스트 전부 config 가 없다.
 *
 *   근본 원인은 `generate-platform-configs` 가 이들을 떨어뜨리는 데 있다.
 *   `shouldGeneratePlatformConfig` 는 통과하지만(status=imported ∈ COLLECTED),
 *   `generatedPlatformType` 이 `platform_type='unknown'` 에 null 을 돌려 탈락한다.
 *   54개 중 47개가 unknown 이다.
 *
 * 근거의 성격: `products.platform` 값은 실제로 그 상품을 긁은 엔진이 남긴 것이다
 * (cafe24 엔진이 성공했으니 cafe24 라벨이 붙었다). 추측이 아니라 실행 이력이다.
 * 그래도 한 브랜드의 상품이 두 엔진 라벨로 갈리면 판단을 보류한다.
 */

/** 백필이 지원하는 엔진 — generatedPlatformType 이 매핑할 수 있는 값만. */
const SUPPORTED = new Set(["cafe24", "shopify"])

export interface PlatformTypeBackfillInput {
  brand_node_id: number
  platform_key: string
  /** product_crawl_status 의 현재 값. */
  platform_type: string
  /** 이 브랜드 상품에 붙어 있는 products.platform 값들 (중복 포함 무관). */
  productPlatforms: string[]
  /** 참고용 — 리포트에만 쓴다. */
  inStockProducts?: number
  /** cafe24 는 카테고리 번호 없이는 리스트를 열거 못한다. */
  categoryCount?: number
}

export interface PlatformTypeBackfillChange {
  brand_node_id: number
  platform_key: string
  from: string
  to: string
  inStockProducts: number
  /** cafe24 인데 categories 가 비어 있으면 config 만 생겨도 크롤이 0건이다. */
  needsCategoryDetection: boolean
}

export interface PlatformTypeBackfillPlan {
  changes: PlatformTypeBackfillChange[]
  skipped: Array<{platform_key: string; reason: string}>
}

export function planPlatformTypeBackfill(
  rows: PlatformTypeBackfillInput[],
): PlatformTypeBackfillPlan {
  const changes: PlatformTypeBackfillChange[] = []
  const skipped: Array<{platform_key: string; reason: string}> = []

  for (const row of rows) {
    if (row.platform_type !== "unknown") {
      skipped.push({platform_key: row.platform_key, reason: `already-typed:${row.platform_type}`})
      continue
    }
    const distinct = [...new Set(row.productPlatforms.filter(Boolean))]
    if (distinct.length === 0) {
      skipped.push({platform_key: row.platform_key, reason: "no-product-evidence"})
      continue
    }
    if (distinct.length > 1) {
      // 한 브랜드가 두 엔진 라벨로 갈렸다 — 어느 쪽이 맞는지 모른다.
      skipped.push({platform_key: row.platform_key, reason: `ambiguous:${distinct.sort().join("|")}`})
      continue
    }
    const [detected] = distinct
    if (!SUPPORTED.has(detected)) {
      skipped.push({platform_key: row.platform_key, reason: `unsupported:${detected}`})
      continue
    }
    changes.push({
      brand_node_id: row.brand_node_id,
      platform_key: row.platform_key,
      from: row.platform_type,
      to: detected,
      inStockProducts: row.inStockProducts ?? 0,
      needsCategoryDetection: detected === "cafe24" && (row.categoryCount ?? 0) === 0,
    })
  }

  changes.sort((a, b) => b.inStockProducts - a.inStockProducts || a.platform_key.localeCompare(b.platform_key))
  return {changes, skipped}
}
