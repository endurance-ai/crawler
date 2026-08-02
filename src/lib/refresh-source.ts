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

/** product_refresh_runs 한 행 중 서킷브레이커가 보는 것만. */
export interface RefreshRunOutcome {
  platform_key: string
  status: string
  started_at: string | null
  /**
   * 이 실패가 "사이트에 닿지 못한 것"뿐이었는가 (`metrics.unreachable_only`).
   *
   * 참이면 연속 실패로 세지 않는다. 근거(실측 2026-08-02): 내비게이션 실패
   * 13건이 전부 **우리 쪽 호스트의 DNS 문제**였다 — 같은 URL 이 curl 로는
   * 1초에 200 으로 오고, 호스트 DNS 실패율이 20% 였다. 이걸 연속 실패로 세면
   * 멀쩡한 판매처가 백오프 사다리를 타고 최대 14일 워크리스트에서 사라진다.
   * 우리 네트워크가 나쁜 것을 판매처 탓으로 돌리지 않는다.
   */
  unreachable_only?: boolean | null
}

export interface RefreshFailureStreak {
  /** 마지막 성공 이후 연속 실패 횟수. 성공 기록이 없으면 전체 실패 횟수. */
  failures: number
  lastFailedAt: string | null
}

/**
 * 마지막 성공 이후 연속 실패 횟수를 런 이력에서 뽑는다.
 *
 * `product_refresh_sources` 에 카운터 컬럼을 두지 않은 것은 의도적이다 — 이력이
 * 이미 `product_refresh_runs` 에 다 있고, 마이그레이션 없이 계산할 수 있다.
 * 성공 기록이 아예 없는 소스는 전체 실패 횟수가 연쇄가 된다 (실측 2026-07-29:
 * 연쇄 중인 49개 소스 중 대부분이 한 번도 성공한 적 없다).
 */
export function computeFailureStreaks(runs: RefreshRunOutcome[]): Map<string, RefreshFailureStreak> {
  const byPlatform = new Map<string, RefreshRunOutcome[]>()
  for (const run of runs) {
    if (!run.platform_key) continue
    const bucket = byPlatform.get(run.platform_key)
    if (bucket) bucket.push(run)
    else byPlatform.set(run.platform_key, [run])
  }

  const streaks = new Map<string, RefreshFailureStreak>()
  for (const [platformKey, platformRuns] of byPlatform) {
    // 최신순으로 훑다가 success 를 만나면 멈춘다. started_at 이 없는 행(비정상
    // 종료)은 순서를 알 수 없으므로 가장 오래된 것으로 취급한다.
    const ordered = [...platformRuns].sort((a, b) =>
      (b.started_at ?? "").localeCompare(a.started_at ?? ""),
    )
    let failures = 0
    let lastFailedAt: string | null = null
    for (const run of ordered) {
      if (run.status === "success") break
      if (run.status !== "failed") continue // running/skipped 는 연쇄를 끊지도 늘리지도 않는다
      // 닿지 못한 런은 판매처의 실패가 아니다 — 끊지도 늘리지도 않는다.
      if (run.unreachable_only) continue
      failures += 1
      lastFailedAt ??= run.started_at
    }
    if (failures > 0) streaks.set(platformKey, {failures, lastFailedAt})
  }
  return streaks
}

/**
 * 연속 실패 횟수 → 다음 시도까지 쉬는 시간(ms).
 *
 * 2회까지는 쉬지 않는다 — 네트워크 순간 장애나 사이트 일시 점검을 영구 격리하면
 * 안 된다. 3회부터 계단식으로 늘린다.
 *
 * 실측 2026-07-29 근거: 전체 런 76.8시간 중 연속 3회 이상 실패 중인 소스가
 * 5.8시간(7.6%)을 태우고 있었고, 그 대부분이 호스트 네트워크에서 아예 닿지 않는
 * 해외 사이트(kith, browns, zara-kr, zara-us, end)였다. 재시도해도 영원히 실패한다.
 */
