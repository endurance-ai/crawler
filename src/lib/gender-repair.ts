/**
 * 이미 적재된 products 행의 성별을 재판정한다.
 *
 * 배경: 2026-07-30 ~ 2026-08-03 사이, 성별 출처가 VLM(product_features) 으로
 * 이관돼 있던 동안 적재된 행은 products.gender 가 NULL 이다. VLM gender 성능이
 * 나오지 않아 크롤러로 회귀했으므로, 그 구간 행을 재크롤 없이 DB 텍스트만으로
 * 되채운다. migration 091 의 brand_scope 백필(13,942행)과 ['unisex'] 세탁 흔적도
 * 같은 규칙으로 재판정된다.
 *
 * 검색 RPC 는 `p.gender && ARRAY[p_gender,'unisex']` 라 unisex 를 남녀 양쪽에
 * 노출하므로, 근거 없는 행을 unisex 로 채우면 안 된다 — 못 뽑으면 건드리지 않고
 * unverified 로 표시한다.
 *
 * 이 모듈은 I/O 가 없는 순수 분류기다 — DB 접근과 쓰기는
 * src/repair-product-gender.ts 가 담당한다. 판정은 write-path 와 **같은**
 * resolveProductGenderWithSource 를 쓴다 (정규식 중복 0).
 */

import {
  cleanGenderScope,
  isKidsText,
  resolveProductGenderWithSource,
  type GenderSource,
  type ProductGender,
} from "./product-gender"

/** products 에서 재판정에 필요한 컬럼만. */
export interface ProductGenderRow {
  id: number
  gender: string[] | null
  gender_source: string | null
  name: string | null
  category: string | null
  subcategory: string | null
  description: string | null
  product_url: string
  tags: string[] | null
  platform: string | null
  brand: string | null
  brand_node_id: number | null
  last_seen_at: string | null
}

export type GenderRepairBucket =
  | "confirmed_men"
  | "confirmed_women"
  | "confirmed_unisex"
  | "kids"
  | "unverified"
  | "unchanged"

export interface GenderRepairDecision {
  id: number
  product_url: string
  platform: string
  brand: string | null
  brand_node_id: number | null
  bucket: GenderRepairBucket
  before: string[]
  /** null = gender 를 건드리지 않는다 (kids / unverified / unchanged). */
  after: string[] | null
  gender_source: GenderSource | null
  /** 판정 근거 — dry-run 샘플 출력과 계획 파일에 남는다. */
  evidence: string
  /** URL 신호와 텍스트 신호가 어긋난 경우. */
  conflict?: {url: ProductGender; text: ProductGender}
}

export interface GenderRepairBucketCounts {
  confirmed_men: number
  confirmed_women: number
  confirmed_unisex: number
  kids: number
  unverified: number
  unchanged: number
}

export interface GenderRepairSummary {
  total: number
  byBucket: GenderRepairBucketCounts
  byPlatform: Array<{platform: string; total: number; counts: GenderRepairBucketCounts}>
  byBrandNode: Array<{brand_node_id: number | null; brand: string; total: number; counts: GenderRepairBucketCounts}>
  samples: Partial<Record<GenderRepairBucket, GenderRepairDecision[]>>
  conflicts: GenderRepairDecision[]
  /** 실제 DB 쓰기가 필요한 결정 (after !== null). */
  writable: number
}

export function emptyBucketCounts(): GenderRepairBucketCounts {
  return {
    confirmed_men: 0,
    confirmed_women: 0,
    confirmed_unisex: 0,
    kids: 0,
    unverified: 0,
    unchanged: 0,
  }
}

