/**
 * 리스트-only 갱신의 순수 로직 — 가격 매핑과 변경 diff.
 *
 * `src/refresh-listing.ts` 가 쓰는 계산부를 분리해 테스트 가능하게 둔다. DB/네트워크
 * 접근은 없다.
 *
 * 가격 매핑은 `product-pricing.ts` 하나를 import와 refresh가 함께 쓴다. 온보딩과
 * 갱신에서 price/original_price/sale_price 의미가 갈라지지 않게 하는 경계다.
 */

import {toDbPriceFields} from "./product-pricing"
import type {Product} from "./types"

/** DB products 행 중 갱신이 건드리는 컬럼만. */
export interface RefreshableRow {
  id: string
  product_url: string
  updated_at: string
  crawled_at?: string | null
  price: number | null
  original_price: number | null
  sale_price: number | null
  source_price?: number | null
  source_currency?: string | null
  in_stock: boolean | null
  last_seen_at?: string | null
}

export type PriceFields = Pick<RefreshableRow, "price" | "original_price" | "sale_price">
export type RefreshPriceFields = PriceFields & {source_price: number; source_currency: string}

/** 갱신이 DB 에 쓰는 값. in_stock 은 항상, 가격은 산출된 경우에만 포함된다. */
export type RefreshPatch = Partial<RefreshPriceFields> & {in_stock: boolean}

export interface RefreshUpdate {
  id: string
  productUrl: string
  expectedUpdatedAt: string
  observedAt: string
  patch: RefreshPatch
  /** 사람이 읽는 변경 사유 — 요약 로그용. */
  reasons: string[]
}

export interface RefreshDiff {
  updates: RefreshUpdate[]
  /** 리스트에는 있으나 DB 에 없는 URL — 신규 상품 후보 (여기서 적재하지 않는다). */
  unknownUrls: string[]
  /**
   * 이번 리스트에서 살아있음이 확인된 DB URL — 값이 안 바뀐 것까지 포함한다.
   *
   * `updates` 는 **변경된 행만** 담으므로 생존 신호로 쓸 수 없다. `last_seen_at`
   * 을 올릴 대상은 이쪽이다 (`missingUrls` 의 정확한 여집합).
   */
  confirmedUrls: string[]
  /** DB 에는 있으나 리스트에서 사라진 URL. */
  missingUrls: string[]
  /** DB 보유분 중 리스트에서 다시 확인된 비율 (0~1). DB 가 비면 1. */
  coverage: number
}

/** Coverage accumulated across resumable slices in one source cycle. */
export function refreshCycleCoverage(
  existing: RefreshableRow[],
  confirmedUrls: string[],
  cycleStartedAt: string,
): number {
  if (existing.length === 0) return 1
  const confirmed = new Set(confirmedUrls)
  const started = Date.parse(cycleStartedAt)
  const seen = existing.filter((row) => {
    if (confirmed.has(row.product_url)) return true
    if (!row.last_seen_at) return false
    const lastSeen = Date.parse(row.last_seen_at)
    return !Number.isNaN(lastSeen) && !Number.isNaN(started) && lastSeen >= started
  }).length
  return seen / existing.length
}

/**
 * URL 이 달라져도 같은 상품임을 알아보는 보조 키.
 *
 * 카테고리 번호가 URL 에 박히는 플랫폼이 많은데, 카테고리 자동탐색이 런마다 다른
 * 경로를 고를 수 있어 같은 상품이 다른 URL 로 나온다. 상품 정체성은 경로가 아니라
 * `idx`(imweb) / `product_no`(cafe24) 다.
 *
 * 실측 2026-07-19 (첫 운영 갱신 런):
 *   imweb   differentis: DB `/66/?idx=402` vs 재크롤 `/wwwdifferentiskr/?idx=402`
 *   cafe24  themysterioushotel: 같은 상품이 `/category/50/` 과 다른 카테고리로 갈림
 *
 * cafe24 는 두 형식을 쓴다 — 쿼리형(`detail.html?product_no=63781&cate_no=218`) 과
 * rewrite 형(`/product/{슬러그}/{product_no}/category/{cate_no}/display/1/`). 후자를
 * 놓치면 대형 카탈로그가 통째로 미매칭돼 멀쩡한 상품이 품절 처리된다 (실측:
 * themysterioushotel 101건 오탐). 슬러그는 상품명이라 바뀔 수 있으므로 숫자 ID 만 쓴다.
 *
 * 정확 URL 매칭이 실패했을 때만 폴백으로 쓴다 — 오매칭을 막기 위해 호스트까지 포함한다.
 */
