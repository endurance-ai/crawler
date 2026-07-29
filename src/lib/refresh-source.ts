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
 * 브랜드 대조 키 — 대소문자·공백·구두점을 모두 제거한 형태.
 *
 * 2026-07-29 버그 수정: `brand_nodes.brand_name_normalized` 는 이미 공백·구두점을
 * **제거한** 형태로 저장된다 (`"032c READYTOWEAR"` → `"032creadytowear"`,
 * `"Drakes - UK/ROW"` → `"drakesukrow"`). 그런데 matchExistingBrand 는 여기에
 * `normalizeBrandName`(공백을 collapse 만 하고 제거하지는 않음)을 적용해
 * 비교했다 → `"032c readytowear"` vs `"032creadytowear"` 로 **영원히 불일치**.
 * 공백이나 구두점이 들어간 브랜드명은 전부 매칭에 실패해 brand_unmatched 로
 * 파킹됐다.
 *
 * 양쪽에 동일한 제거 정규화를 적용해 형식 차이를 없앤다. NFKC 로 전각/호환 문자를
 * 먼저 접어 크롤러가 주워온 이형 문자도 흡수한다.
 */
export function brandMatchKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g, "")
}

/**
 * Automatic new-product import requires one unambiguous existing brand. Fuzzy
 * matching is deliberately excluded: a false positive is worse than leaving
 * the candidate in brand_unmatched for review.
 *
 * 구두점 제거로 서로 다른 브랜드가 같은 키로 접히면 매칭이 1건을 넘어 null 이
 * 되고 후보는 그대로 파킹된다 — 완화가 아니라 강화 방향이라 안전하다.
 */
export function matchExistingBrand(
  brand: string,
  rows: BrandLookupRow[],
): BrandLookupRow | null {
  const wanted = brandMatchKey(brand)
  if (!wanted) return null
  // brand_name_normalized 와 brand_name 어느 쪽으로든 일치하면 후보로 본다.
  // 같은 row 가 두 조건을 다 만족할 수 있으므로 id 로 중복 제거한 뒤 센다.
  const matches = new Map<number, BrandLookupRow>()
  for (const row of rows) {
    const keys = [row.brand_name_normalized ?? "", row.brand_name ?? ""]
    if (keys.some((k) => k && brandMatchKey(k) === wanted)) matches.set(row.id, row)
  }
  return matches.size === 1 ? [...matches.values()][0] : null
}

/**
 * 신규상품 후보의 브랜드 결정 — CLAUDE.md "Brand Name Fixing" 정책을 따른다.
 *
 * 우선순위:
 *   1) `config.brand` (하우스 브랜드) — 단, `multiBrand` 가 아닌 경우에만
 *   2) 상품에서 뽑은 brand (멀티브랜드 편집샵 / config.brand 미설정 자사몰)
 *
 * 2026-07-29 수정: 원래는 상품 brand 가 무조건 먼저였는데, 이는 정책과 정반대다.
 * 단일브랜드 자사몰에서 DOM 브랜드 추출은 상품마다 브랜드가 다른 멀티브랜드
 * 편집샵 전용 폴백인데, 그 오인식 값이 신뢰할 수 있는 `config.brand` 를 이겨서
 * 후보가 통째로 brand_unmatched 로 파킹됐다.
 */
export function resolveCandidateBrand(
  productBrand: unknown,
  config: Pick<SiteConfig, "brand" | "multiBrand">,
): string {
  const fromProduct = typeof productBrand === "string" ? productBrand.trim() : ""
  const house = config.brand?.trim() ?? ""
  if (house && !config.multiBrand) return house
  return fromProduct || house
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
    const detectedBrand = resolveCandidateBrand(product.brand, config)
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
