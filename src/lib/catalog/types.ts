import type {CurrencyCode, Product} from "../types"

export type ProductIdentifierKind =
  | "unknown"
  | "gtin"
  | "mpn"
  | "sku"
  | "source_item_id"
  | "model_id"
  | "product_group_id"

export type ProductIdentifierLevel = "product" | "color_variant" | "offer"
export type ProductIdentifierScope = "global" | "brand" | "platform" | "shop"

export interface ProductIdentifier {
  kind: ProductIdentifierKind
  raw: string
  normalized: string
  namespace: string
  scope: ProductIdentifierScope
  level: ProductIdentifierLevel
  provenance: string
  trust: number
}

export interface CrawledVariantOffer {
  sourceVariantKey: string
  colorRaw?: string | null
  colorKey?: string | null
  sizes?: string[]
  identifiers?: ProductIdentifier[]
  price?: number | null
  originalPrice?: number | null
  salePrice?: number | null
  sourceCurrency?: CurrencyCode
  sourcePrice?: number | null
  inStock?: boolean
  productUrl?: string
  images?: string[]
}

/** Stable boundary between any crawl engine and catalog identity resolution. */
export interface CrawledProductEnvelope {
  sourceProductKey: string
  product: Product
  identifiers: ProductIdentifier[]
  variants: CrawledVariantOffer[]
  schemaVersion: 1
}
