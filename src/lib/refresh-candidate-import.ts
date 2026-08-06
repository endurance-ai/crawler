import {resolveProductBrand} from "./brand-provenance"
import {toDbPriceFields} from "./product-pricing"
import type {Product, SiteConfig} from "./types"

export const REFRESH_FALLBACK_IMAGE_VERSION = "refresh-fallback-v1"

export function withFallbackImageSelection(product: Product): Product {
  if (product.imageSelection?.version) return product
  const images = [
    product.imageUrl,
    ...(product.images ?? []),
  ].filter((url, index, rows) => Boolean(url) && rows.indexOf(url) === index)
  if (images.length === 0) throw new Error("candidate has no image")
  return {
    ...product,
    sourceImageUrl: product.sourceImageUrl || product.imageUrl,
    imageUrl: images[0],
    images,
    imageSelection: {
      kind: "fallback",
      score: 0,
      version: REFRESH_FALLBACK_IMAGE_VERSION,
      candidateCount: images.length,
      selectedAt: new Date().toISOString(),
    },
  }
}
function productNumber(raw: string): number | null {
  try {
    const url = new URL(raw)
    const query = url.searchParams.get("product_no")
    if (query && /^\d+$/.test(query)) return Number(query)
    const rewritten = url.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)
    return rewritten ? Number(rewritten[1]) : null
  } catch {
    return null
  }
}

export function productToCandidateDbRow(
  product: Product,
  config: SiteConfig,
  brandNodeId: number,
): Record<string, unknown> {
  const selected = withFallbackImageSelection(product)
  const sourceCurrency = selected.sourceCurrency ?? config.sourceCurrency ?? "KRW"
  const prices = toDbPriceFields(selected, sourceCurrency, {requireConfirmed: true})
  if (!prices) throw new Error("candidate price is missing or invalid")
  // 성별이 **정확히 하나**가 아니면 적재하지 않는다. products.gender 는 NOT NULL
  // 계약이고, 미확인을 unisex 로 채우면 검색 RPC 가 남녀 양쪽에 노출시킨다.
  // 다중값도 `p.gender && ARRAY[p_gender,'unisex']` 에서 같은 결과를 내고,
  // migration 105 의 chk_products_gender_required 가 cardinality(gender)=1 을
  // 요구한다. 이 가드가 없으면 migration 099 가 기록한 color 사고(210회 연속
  // INSERT 실패)가 gender 로 그대로 재현된다 — 이 경로는 연구실 서버 워커다.
  if (!Array.isArray(selected.gender) || selected.gender.length !== 1) {
    throw new Error("candidate gender is missing or not a single value")
  }
  // 브랜드 확정은 import-products 와 **같은 함수**를 쓴다. 단일브랜드 자사몰은
  // 큐레이션된 config.brand 가 원본이고 DOM 추출값은 멀티브랜드 편집샵 전용
  // 폴백이다 (CLAUDE.md §18 "Brand Name Fixing"). 예전에는 selected.brand 를
  // 그대로 써서 두 적재 경로의 판정이 어긋나 있었다 — brand-provenance.ts 헤더가
  // "두 경로의 판정을 어긋나게 두지 않는다" 고 적어 둔 계약을 이 경로만 깨고 있었다.
  const brand = resolveProductBrand(selected.brand, config)
  // 빈 브랜드도 import-products 와 같이 적재하지 않는다. products.brand 는 NOT NULL
  // 이지만 빈 문자열은 제약을 통과해 버려서, "브랜드 없음" 으로 조용히 적재된다.
  if (!brand) throw new Error("candidate brand is missing")
  const now = new Date().toISOString()
  return {
    brand,
    name: selected.name,
    category: selected.category,
    price: prices.price,
    original_price: prices.original_price,
    sale_price: prices.sale_price,
    source_currency: prices.source_currency,
    source_price: prices.source_price,
    product_no: productNumber(selected.productUrl),
    image_url: selected.imageUrl,
    source_image_url: selected.sourceImageUrl ?? selected.imageUrl,
    product_url: selected.productUrl,
    in_stock: selected.inStock,
    platform: config.key,
    brand_node_id: brandNodeId,
    gender: selected.gender,
    gender_source: selected.genderSource ?? null,
    crawled_at: selected.crawledAt,
    subcategory: selected.subcategory ?? null,
    images: selected.images ?? null,
    // tags/size_info/product_code 는 import-products 와 같은 절단 규칙으로 함께
    // 싣는다. 특히 **tags 는 성별 근거다** — resolveProductGenderWithSource 가
    // evidenceText 로 tags 를 읽는데(refresh-candidates.ts 가 결의에 넘긴다),
    // 저장하지 않으면 나중에 repair:product-gender 가 그 근거를 다시 볼 수 없다.
    // 실측 2026-08-05: 이 경로로 들어온 1,673행 중 product_code 는 100%,
    // tags 는 84.3% 가 NULL 이었다.
    tags: selected.tags?.slice(0, 50) ?? null,
    size_info: selected.sizeInfo?.slice(0, 2000) ?? null,
    product_code: selected.productCode?.slice(0, 100) ?? null,
    image_selection_kind: selected.imageSelection!.kind,
    image_selection_score: selected.imageSelection!.score,
    image_selection_version: selected.imageSelection!.version,
    image_selection_candidate_count: selected.imageSelection!.candidateCount,
    image_selected_at: selected.imageSelection!.selectedAt,
    last_seen_at: now,
    updated_at: now,
  }
}
