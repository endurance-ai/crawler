/**
 * 재수집 캠페인의 품질 지표 — 순수 계산부.
 * CLI/DB 접근은 tools/recollect-metrics.ts.
 *
 * 목적은 두 가지다:
 *   1. **import 전 게이트**. products 의 upsert 는 되돌릴 수 없으므로, 적재하기
 *      전에 크롤+보강 산출물이 기존 DB 상태보다 나은지 파일 단계에서 판정한다.
 *   2. before/after 비교. 캠페인이 실제로 무엇을 고쳤는지(혹은 망가뜨렸는지)를
 *      브랜드별로 남긴다.
 *
 * subcategory 판정은 write-path 와 **같은** 분류기를 쓴다
 * (classifySubcategoryRepair). 여기서 자체 정규식을 만들면 게이트와 실제
 * 적재 결과가 어긋나므로 절대 하지 않는다.
 *
 * color/gender 는 더 이상 크롤러가 만들지 않는다(2026-07-29 VLM 이관) — 그 두
 * 필드에 대한 KPI/게이트는 이 모듈에서 제거됐다.
 */

import {classifySubcategoryRepair, type ProductSubcategoryRow} from "./subcategory-repair"
import {CATEGORIES} from "./enums/product-enums"

/** 파일(Product)과 DB(row) 양쪽을 같은 모양으로 맞춘 입력. */
export interface MetricsRow {
  id: number
  product_url: string
  platform: string | null
  brand: string | null
  brand_node_id: number | null
  name: string | null
  category: string | null
  subcategory: string | null
  tags: string[] | null
  images: string[] | null
  image_url: string | null
  in_stock: boolean | null
  updated_at: string | null
}

export interface RecollectMetrics {
  rows: number
  inStock: number
  outOfStock: number

  subcategoryMissing: number
  subcategoryNonCanonical: number

  /** taxonomy(CATEGORIES) 밖의 category. */
  categoryInvalid: number

  /** 대표 이미지가 없는 행 (images[0] 도 image_url 도 없음). */
  imageMissing: number
  /** images 배열 자체가 비어있는 행 — payload 스키마 회귀 트립와이어. */
  imagesEmpty: number

  distinctBrands: number
}

const CATEGORY_SET = new Set<string>(CATEGORIES)

export function computeRecollectMetrics(rows: readonly MetricsRow[]): RecollectMetrics {
  const brands = new Set<string>()
  const metrics: RecollectMetrics = {
    rows: rows.length,
    inStock: 0,
    outOfStock: 0,
    subcategoryMissing: 0,
    subcategoryNonCanonical: 0,
    categoryInvalid: 0,
    imageMissing: 0,
    imagesEmpty: 0,
    distinctBrands: 0,
  }

  for (const row of rows) {
    if (row.in_stock === false) metrics.outOfStock += 1
    else metrics.inStock += 1

    if (row.brand) brands.add(row.brand)

    // ── subcategory ──
    if (!row.subcategory) metrics.subcategoryMissing += 1
    const subcategoryRow: ProductSubcategoryRow = {
      id: row.id,
      category: row.category,
      subcategory: row.subcategory,
      name: row.name,
      product_url: row.product_url,
      platform: row.platform,
      brand: row.brand,
      brand_node_id: row.brand_node_id,
    }
    const subDecision = classifySubcategoryRepair(subcategoryRow)
    if (subDecision.bucket !== "unchanged") metrics.subcategoryNonCanonical += 1

    // ── category / image ──
    if (!row.category || !CATEGORY_SET.has(row.category)) metrics.categoryInvalid += 1

    const representative = row.images?.[0] || row.image_url
    if (!representative) metrics.imageMissing += 1
    if (!row.images || row.images.length === 0) metrics.imagesEmpty += 1
  }

  metrics.distinctBrands = brands.size
  return metrics
}

// ─── 게이트 ──────────────────────────────────────────

export interface GateThresholds {
  /** 크롤 행수가 기존 대비 이 비율 미만이면 중단. */
  minRowRatio: number
  /** distinct brand 가 기존 대비 이 비율 미만이면 중단. */
  minBrandRatio: number
  /** taxonomy 밖 category 비율 상한. */
  maxCategoryInvalidRatio: number
}

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  minRowRatio: 0.6,
  minBrandRatio: 0.9,
  maxCategoryInvalidRatio: 0.05,
}

export interface GateFailure {
  check: string
  detail: string
}

export interface GateResult {
  pass: boolean
  failures: GateFailure[]
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`

/**
 * import 전 차단 게이트. 이 시점을 넘기면 upsert 는 되돌릴 수 없다.
 *
 * `before` 가 없으면(신규 브랜드) 비교 기반 검사는 건너뛰고 절대값 검사만 한다.
 */
export function evaluateGate(
  after: RecollectMetrics,
  before: RecollectMetrics | null,
  thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS,
): GateResult {
  const failures: GateFailure[] = []

  const categoryInvalidRatio = ratio(after.categoryInvalid, after.rows)
  if (categoryInvalidRatio > thresholds.maxCategoryInvalidRatio) {
    failures.push({
      check: "category_invalid",
      detail: `taxonomy 밖 category ${after.categoryInvalid}/${after.rows} (${pct(categoryInvalidRatio)}) > 상한 ${pct(thresholds.maxCategoryInvalidRatio)}`,
    })
  }

  if (before && before.rows > 0) {
    const rowRatio = ratio(after.rows, before.rows)
    if (rowRatio < thresholds.minRowRatio) {
      failures.push({
        check: "row_count",
        detail: `크롤 ${after.rows}행 / 기존 ${before.rows}행 (${pct(rowRatio)}) < 하한 ${pct(thresholds.minRowRatio)} — 부분 실패 의심`,
      })
    }

    const brandRatio = ratio(after.distinctBrands, before.distinctBrands)
    if (before.distinctBrands > 0 && brandRatio < thresholds.minBrandRatio) {
      failures.push({
        check: "distinct_brands",
        detail: `브랜드 ${after.distinctBrands}개 / 기존 ${before.distinctBrands}개 (${pct(brandRatio)}) < 하한 ${pct(thresholds.minBrandRatio)} — 브랜드 추출 회귀 의심`,
      })
    }
  }

  return {pass: failures.length === 0, failures}
}
