import {productIdentityKey} from "./listing-refresh"
import type {PlatformType, SiteConfig} from "./types"

export interface RefreshSourceState {
  platform_key: string
  last_attempted_at: string | null
}

export interface RefreshWorklistEntry {
  platform_key: string
  platform_type: PlatformType
  product_count: number
  last_attempted_at: string | null
  config: SiteConfig
}

export interface ProductPlatformRow {
  id: number
  platform: string
  product_url: string
}

export interface ProductPlatformRepair {
  id: number
  product_url: string
  before: string
  after: string
}

export interface ProductPlatformRepairPlan {
  changes: ProductPlatformRepair[]
  ambiguous: ProductPlatformRow[]
  unresolved: ProductPlatformRow[]
  unchanged: number
}

export interface BrandLookupRow {
  id: number
  brand_name: string
  brand_name_normalized: string | null
}

export interface RefreshCandidateInput {
  platform_key: string
  identity_key: string
  product_url: string
  raw_product: Record<string, unknown>
  detected_brand: string | null
  matched_brand_node_id: number | null
  status: "discovered" | "brand_unmatched"
}

export function uniqueRefreshConfigs(configs: SiteConfig[]): SiteConfig[] {
  const unique = new Map<string, SiteConfig>()
  for (const config of configs) {
    const previous = unique.get(config.key)
    if (!previous) {
      unique.set(config.key, config)
      continue
    }
    if (
      previous.type !== config.type ||
      normalizeHost(previous.baseUrl) !== normalizeHost(config.baseUrl)
    ) {
      throw new Error(
        `conflicting refresh config key ${config.key}: ` +
          `${previous.type}/${previous.baseUrl} vs ${config.type}/${config.baseUrl}`,
      )
    }
  }
  return [...unique.values()]
}

function normalizeHost(raw: string): string {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host.startsWith("www.") ? host.slice(4) : host
  } catch {
    return ""
  }
}

export function buildRefreshWorklist(args: {
  configs: SiteConfig[]
  sourceStates: RefreshSourceState[]
  productCounts: Map<string, number>
  types: Set<string>
  /** 배포 호스트별로 제외할 source key. config 는 그대로 두고 실행만 건너뛴다. */
  excluded?: Set<string>
}): {entries: RefreshWorklistEntry[]; skipped: string[]} {
  const states = new Map(args.sourceStates.map((row) => [row.platform_key, row]))
  const entries: RefreshWorklistEntry[] = []
  const skipped: string[] = []

  for (const config of uniqueRefreshConfigs(args.configs)) {
    if (config.disabled) {
      skipped.push(`${config.key}:disabled`)
      continue
    }
    if (args.excluded?.has(config.key)) {
      skipped.push(`${config.key}:excluded`)
      continue
    }
    if (!args.types.has(config.type)) {
      skipped.push(`${config.key}:type=${config.type}`)
      continue
    }
    const productCount = args.productCounts.get(config.key) ?? 0
    if (productCount <= 0) {
      skipped.push(`${config.key}:no-products`)
      continue
    }
    entries.push({
      platform_key: config.key,
      platform_type: config.type,
      product_count: productCount,
      last_attempted_at: states.get(config.key)?.last_attempted_at ?? null,
      config,
    })
  }

  entries.sort((a, b) => {
    if (a.last_attempted_at === null && b.last_attempted_at !== null) return -1
    if (a.last_attempted_at !== null && b.last_attempted_at === null) return 1
    return (
      (a.last_attempted_at ?? "").localeCompare(b.last_attempted_at ?? "") ||
      a.platform_key.localeCompare(b.platform_key)
    )
  })
  return {entries, skipped}
}

/**
 * Build a conservative platform repair plan. Existing valid keys are
 * authoritative. Legacy labels are rewritten only when a product URL host
 * belongs to exactly one configured source.
 */
export function buildPlatformRepairPlan(
  products: ProductPlatformRow[],
  configs: SiteConfig[],
): ProductPlatformRepairPlan {
  const validKeys = new Set(configs.map((config) => config.key))
  const hostToKeys = new Map<string, Set<string>>()
  for (const config of configs) {
    const host = normalizeHost(config.baseUrl)
    if (!host) continue
    const keys = hostToKeys.get(host) ?? new Set<string>()
    keys.add(config.key)
    hostToKeys.set(host, keys)
  }

  const changes: ProductPlatformRepair[] = []
  const ambiguous: ProductPlatformRow[] = []
  const unresolved: ProductPlatformRow[] = []
  let unchanged = 0

  for (const product of products) {
    if (validKeys.has(product.platform)) {
      unchanged += 1
      continue
    }
    const keys = hostToKeys.get(normalizeHost(product.product_url))
    if (!keys || keys.size === 0) {
      unresolved.push(product)
      continue
    }
    if (keys.size !== 1) {
      ambiguous.push(product)
      continue
    }
    const after = [...keys][0]
    changes.push({
      id: product.id,
      product_url: product.product_url,
      before: product.platform,
      after,
    })
  }
  return {changes, ambiguous, unresolved, unchanged}
}

function canonicalProductUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ""
    url.pathname = url.pathname.replace(/\/+$/, "")
    return url.toString()
  } catch {
    return raw.trim()
  }
}

export function candidateIdentity(platformKey: string, productUrl: string): string {
  return `${platformKey}:${productIdentityKey(productUrl) ?? canonicalProductUrl(productUrl)}`
}

export function normalizeBrandName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ")
}

/**
 * Automatic new-product import requires one unambiguous existing brand. Fuzzy
 * matching is deliberately excluded: a false positive is worse than leaving
 * the candidate in brand_unmatched for review.
 */
export function matchExistingBrand(
  brand: string,
  rows: BrandLookupRow[],
): BrandLookupRow | null {
  const wanted = normalizeBrandName(brand)
  if (!wanted) return null
  const matches = rows.filter((row) => {
    const normalized = row.brand_name_normalized || row.brand_name
    return normalizeBrandName(normalized) === wanted
  })
  return matches.length === 1 ? matches[0] : null
}

export function buildRefreshCandidateInputs(
  products: Array<Record<string, unknown> & {productUrl?: unknown; brand?: unknown}>,
  config: SiteConfig,
  brands: BrandLookupRow[],
): RefreshCandidateInput[] {
  const seen = new Set<string>()
  const rows: RefreshCandidateInput[] = []
  for (const product of products) {
    if (typeof product.productUrl !== "string" || !product.productUrl) continue
    const identityKey = candidateIdentity(config.key, product.productUrl)
    if (seen.has(identityKey)) continue
    seen.add(identityKey)
    // Multi-brand storefronts (Kith, Farfetch, 29CM, ...) must use the
    // product/vendor brand. config.brand is only a fallback for single-brand
    // engines that could not extract a brand from the listing.
    const detectedBrand =
      (typeof product.brand === "string" ? product.brand.trim() : "") ||
      config.brand?.trim() ||
      ""
    const matched = detectedBrand ? matchExistingBrand(detectedBrand, brands) : null
    rows.push({
      platform_key: config.key,
      identity_key: identityKey,
      product_url: product.productUrl,
      raw_product: product,
      detected_brand: detectedBrand || null,
      matched_brand_node_id: matched?.id ?? null,
      status: matched ? "discovered" : "brand_unmatched",
    })
  }
  return rows
}