function sameGender(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function evidenceOf(row: ProductGenderRow, source: GenderSource | null): string {
  if (source === "url" || source === "repair_url") return row.product_url
  // tags 도 inferGenderFromText 의 입력이므로 감사 시 실제 판정 근거가 name/
  // category/subcategory 에 없어 보이는 혼란(예: "mens" 태그만 있는 상품)을
  // 막기 위해 표시한다.
  return [row.name, row.category, row.subcategory, row.tags?.join(",")].filter(Boolean).join(" | ").slice(0, 160)
}

/**
 * 한 행을 재판정한다.
 *
 * 저장된 `row.gender` 는 **근거로 쓰지 않는다** — 그 값이 바로 불신 대상이므로
 * resolveProductGenderWithSource 에 productGender 를 빈 배열로 넘긴다.
 *
 * `useDescription` 기본값이 false 인 이유: products.description 은 마케팅/사이즈표
 * 2000자 slice 라 "여성 사이즈 참고" 같은 문구가 유니섹스 상품을 대량 오판시킨다.
 * write-path 는 재크롤로 재검증 가능하지만 일회성 mass UPDATE 는 그렇지 않다.
 */
export function classifyGenderRepair(
  row: ProductGenderRow,
  opts: {
    useDescription?: boolean
    siteDefaultGender?: string[]
    verifiedUnisexDefault?: boolean
  } = {},
): GenderRepairDecision {
  const before = cleanGenderScope(row.gender)

  let resolved = resolveProductGenderWithSource([], {
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    description: row.description,
    tags: row.tags,
    productUrl: row.product_url,
    useDescription: opts.useDescription ?? false,
  })

  // 사이트 전역 기본값(SiteConfig.defaultGender + gender-defaults.ts)을 write-path
  // 와 동일하게 최후 폴백으로 적용한다. 이게 없으면 URL·상품명에 성별 신호가 없는
  // 하우스브랜드 자사몰이 전부 unverified 로 남는다 (실측: DB 텍스트만으로는
  // 6,780행 중 280행만 해결).
  //
  // conflict(URL↔텍스트 불일치)일 때는 폴백하지 않는다 — 두 근거가 싸우는 상황에서
  // 사이트 기본값을 밀어넣는 것은 판정이 아니라 추측이다.
  const siteDefault = cleanGenderScope(opts.siteDefaultGender)
  if (resolved.gender.length === 0 && !resolved.conflict && siteDefault.length > 0 && !isKidsRow(row)) {
    resolved = resolveProductGenderWithSource(siteDefault, {}, "config_default", {
      verifiedUnisexDefault: opts.verifiedUnisexDefault,
    })
  }

  const base = {
    id: row.id,
    product_url: row.product_url,
    platform: row.platform ?? "",
    brand: row.brand,
    brand_node_id: row.brand_node_id,
    before,
    conflict: resolved.conflict,
  }

  // 근거를 찾지 못함. gender 는 건드리지 않고 출처만 표시해 "셀 수 있는" 상태로
  // 만든다 — 재크롤 대상이자, 끝내 갱신되지 않으면 삭제 후보다.
  if (resolved.gender.length === 0) {
    const kids = isKidsRow(row)
    return {
      ...base,
      bucket: kids ? "kids" : "unverified",
      after: null,
      gender_source: "unverified_legacy",
      evidence: evidenceOf(row, null),
    }
  }

  // 재판정 결과가 저장값과 같다 — 쓸 필요 없이 출처만 확정된다.
  if (sameGender(before, resolved.gender)) {
    return {
      ...base,
      bucket: "unchanged",
      after: null,
      gender_source: repairSourceOf(resolved.source),
      evidence: evidenceOf(row, resolved.source),
    }
  }

  const bucket: GenderRepairBucket =
    resolved.gender[0] === "men"
      ? "confirmed_men"
      : resolved.gender[0] === "women"
        ? "confirmed_women"
        : "confirmed_unisex"

  return {
    ...base,
    bucket,
    after: resolved.gender,
    gender_source: repairSourceOf(resolved.source),
    evidence: evidenceOf(row, resolved.source),
  }
}

function repairSourceOf(source: GenderSource | null): GenderSource | null {
  if (source === "url") return "repair_url"
  if (source === "text") return "repair_text"
  // config_default 는 repair_* 변종을 만들지 않는다 — migration 095 의
  // products_gender_source_chk allow-list 에 없는 값을 쓰면 INSERT 가 거부된다.
  return source
}

/**
 * 미확인 사유가 아동복이었는지 (버킷 라벨용). resolveProductGenderWithSource 는
 * "kids 가드 발동"과 "신호 없음"을 모두 {gender: [], source: null} 로 내므로
 * 여기서 다시 확인한다.
 */
function isKidsRow(row: ProductGenderRow): boolean {
  const blob = [row.name, row.category, row.subcategory].filter(Boolean).join(" ")
  return isKidsText(blob) || isKidsText(row.product_url)
}

export function summarizeGenderRepair(decisions: GenderRepairDecision[]): GenderRepairSummary {
  const byBucket = emptyBucketCounts()
  const platforms = new Map<string, {total: number; counts: GenderRepairBucketCounts}>()
  const brands = new Map<string, {brand_node_id: number | null; brand: string; total: number; counts: GenderRepairBucketCounts}>()
  const samples: Partial<Record<GenderRepairBucket, GenderRepairDecision[]>> = {}
  const conflicts: GenderRepairDecision[] = []
  let writable = 0

  for (const d of decisions) {
    byBucket[d.bucket] += 1
    if (d.after !== null) writable += 1

    const p = platforms.get(d.platform) ?? {total: 0, counts: emptyBucketCounts()}
    p.total += 1
    p.counts[d.bucket] += 1
    platforms.set(d.platform, p)

    const bKey = String(d.brand_node_id ?? `~${d.brand ?? ""}`)
    const b = brands.get(bKey) ?? {brand_node_id: d.brand_node_id, brand: d.brand ?? "(unknown)", total: 0, counts: emptyBucketCounts()}
    b.total += 1
    b.counts[d.bucket] += 1
    brands.set(bKey, b)

    const bucketSamples = (samples[d.bucket] ??= [])
    if (bucketSamples.length < 10) bucketSamples.push(d)

    if (d.conflict && conflicts.length < 50) conflicts.push(d)
  }

  return {
    total: decisions.length,
    byBucket,
    byPlatform: [...platforms.entries()]
      .map(([platform, v]) => ({platform, ...v}))
      .sort((a, b) => b.total - a.total),
    byBrandNode: [...brands.values()].sort((a, b) => b.total - a.total),
    samples,
    conflicts,
    writable,
  }
}
