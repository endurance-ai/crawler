/**
 * 이미 적재된 products.color 의 raw 노이즈를 canonical 값으로 교정한다.
 *
 * 배경: normalizeColorField (product-qc/normalization.ts) 는 크롤/import 시점에
 * COLOR_RULES 로 canonicalize 하지만, 이 게이트가 없던 시절 적재된 legacy 행과
 * COLOR_RULES 에 아직 없는 색상명이 title-case passthrough 로 남아 22,000여개의
 * distinct raw 값을 만들었다 (subcategory 와 같은 종류의 legacy 백필 문제).
 *
 * products.color 는 NOT NULL 제약(migration 091)이라 gender/subcategory 리페어와
 * 달리 **절대 null 로 쓰지 않는다** — normalizeColorField 가 needsReview=true 로
 * 판정한(근거 없음) 행은 손대지 않고 원래 값을 그대로 둔다.
 *
 * 이 모듈은 I/O 가 없는 순수 분류기다 — DB 접근과 쓰기는
 * src/repair-product-color.ts 가 담당한다. 판정은 write-path 와 **같은**
 * normalizeColorField 를 쓴다 (정규식 중복 0, gender/subcategory repair 와 동일 설계).
 */

import {normalizeColorField} from "./product-qc/normalization"

/** products 에서 재판정에 필요한 컬럼만. */
export interface ProductColorRow {
  id: number
  color: string | null
  name: string | null
  description: string | null
  subcategory: string | null
  tags: string[] | null
  product_url: string
  platform: string | null
  brand: string | null
  brand_node_id: number | null
}

export type ColorRepairBucket =
  | "canonicalized"
  | "text_fallback"
  | "recased"
  | "unresolved_kept"
  | "unchanged"

export interface ColorRepairDecision {
  id: number
  product_url: string
  platform: string
  brand: string | null
  brand_node_id: number | null
  bucket: ColorRepairBucket
  before: string
  /** null = color 를 건드리지 않는다 (unchanged / unresolved_kept — NOT NULL 이라 null 을 쓸 수 없다). */
  after: string | null
  reason: string | null
}

export interface ColorRepairBucketCounts {
  canonicalized: number
  text_fallback: number
  recased: number
  unresolved_kept: number
  unchanged: number
}

export interface ColorRepairSummary {
  total: number
  byBucket: ColorRepairBucketCounts
  byPlatform: Array<{platform: string; total: number; counts: ColorRepairBucketCounts}>
  samples: Partial<Record<ColorRepairBucket, ColorRepairDecision[]>>
  /** 실제 DB 쓰기가 필요한 결정. */
  writable: number
}

export function emptyBucketCounts(): ColorRepairBucketCounts {
  return {canonicalized: 0, text_fallback: 0, recased: 0, unresolved_kept: 0, unchanged: 0}
}

/**
 * 한 행을 재판정한다.
 *
 * needsReview=true(근거 없음: color_missing / color_non_color_unresolved) 는
 * NOT NULL 제약상 null 로 못 쓰므로 항상 unresolved_kept — 원래 값 유지.
 */
export function classifyColorRepair(row: ProductColorRow): ColorRepairDecision {
  const before = typeof row.color === "string" ? row.color : ""
  const result = normalizeColorField({
    name: row.name ?? "",
    color: row.color,
    description: row.description,
    subcategory: row.subcategory,
    tags: row.tags,
  })

  const base = {
    id: row.id,
    product_url: row.product_url,
    platform: row.platform ?? "",
    brand: row.brand,
    brand_node_id: row.brand_node_id,
    before,
  }

  if (result.needsReview || result.value === null) {
    return {...base, bucket: "unresolved_kept", after: null, reason: result.reason}
  }

  if (result.value === before) {
    return {...base, bucket: "unchanged", after: null, reason: null}
  }

  const bucket: ColorRepairBucket =
    result.reason === "color_canonicalized"
      ? "canonicalized"
      : result.reason === "color_missing_text_fallback" || result.reason === "color_noise_text_fallback"
        ? "text_fallback"
        : "recased"

  return {...base, bucket, after: result.value, reason: result.reason}
}

export function summarizeColorRepair(decisions: ColorRepairDecision[]): ColorRepairSummary {
  const byBucket = emptyBucketCounts()
  const platforms = new Map<string, {total: number; counts: ColorRepairBucketCounts}>()
  const samples: Partial<Record<ColorRepairBucket, ColorRepairDecision[]>> = {}
  let writable = 0

  for (const d of decisions) {
    byBucket[d.bucket] += 1
    if (d.after !== null) writable += 1

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
