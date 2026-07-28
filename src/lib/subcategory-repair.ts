/**
 * 이미 적재된 products 행의 subcategory 를 재판정한다.
 *
 * 배경: import-products.ts 는 products.subcategory 를 사이트 breadcrumb/카테고리
 * 텍스트 그대로 저장했다 (검증 없음 — QC 게이트가 subcategory 를 정규화하기
 * 시작한 건 이 리페어와 같은 시점부터다). 그 결과 "midi skirt"/"midi skirts"/
 * "mini check skirt"/"mini skirt"/"mini skirts"/"miniskirts" 처럼 canonical
 * "skirt" 하나로 수렴해야 할 값이 사이트마다 제각각 문자열로 흩어져 있다.
 *
 * 이 모듈은 I/O 가 없는 순수 분류기다 — DB 접근과 쓰기는
 * src/repair-product-subcategory.ts 가 담당한다. 판정은 write-path 와 **같은**
 * resolveSubcategory 를 쓴다 (정규식 중복 0, gender-repair.ts 와 동일한 설계).
 */

import {isValidCategory, type Category} from "./enums/product-enums"
import {resolveSubcategory} from "./subcategory-classifier"

/** products 에서 재판정에 필요한 컬럼만. */
export interface ProductSubcategoryRow {
  id: number
  category: string | null
  subcategory: string | null
  name: string | null
  product_url: string
  platform: string | null
  brand: string | null
  brand_node_id: number | null
}

export type SubcategoryRepairBucket =
  | "canonicalized"
  | "text_fallback"
  | "dropped_noncanonical"
  | "dropped_no_category"
  | "unchanged"

export interface SubcategoryRepairDecision {
  id: number
  product_url: string
  platform: string
  brand: string | null
  brand_node_id: number | null
  bucket: SubcategoryRepairBucket
  before: string | null
  /** null = subcategory 를 건드리지 않는다 (unchanged). */
  after: string | null
  reason: string | null
}

export interface SubcategoryRepairBucketCounts {
  canonicalized: number
  text_fallback: number
  dropped_noncanonical: number
  dropped_no_category: number
  unchanged: number
}

export interface SubcategoryRepairSummary {
  total: number
  byBucket: SubcategoryRepairBucketCounts
  byPlatform: Array<{platform: string; total: number; counts: SubcategoryRepairBucketCounts}>
  samples: Partial<Record<SubcategoryRepairBucket, SubcategoryRepairDecision[]>>
  /** 실제 DB 쓰기가 필요한 결정 (after 가 저장값과 다름). */
  writable: number
}

export function emptyBucketCounts(): SubcategoryRepairBucketCounts {
  return {
    canonicalized: 0,
    text_fallback: 0,
    dropped_noncanonical: 0,
    dropped_no_category: 0,
    unchanged: 0,
  }
}

function normalizedBefore(raw: string | null): string | null {
  return raw && raw.trim() ? raw.trim() : null
}

/**
 * 한 행을 재판정한다.
 *
 * `row.category` 는 이미 QC 게이트를 거쳐 canonical 이어야 정상이지만(마이그레이션
 * 이전 레거시 행은 아닐 수 있음), 방어적으로 다시 isValidCategory 체크한다 —
 * 유효하지 않으면 subcategory 판정 근거가 없는 것으로 취급한다(no_category).
 */
export function classifySubcategoryRepair(row: ProductSubcategoryRow): SubcategoryRepairDecision {
  const category: Category | null = row.category && isValidCategory(row.category) ? row.category : null
  const resolved = resolveSubcategory(row.subcategory, category, row.name ?? "")

  const before = normalizedBefore(row.subcategory)
  const after = resolved.value

  const base = {
    id: row.id,
    product_url: row.product_url,
    platform: row.platform ?? "",
    brand: row.brand,
    brand_node_id: row.brand_node_id,
    before,
  }

  if (after === before) {
    return {...base, bucket: "unchanged", after: null, reason: null}
  }

  const bucket: SubcategoryRepairBucket =
    resolved.reason === "canonicalized"
      ? "canonicalized"
      : resolved.reason === "text_fallback"
        ? "text_fallback"
        : resolved.reason === "no_category"
          ? "dropped_no_category"
          : "dropped_noncanonical"

  return {...base, bucket, after, reason: resolved.reason}
}

export function summarizeSubcategoryRepair(decisions: SubcategoryRepairDecision[]): SubcategoryRepairSummary {
  const byBucket = emptyBucketCounts()
  const platforms = new Map<string, {total: number; counts: SubcategoryRepairBucketCounts}>()
  const samples: Partial<Record<SubcategoryRepairBucket, SubcategoryRepairDecision[]>> = {}
  let writable = 0

  for (const d of decisions) {
    byBucket[d.bucket] += 1
    if (d.bucket !== "unchanged") writable += 1

    const p = platforms.get(d.platform) ?? {total: 0, counts: emptyBucketCounts()}
    p.total += 1
    p.counts[d.bucket] += 1
    platforms.set(d.platform, p)

    const bucketSamples = (samples[d.bucket] ??= [])
    if (bucketSamples.length < 10) bucketSamples.push(d)
  }

  return {
    total: decisions.length,
    byBucket,
    byPlatform: [...platforms.entries()].map(([platform, v]) => ({platform, ...v})).sort((a, b) => b.total - a.total),
    samples,
    writable,
  }
}
