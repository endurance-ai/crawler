import {convertToKrw} from "./fx"
import type {PricingObservation, Product} from "./types"

export type PricingSource = PricingObservation["source"]

export interface ObservedPricing {
  price: number | null
  originalPrice: number | null
  salePrice: number | null
  sourcePrice?: number
  pricingObservation: PricingObservation
}

export interface DbPriceFields {
  price: number
  original_price: number
  sale_price: number | null
  source_price: number
  source_currency: string
}

const MAX_PRICE = 100_000_000

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 엔진이 관측한 원본 통화 가격을 공통 Product 가격 계약으로 정규화한다.
 * invalid sale pair는 세일로 세탁하지 않고 unknown으로 강등한다.
 */
export function normalizeObservedPricing(args: {
  currentPrice: number | null
  originalPrice?: number | null
  salePrice?: number | null
  state: PricingObservation["state"]
  source: PricingSource
}): ObservedPricing {
  const current = positive(args.currentPrice)
  const original = positive(args.originalPrice)
  const sale = positive(args.salePrice)
  const observation = (state: PricingObservation["state"]): PricingObservation => ({
    state,
    source: args.source,
    version: 2,
  })

  if (args.state === "sale") {
    const effective = sale ?? current
    if (effective !== null && original !== null && effective < original) {
      return {
        price: effective,
        originalPrice: original,
        salePrice: effective,
        sourcePrice: effective,
        pricingObservation: observation("sale"),
      }
    }
    return {
      price: current,
      originalPrice: original ?? current,
      salePrice: null,
      sourcePrice: current ?? undefined,
      pricingObservation: observation("unknown"),
    }
  }

  if (args.state === "regular") {
    return {
      price: current,
      originalPrice: current,
      salePrice: null,
      sourcePrice: current ?? undefined,
      pricingObservation: observation("regular"),
    }
  }

  return {
    price: current,
    originalPrice: original ?? current,
    salePrice: null,
    sourcePrice: current ?? undefined,
    pricingObservation: observation("unknown"),
  }
}

export function isConfirmedPricing(product: Pick<Product, "pricingObservation">): boolean {
  return product.pricingObservation?.version === 2 && product.pricingObservation.state !== "unknown"
}

function sanitizePrice(value: unknown, allowFractional: boolean): number | null {
  const n = typeof value === "number" ? value : null
  if (n === null || !(n > 0) || n > MAX_PRICE) return null
  if (Number.isInteger(n)) return n
  return allowFractional ? Math.round(n) : null
}

/** Product 가격을 DB의 KRW tuple + 원본 현재가로 변환한다. */
export function toDbPriceFields(
  product: Pick<Product, "price" | "originalPrice" | "salePrice" | "sourcePrice" | "sourceCurrency" | "pricingObservation">,
  fallbackCurrency = "KRW",
  options: {requireConfirmed?: boolean} = {},
): DbPriceFields | null {
  if (options.requireConfirmed && !isConfirmedPricing(product)) return null

  const currency = product.sourceCurrency ?? fallbackCurrency
  const converted = currency !== "KRW"
  let priceRaw: number | null | undefined = product.price
  let originalRaw: number | null | undefined = product.originalPrice
  let saleRaw: number | null | undefined = product.salePrice

  if (converted) {
    const conv = (value: number | null | undefined) =>
      typeof value === "number" ? convertToKrw(value, currency) : value
    const convertedPrice = conv(priceRaw)
    if (typeof priceRaw === "number" && convertedPrice === null) return null
    priceRaw = convertedPrice
    originalRaw = conv(originalRaw)
    saleRaw = conv(saleRaw)
  }

  const price = sanitizePrice(saleRaw, converted) ?? sanitizePrice(priceRaw, converted)
  if (price === null) return null
  const original = sanitizePrice(originalRaw, converted) ?? sanitizePrice(priceRaw, converted)
  if (original === null) return null
  const sale = sanitizePrice(saleRaw, converted)

  // 한 필드씩 섞여 만들어진 legacy tuple은 DB에 쓰지 않는다.
  if (sale !== null && (sale >= original || sale !== price)) return null

  const nativeCurrent = positive(product.sourcePrice) ?? positive(product.salePrice) ?? positive(product.price)
  if (nativeCurrent === null) return null

  return {
    price,
    original_price: original,
    sale_price: sale,
    source_price: nativeCurrent,
    source_currency: currency,
  }
}