export function productIdentityKey(url: string): string | null {
  let host: string
  let pathname: string
  let query: URLSearchParams
  try {
    const parsed = new URL(url)
    host = parsed.host
    pathname = parsed.pathname
    query = parsed.searchParams
  } catch {
    return null
  }
  const idx = query.get("idx")
  if (idx) return `${host}#idx=${idx}`
  const productNo = query.get("product_no")
  if (productNo) return `${host}#product_no=${productNo}`
  // cafe24 rewrite: /product/{슬러그}/{product_no}/... — 쿼리형과 같은 네임스페이스에
  // 넣어 한 사이트가 두 형식을 섞어 써도 통합된다.
  const rewritten = pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)
  if (rewritten) return `${host}#product_no=${rewritten[1]}`
  return null
}

/**
 * 크롤 상품 → DB 가격 컬럼. 통화 변환 실패(FX 테이블에 없는 통화)는 null 을 돌려
 * 호출부가 가격 갱신을 건너뛰게 한다 — 0 이나 원본 통화 값을 그대로 쓰면 안 된다.
 */
export function toPriceFields(product: Product, sourceCurrency = "KRW"): PriceFields | null {
  const fields = toDbPriceFields(product, sourceCurrency)
  if (!fields) return null
  return {
    price: fields.price,
    original_price: fields.original_price,
    sale_price: fields.sale_price,
  }
}

/**
 * Refresh-specific price inference.
 *
 * A Cafe24 listing frequently exposes one current selling price without enough
 * markup to prove whether it is regular or discounted. Existing products
 * already have a confirmed baseline, so visiting every detail page merely to
 * rediscover that baseline is wasteful. Confirmed observations still win; an
 * unknown single price is compared with the stored baseline instead.
 */
export function toRefreshPriceFields(
  product: Product,
  existing: Pick<RefreshableRow, "price" | "original_price">,
  sourceCurrency = "KRW",
): RefreshPriceFields | null {
  const confirmed = toDbPriceFields(product, sourceCurrency, {requireConfirmed: true})
  if (confirmed) return confirmed

  const current = toDbPriceFields(product, sourceCurrency)
  if (!current) return null

  const baseline =
    typeof existing.original_price === "number" && existing.original_price > 0
      ? existing.original_price
      : typeof existing.price === "number" && existing.price > 0
        ? existing.price
        : current.price

  if (current.price < baseline) {
    return {
      ...current,
      price: current.price,
      original_price: baseline,
      sale_price: current.price,
    }
  }

  // Equal means a sale ended. Greater means the storefront raised its regular
  // price. In both cases the current selling price becomes the new baseline.
  return {
    ...current,
    price: current.price,
    original_price: current.price,
    sale_price: null,
  }
}

/**
 * 크롤 결과와 DB 현황을 비교해 실제로 바뀐 것만 추린다.
 *
 * `markMissingOutOfStock` 는 호출부가 완전성 가드를 통과시킨 경우에만 true 로 준다 —
 * 부분 실패한 크롤에서 사라진 상품을 품절 처리하면 멀쩡한 상품이 대량으로 숨는다.
 */
