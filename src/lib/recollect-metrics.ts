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
 * 색상/서브카테고리 판정은 write-path 와 **같은** 분류기를 쓴다
 * (classifyColorRepair / classifySubcategoryRepair). 여기서 자체 정규식을
 * 만들면 게이트와 실제 적재 결과가 어긋나므로 절대 하지 않는다.
 */

import {classifyColorRepair, type ProductColorRow} from "./color-repair"
import {classifySubcategoryRepair, type ProductSubcategoryRow} from "./subcategory-repair"
import {CATEGORIES} from "./enums/product-enums"
import {COLOR_CANONICAL_NAMES} from "./product-qc/normalization"

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
  color: string | null
  description: string | null
  tags: string[] | null
  gender: string[] | null
  gender_source: string | null
  images: string[] | null
  image_url: string | null
  in_stock: boolean | null
  updated_at: string | null
}

export interface RecollectMetrics {
  rows: number
  inStock: number
  outOfStock: number

  /** color 가 비어 있는 행 — import 단계에서 조용히 드랍된다. */
  colorMissing: number
  /**
   * **캠페인 KPI.** COLOR_CANONICAL_NAMES 에 없는 값을 가진 행 수.
   * 다중값("Black, Coffee Bean")은 한 조각이라도 벗어나면 비canonical로 센다.
   *
   * 주의: 이걸 classifyColorRepair 로 재면 안 된다. normalizeColorField 의
   * 마지막 분기가 title-case passthrough(reason=null)라서, "Coffee Bean" 같은
   * 값은 이미 title-case 이므로 repair 분류기가 "unchanged" 로 판정한다.
   * 실제로 browns 11,455행은 repair 기준으로 0건이지만 canonical 기준으로는
   * 11,443건이 벗어나 있다 — 지표를 잘못 고르면 캠페인의 성공 판정이 통째로
   * 무력화된다.
   */
  colorNonCanonical: number
  /**
   * 기존 repair 스크립트(pnpm repair:product-color)가 손댈 수 있는 행 수.
   * colorNonCanonical 과 다른 질문에 답한다 — "재수집 말고 repair 로도 고쳐지나".
   */
  colorRepairable: number
  /** 근거를 못 찾아 손댈 수 없는 color — 재수집으로도 안 고쳐질 가능성이 큰 잔여물. */
  colorUnresolved: number
  /** "Black, White" 같은 다중값. 검색 RPC 의 정확 일치 필터에 절대 안 걸린다. */
  colorMultiValue: number

  subcategoryMissing: number
  subcategoryNonCanonical: number

  /** taxonomy(CATEGORIES) 밖의 category. */
  categoryInvalid: number

  /** gender 가 빈 배열 — import 단계에서 드랍된다. */
  genderMissing: number
  genderSourceCounts: Record<string, number>

  /** 대표 이미지가 없는 행 (images[0] 도 image_url 도 없음). */
  imageMissing: number
  /** images 배열 자체가 비어있는 행 — payload 스키마 회귀 트립와이어. */
  imagesEmpty: number

  distinctBrands: number
  descriptionMissing: number
}

const CATEGORY_SET = new Set<string>(CATEGORIES)
const CANONICAL_COLOR_SET = new Set(COLOR_CANONICAL_NAMES.map((name) => name.toLowerCase()))

function isMultiValueColor(color: string | null): boolean {
  return typeof color === "string" && color.includes(",")
}

/**
 * COLOR_CANONICAL_NAMES 순수 멤버십 판정. 다중값은 모든 조각이 canonical 이어야
 * canonical 로 친다 — 검색 RPC 는 `UPPER(p.color) = UPPER(p_color_family)` 로
 * 정확 일치를 보므로 "Black, White" 는 어느 필터에도 안 걸린다.
 */
export function isCanonicalColor(color: string | null): boolean {
  if (typeof color !== "string") return false
  const parts = color.split(",").map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return false
  return parts.every((part) => CANONICAL_COLOR_SET.has(part.toLowerCase()))
}

