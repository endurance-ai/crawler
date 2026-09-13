import type {Product} from "./types"

type CoreHandledProductKey =
  | "name"
  | "category"
  | "gender"
  | "genderSource"
  | "tags"
  | "price"
  | "originalPrice"
  | "salePrice"
  | "pricingObservation"
  | "imageUrl"
  | "productUrl"
  | "inStock"
  | "platform"
  | "subcategory"
  | "images"
  | "sourceCurrency"
  | "sourcePrice"

type MetadataProductKey = Exclude<keyof Product, CoreHandledProductKey>

/**
 * This nested object carries crawler fields that onboarding does not transform.
 * Keeping the key set derived from Product makes newly-added Product fields fail
 * typecheck here instead of being silently dropped by the POC boundary.
 */
export type PocCrawlerMetadata = Partial<Pick<Product, MetadataProductKey>>

export interface PocCrawlerMetadataFields {
  crawler_metadata?: unknown
}

const METADATA_KEYS = [
  "brand",
  "priceFormatted",
  "sourceImageUrl",
  "crawledAt",
  "detailFetchedAt",
  "material",
  "imageCollectionVersion",
  "imageSelection",
  "sizeInfo",
  "productCode",
  "identifiers",
  "variants",
  "llmEnrichedAt",
  "llmModel",
  "llmInputHash",
  "normalization",
  "reviewCount",
  "reviews",
  "reviewCollection",
] as const satisfies readonly MetadataProductKey[]

type MissingMetadataKey = Exclude<MetadataProductKey, typeof METADATA_KEYS[number]>
export const ONBOARD_CRAWLER_METADATA_KEYS_COMPLETE: Record<MissingMetadataKey, never> = {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** Preserve every non-transformed crawler Product field in the POC artifact. */
export function crawlerFieldsToPoc(product: Product): {crawler_metadata: PocCrawlerMetadata} {
  const metadata: PocCrawlerMetadata = {}
  for (const key of METADATA_KEYS) {
    const value = product[key]
    if (value !== undefined) Object.assign(metadata, {[key]: value})
  }
  return {crawler_metadata: metadata}
}

/** Restore the trusted crawler snapshot; the caller overwrites transformed fields. */
export function crawlerFieldsFromPoc(row: PocCrawlerMetadataFields): PocCrawlerMetadata {
  if (!isRecord(row.crawler_metadata)) return {}
  const metadata: PocCrawlerMetadata = {}
  for (const key of METADATA_KEYS) {
    const value = row.crawler_metadata[key]
    if (value !== undefined) Object.assign(metadata, {[key]: value})
  }
  return metadata
}
