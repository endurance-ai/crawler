import type {PricingObservation} from "./types"

interface CrawlerPricingFields {
  originalPrice?: unknown
  salePrice?: unknown
  sourcePrice?: unknown
  pricingObservation?: unknown
}

interface PocPricingFields {
  original_price?: unknown
  sale_price?: unknown
  source_price?: unknown
  pricing_observation?: unknown
}

const PRICING_STATES = new Set<PricingObservation["state"]>(["sale", "regular", "unknown"])
const PRICING_SOURCES = new Set<PricingObservation["source"]>(["variant", "api", "listing", "detail"])

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function pricingObservation(value: unknown): PricingObservation | undefined {
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Partial<PricingObservation>
  if (
    candidate.version !== 2
    || !PRICING_STATES.has(candidate.state as PricingObservation["state"])
    || !PRICING_SOURCES.has(candidate.source as PricingObservation["source"])
  ) return undefined
  return {
    state: candidate.state as PricingObservation["state"],
    source: candidate.source as PricingObservation["source"],
    version: 2,
  }
}

/** Preserve the crawler's complete price tuple and its observation provenance. */
export function pricingFieldsToPoc(product: CrawlerPricingFields): {
  original_price: number | null
  sale_price: number | null
  source_price: number | null
  pricing_observation?: PricingObservation
} {
  const observation = pricingObservation(product.pricingObservation)
  return {
    original_price: nullableNumber(product.originalPrice),
    sale_price: nullableNumber(product.salePrice),
    source_price: nullableNumber(product.sourcePrice),
    ...(observation ? {pricing_observation: observation} : {}),
  }
}

/** Restore crawler pricing without inferring regular/sale state in finalize. */
export function pricingFieldsFromPoc(row: PocPricingFields): {
  originalPrice: number | null
  salePrice: number | null
  sourcePrice?: number
  pricingObservation?: PricingObservation
} {
  const sourcePrice = nullableNumber(row.source_price)
  const observation = pricingObservation(row.pricing_observation)
  return {
    originalPrice: nullableNumber(row.original_price),
    salePrice: nullableNumber(row.sale_price),
    ...(sourcePrice !== null ? {sourcePrice} : {}),
    ...(observation ? {pricingObservation: observation} : {}),
  }
}