const BACKOFF_LADDER_MS: Array<{minFailures: number; waitMs: number}> = [
  {minFailures: 7, waitMs: 14 * 24 * 3_600_000},
  {minFailures: 6, waitMs: 7 * 24 * 3_600_000},
  {minFailures: 5, waitMs: 3 * 24 * 3_600_000},
  {minFailures: 4, waitMs: 24 * 3_600_000},
  {minFailures: 3, waitMs: 12 * 3_600_000},
]

export function backoffWaitMs(failures: number): number {
  return BACKOFF_LADDER_MS.find((step) => failures >= step.minFailures)?.waitMs ?? 0
}

/**
 * 지금 이 소스를 건너뛰어야 하는지. 건너뛴다면 사람이 읽을 사유를 돌려준다.
 *
 * `lastFailedAt` 을 모르면 건너뛰지 않는다 (fail-open) — 쉬어야 할 시점을 계산할
 * 수 없는데 영구 스킵하면 소스가 조용히 사라진다.
 */
export function backoffReason(
  streak: RefreshFailureStreak | undefined,
  now: Date,
): string | null {
  if (!streak) return null
  const waitMs = backoffWaitMs(streak.failures)
  if (waitMs === 0 || !streak.lastFailedAt) return null
  const lastFailed = Date.parse(streak.lastFailedAt)
  if (Number.isNaN(lastFailed)) return null
  const remainingMs = lastFailed + waitMs - now.getTime()
  if (remainingMs <= 0) return null
  return `backoff(${streak.failures}연속실패, ${formatWait(remainingMs)} 남음)`
}

function formatWait(ms: number): string {
  const hours = ms / 3_600_000
  return hours >= 24 ? `${(hours / 24).toFixed(1)}일` : `${Math.ceil(hours)}시간`
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
  /** 연속 실패 이력. 주면 서킷브레이커가 작동한다 (없으면 종전대로 전부 시도). */
  streaks?: Map<string, RefreshFailureStreak>
  /** backoff 무시 강제 재시도 (`--ignore-backoff`). */
  ignoreBackoff?: boolean
  now?: Date
}): {entries: RefreshWorklistEntry[]; skipped: string[]} {
  const states = new Map(args.sourceStates.map((row) => [row.platform_key, row]))
  const now = args.now ?? new Date()
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
    // 상품 수 확인 뒤에 본다 — 상품이 없어 스킵되는 소스까지 backoff 로 보고하면
    // 사유가 흐려진다.
    if (!args.ignoreBackoff) {
      const reason = backoffReason(args.streaks?.get(config.key), now)
      if (reason) {
        skipped.push(`${config.key}:${reason}`)
        continue
      }
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
 * "[BRAND] 상품명" 프리픽스에서 브랜드를 뽑는 패턴 — `SiteConfig.brandFromNamePrefix`
 * 를 켠 편집샵 전용.
 *
 * 2026-08-02: havati 는 상품명이 전부 `[HORLISUN] BAKER COZY PANTS` 형식인 편집샵인데
 * config 에 `brand` 도 `multiBrand` 도 없어서 DOM 브랜드 추출이 빈 문자열을 내고,
 * 신규 상품 후보 1,669건이 통째로 brand_unmatched 로 파킹됐다. DB 에 쌓인 1,823행도
 * 전부 샵 이름인 'Havati' 로 잘못 적재돼 있었다. 상품명에 브랜드가 100% 박혀 있으므로
 * LLM 없이 결정론적으로 뽑는다.
 *
 * 문자열로도 export 하는 이유: cafe24 엔진의 추출은 `page.evaluate` 안(브라우저
 * 컨텍스트)에서 돌아 바깥 함수를 호출할 수 없다. 패턴 소스를 인자로 넘겨
 * 규칙이 두 벌로 갈라지지 않게 한다.
 */
export const BRAND_NAME_PREFIX_PATTERN = "^\\s*\\[([^\\]]{1,40})\\]"

export function brandFromNamePrefix(name: string): string {
  const m = name.match(new RegExp(BRAND_NAME_PREFIX_PATTERN))
  return m ? m[1].trim() : ""
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
