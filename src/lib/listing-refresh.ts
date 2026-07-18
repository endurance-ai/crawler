/**
 * 리스트-only 갱신의 순수 로직 — 가격 매핑과 변경 diff.
 *
 * `src/refresh-listing.ts` 가 쓰는 계산부를 분리해 테스트 가능하게 둔다. DB/네트워크
 * 접근은 없다.
 *
 * ⚠️ 가격 매핑(`toPriceFields`)은 `src/import-products.ts` 의 인라인 매핑과 **동일한
 * 의미**여야 한다 (price = 세일가 우선, original_price = 정가 폴백, sale_price = 세일가
 * 또는 null). 한쪽만 바꾸면 온보딩과 갱신이 같은 상품에 다른 가격을 쓰게 된다.
 * import-products 쪽은 테스트가 없어 이번에 건드리지 않았다 — 다음에 그쪽을 손볼 때
 * 이 모듈을 쓰도록 합치는 것이 맞다.
 */

import {convertToKrw} from "./fx"
import type {Product} from "./types"

/** DB products 행 중 갱신이 건드리는 컬럼만. */
export interface RefreshableRow {
  product_url: string
  price: number | null
  original_price: number | null
  sale_price: number | null
  in_stock: boolean | null
}

export type PriceFields = Pick<RefreshableRow, "price" | "original_price" | "sale_price">

/** 갱신이 DB 에 쓰는 값. in_stock 은 항상, 가격은 산출된 경우에만 포함된다. */
export type RefreshPatch = Partial<PriceFields> & {in_stock: boolean}

export interface RefreshUpdate {
  productUrl: string
  patch: RefreshPatch
  /** 사람이 읽는 변경 사유 — 요약 로그용. */
  reasons: string[]
}

export interface RefreshDiff {
  updates: RefreshUpdate[]
  /** 리스트에는 있으나 DB 에 없는 URL — 신규 상품 후보 (여기서 적재하지 않는다). */
  unknownUrls: string[]
  /** DB 에는 있으나 리스트에서 사라진 URL. */
  missingUrls: string[]
  /** DB 보유분 중 리스트에서 다시 확인된 비율 (0~1). DB 가 비면 1. */
  coverage: number
}

const MAX_PRICE = 100_000_000 // 1억원 — import-products 와 동일 기준

function sanitizePrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : null
  return n !== null && n > 0 && n <= MAX_PRICE ? n : null
}

/**
 * 크롤 상품 → DB 가격 컬럼. 통화 변환 실패(FX 테이블에 없는 통화)는 null 을 돌려
 * 호출부가 가격 갱신을 건너뛰게 한다 — 0 이나 원본 통화 값을 그대로 쓰면 안 된다.
 */
export function toPriceFields(product: Product, sourceCurrency = "KRW"): PriceFields | null {
  let priceRaw: number | null | undefined = product.price
  let originalRaw: number | null | undefined = product.originalPrice
  let saleRaw: number | null | undefined = product.salePrice

  if (sourceCurrency !== "KRW") {
    const conv = (v: number | null | undefined) =>
      typeof v === "number" ? convertToKrw(v, sourceCurrency) : v
    const convPrice = conv(priceRaw)
    if (typeof priceRaw === "number" && convPrice === null) return null // 미지원 통화
    priceRaw = convPrice
    originalRaw = conv(originalRaw)
    saleRaw = conv(saleRaw)
  }

  const price = sanitizePrice(saleRaw) ?? sanitizePrice(priceRaw)
  if (price === null) return null // 가격을 못 읽으면 갱신하지 않는다 (기존 값 보존)

  return {
    price,
    original_price: sanitizePrice(originalRaw) ?? sanitizePrice(priceRaw),
    sale_price: sanitizePrice(saleRaw),
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
  for (const row of args.existing) byUrl.set(row.product_url, row)

  const seen = new Set<string>()
  const updates: RefreshUpdate[] = []
  const unknownUrls: string[] = []

  for (const product of args.crawled) {
    const url = product.productUrl
    if (!url || seen.has(url)) continue
    seen.add(url)

    const row = byUrl.get(url)
    if (!row) {
      unknownUrls.push(url)
      continue
    }

    const reasons: string[] = []
    const patch: RefreshPatch = {in_stock: product.inStock}
    if (row.in_stock !== product.inStock) {
      reasons.push(product.inStock ? "재입고" : "품절")
    }

    const prices = toPriceFields(product, args.sourceCurrency)
    if (prices) {
      if (row.price !== prices.price) {
        reasons.push(`가격 ${row.price ?? "-"}→${prices.price}`)
      }
      if (
        row.price !== prices.price ||
        row.original_price !== prices.original_price ||
        row.sale_price !== prices.sale_price
      ) {
        patch.price = prices.price
        patch.original_price = prices.original_price
        patch.sale_price = prices.sale_price
      }
    }

    if (reasons.length > 0 || patch.price !== undefined) {
      updates.push({productUrl: url, patch, reasons})
    }
  }

  const missingUrls = args.existing.filter((r) => !seen.has(r.product_url)).map((r) => r.product_url)
  const coverage =
    args.existing.length === 0 ? 1 : (args.existing.length - missingUrls.length) / args.existing.length

  if (args.markMissingOutOfStock) {
    for (const url of missingUrls) {
      const row = byUrl.get(url)
      if (row?.in_stock === false) continue // 이미 품절 — 쓸 것 없음
      updates.push({productUrl: url, patch: {in_stock: false}, reasons: ["리스트에서 사라짐 → 품절"]})
    }
  }

  return {updates, unknownUrls, missingUrls, coverage}
}
