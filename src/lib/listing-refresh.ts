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

const MAX_PRICE = 100_000_000 // 1억원 — import-products 와 동일 기준

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
 * `products.price` 는 integer 컬럼이라 소수를 그대로 쓰면 UPDATE 가 통째로 실패한다
 * (실측 2026-07-31: `invalid input syntax for type integer: "339.3"`).
 *
 * 소수를 만났을 때 반올림할지 거부할지는 **통화 변환을 거쳤는지**로 갈린다:
 *   - 변환 후 소수 → 환율 계산의 자연스러운 결과다. 반올림한다.
 *   - 변환 없음(KRW) 소수 → 파싱 오류다. ₩339.3 은 존재하지 않는다.
 *     `339,300` 의 천 단위 구분자를 소수점으로 읽은 경우가 대표적이고, 반올림하면
 *     ₩339 라는 **1000배 틀린 가격**을 쓰게 된다. 잘못된 값을 쓰느니 갱신을 건너뛴다.
 */
function sanitizePrice(v: unknown, allowFractional: boolean): number | null {
  const n = typeof v === "number" ? v : null
  if (n === null || !(n > 0) || n > MAX_PRICE) return null
  if (Number.isInteger(n)) return n
  return allowFractional ? Math.round(n) : null
}

/**
 * 크롤 상품 → DB 가격 컬럼. 통화 변환 실패(FX 테이블에 없는 통화)는 null 을 돌려
 * 호출부가 가격 갱신을 건너뛰게 한다 — 0 이나 원본 통화 값을 그대로 쓰면 안 된다.
 */
export function toPriceFields(product: Product, sourceCurrency = "KRW"): PriceFields | null {
  let priceRaw: number | null | undefined = product.price
  let originalRaw: number | null | undefined = product.originalPrice
  let saleRaw: number | null | undefined = product.salePrice

  // 상품이 자기 통화를 들고 있으면 그쪽이 우선이다. 상세 페이지에서 통화를 실제로
  // 감지했을 때만 채워지므로(`applyCafe24DetailFallbacks`), config 의 값보다 근거가 강하다.
  const currency = product.sourceCurrency ?? sourceCurrency
  const converted = currency !== "KRW"

  if (converted) {
    const conv = (v: number | null | undefined) =>
      typeof v === "number" ? convertToKrw(v, currency) : v
    const convPrice = conv(priceRaw)
    if (typeof priceRaw === "number" && convPrice === null) return null // 미지원 통화
    priceRaw = convPrice
    originalRaw = conv(originalRaw)
    saleRaw = conv(saleRaw)
  }

  const price = sanitizePrice(saleRaw, converted) ?? sanitizePrice(priceRaw, converted)
  if (price === null) return null // 가격을 못 읽으면 갱신하지 않는다 (기존 값 보존)

  return {
    price,
    original_price: sanitizePrice(originalRaw, converted) ?? sanitizePrice(priceRaw, converted),
    sale_price: sanitizePrice(saleRaw, converted),
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

    const prices = toPriceFields(product, args.sourceCurrency)

    for (const row of targets) {
      // 사라진 것으로 오인되지 않도록 대상 행의 URL 을 전부 본 것으로 표시한다.
      seen.add(row.product_url)

      const reasons: string[] = []
      const patch: RefreshPatch = {in_stock: product.inStock}
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
          row.sale_price !== prices.sale_price
        ) {
          patch.price = prices.price
          patch.original_price = prices.original_price
          patch.sale_price = prices.sale_price
        }
      }

      if (reasons.length > 0 || patch.price !== undefined) {
        // UPDATE 는 product_url 로 행을 찾으므로 크롤 URL 이 아니라 DB 에 저장된 URL 을 쓴다.
        updates.push({productUrl: row.product_url, patch, reasons})
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
      updates.push({productUrl: url, patch: {in_stock: false}, reasons: ["리스트에서 사라짐 → 품절"]})
    }
  }

  return {updates, unknownUrls, confirmedUrls, missingUrls, coverage}
}