export function computeRecollectMetrics(rows: readonly MetricsRow[]): RecollectMetrics {
  const brands = new Set<string>()
  const genderSourceCounts: Record<string, number> = {}
  const metrics: RecollectMetrics = {
    rows: rows.length,
    inStock: 0,
    outOfStock: 0,
    colorMissing: 0,
    colorNonCanonical: 0,
    colorRepairable: 0,
    colorUnresolved: 0,
    colorMultiValue: 0,
    subcategoryMissing: 0,
    subcategoryNonCanonical: 0,
    categoryInvalid: 0,
    genderMissing: 0,
    genderSourceCounts,
    imageMissing: 0,
    imagesEmpty: 0,
    distinctBrands: 0,
    descriptionMissing: 0,
  }

  for (const row of rows) {
    if (row.in_stock === false) metrics.outOfStock += 1
    else metrics.inStock += 1

    if (row.brand) brands.add(row.brand)
    if (!row.description) metrics.descriptionMissing += 1

    // ── color ──
    const color = typeof row.color === "string" ? row.color.trim() : ""
    if (!color) metrics.colorMissing += 1
    else if (!isCanonicalColor(row.color)) metrics.colorNonCanonical += 1
    if (isMultiValueColor(row.color)) metrics.colorMultiValue += 1
    const colorRow: ProductColorRow = {
      id: row.id,
      color: row.color,
      name: row.name,
      description: row.description,
      subcategory: row.subcategory,
      tags: row.tags,
      product_url: row.product_url,
      platform: row.platform,
      brand: row.brand,
      brand_node_id: row.brand_node_id,
    }
    const colorDecision = classifyColorRepair(colorRow)
    if (colorDecision.bucket !== "unchanged") metrics.colorRepairable += 1
    if (colorDecision.bucket === "unresolved_kept") metrics.colorUnresolved += 1

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

    // ── category / gender / image ──
    if (!row.category || !CATEGORY_SET.has(row.category)) metrics.categoryInvalid += 1
    if (!row.gender || row.gender.length === 0) metrics.genderMissing += 1
    const source = row.gender_source ?? "unknown"
    genderSourceCounts[source] = (genderSourceCounts[source] ?? 0) + 1

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
  /** color 없는 행 비율 상한 (import 에서 드랍됨). */
  maxColorMissingRatio: number
  /** gender 없는 행 비율 상한 (import 에서 드랍됨). */
  maxGenderMissingRatio: number
  /** distinct brand 가 기존 대비 이 비율 미만이면 중단. */
  minBrandRatio: number
  /** taxonomy 밖 category 비율 상한. */
  maxCategoryInvalidRatio: number
}

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  minRowRatio: 0.6,
  maxColorMissingRatio: 0.2,
  maxGenderMissingRatio: 0.1,
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

  const colorMissingRatio = ratio(after.colorMissing, after.rows)
  if (colorMissingRatio > thresholds.maxColorMissingRatio) {
    failures.push({
      check: "color_missing",
      detail: `color 없는 행 ${after.colorMissing}/${after.rows} (${pct(colorMissingRatio)}) > 상한 ${pct(thresholds.maxColorMissingRatio)} — import 에서 전량 드랍된다`,
    })
  }

  const genderMissingRatio = ratio(after.genderMissing, after.rows)
  if (genderMissingRatio > thresholds.maxGenderMissingRatio) {
    failures.push({
      check: "gender_missing",
      detail: `gender 없는 행 ${after.genderMissing}/${after.rows} (${pct(genderMissingRatio)}) > 상한 ${pct(thresholds.maxGenderMissingRatio)} — import 에서 드랍된다`,
    })
  }

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

    // 캠페인의 존재 이유가 이 숫자를 낮추는 것이다. 안 낮아지면 적재할 이유가 없다.
    const beforeColorRatio = ratio(before.colorNonCanonical, before.rows)
    const afterColorRatio = ratio(after.colorNonCanonical, after.rows)
    if (afterColorRatio >= beforeColorRatio && before.colorNonCanonical > 0) {
      failures.push({
        check: "color_not_improved",
        detail: `비canonical color 비율 ${pct(beforeColorRatio)} → ${pct(afterColorRatio)} — 개선 없음, 적재할 이유가 없다`,
      })
    }
  }

  return {pass: failures.length === 0, failures}
}