export function diffListing(args: {
  crawled: Product[]
  existing: RefreshableRow[]
  sourceCurrency?: string
  markMissingOutOfStock: boolean
}): RefreshDiff {
  const byUrl = new Map<string, RefreshableRow>()
  // 같은 상품이 카테고리별 URL 로 여러 행 적재돼 있는 경우가 흔하다 (실측
  // themysterioushotel: 409행 = 상품 103개, 평균 4배). 이들은 같은 상품이므로
  // 하나가 리스트에서 확인되면 전부 함께 갱신해야 한다 — 한 행만 고치면 나머지가
  // "사라진 상품" 으로 보여 품절 처리된다 (실측 오탐 101건).
  const byIdentity = new Map<string, RefreshableRow[]>()
  for (const row of args.existing) {
    byUrl.set(row.product_url, row)
    const key = productIdentityKey(row.product_url)
    if (!key) continue
    const bucket = byIdentity.get(key)
    if (bucket) bucket.push(row)
    else byIdentity.set(key, [row])
  }

  const seen = new Set<string>()
  const updates: RefreshUpdate[] = []
  const unknownUrls: string[] = []

  for (const product of args.crawled) {
    const url = product.productUrl
    if (!url || seen.has(url)) continue
    seen.add(url)

    // 상품 식별자가 같은 DB 행 전부가 대상이다 (같은 상품의 카테고리별 중복 적재).
    // 식별자를 못 뽑는 URL 은 정확 매칭만 시도한다.
    const key = productIdentityKey(url)
    const targets = (key && byIdentity.get(key)) || (byUrl.has(url) ? [byUrl.get(url)!] : [])
    if (targets.length === 0) {
      unknownUrls.push(url)
      continue
    }

    for (const row of targets) {
      // 사라진 것으로 오인되지 않도록 대상 행의 URL 을 전부 본 것으로 표시한다.
      seen.add(row.product_url)

      const reasons: string[] = []
      const observedAt = product.detailFetchedAt ?? product.crawledAt
      const observedMs = Date.parse(observedAt)
      const storedMs = Math.max(
        row.crawled_at ? Date.parse(row.crawled_at) : Number.NEGATIVE_INFINITY,
        row.last_seen_at ? Date.parse(row.last_seen_at) : Number.NEGATIVE_INFINITY,
      )
      // Never let a delayed listing snapshot overwrite a more recent detail/listing write.
      if (!Number.isFinite(observedMs) || observedMs < storedMs) continue
      const patch: RefreshPatch = {in_stock: product.inStock}
      const prices = toRefreshPriceFields(product, row, args.sourceCurrency)
      if (row.in_stock !== product.inStock) {
        reasons.push(product.inStock ? "재입고" : "품절")
      }

      if (prices) {
        if (row.price !== prices.price) {
          reasons.push(`가격 ${row.price ?? "-"}→${prices.price}`)
        }
        if (
          row.price !== prices.price ||
          row.original_price !== prices.original_price ||
          row.sale_price !== prices.sale_price ||
          row.source_price !== prices.source_price ||
          row.source_currency !== prices.source_currency
        ) {
          patch.price = prices.price
          patch.original_price = prices.original_price
          patch.sale_price = prices.sale_price
          patch.source_price = prices.source_price
          patch.source_currency = prices.source_currency
        }
      }

      if (reasons.length > 0 || patch.price !== undefined) {
        // UPDATE 는 product_url 로 행을 찾으므로 크롤 URL 이 아니라 DB 에 저장된 URL 을 쓴다.
        updates.push({id: row.id, productUrl: row.product_url,
          expectedUpdatedAt: row.updated_at, observedAt, patch, reasons})
      }
    }
  }

  const missingUrls: string[] = []
  const confirmedUrls: string[] = []
  for (const row of args.existing) {
    if (seen.has(row.product_url)) confirmedUrls.push(row.product_url)
    else missingUrls.push(row.product_url)
  }
  const coverage =
    args.existing.length === 0 ? 1 : (args.existing.length - missingUrls.length) / args.existing.length

  if (args.markMissingOutOfStock) {
    for (const url of missingUrls) {
      const row = byUrl.get(url)
      if (row?.in_stock === false) continue // 이미 품절 — 쓸 것 없음
      updates.push({id: row!.id, productUrl: url, expectedUpdatedAt: row!.updated_at,
        observedAt: new Date().toISOString(), patch: {in_stock: false}, reasons: ["리스트에서 사라짐 → 품절"]})
    }
  }

  return {updates, unknownUrls, confirmedUrls, missingUrls, coverage}
}
