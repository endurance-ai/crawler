#!/usr/bin/env npx tsx
/**
 * Source-level listing refresh.
 *
 * Existing products: update only price/original_price/sale_price/in_stock.
 * New product URLs: enqueue for the separate existing-brand-only LLM worker.
 * This command never inserts brand_nodes and never imports a new product
 * directly.
 */

import {chromium, type Browser} from "playwright"

import {PLATFORMS, getSiteConfig} from "./configs/platforms"
import {runAsyncPool} from "./lib/async-pool"
import {crawlCafe24} from "./lib/cafe24-engine"
import {crawlFarfetch} from "./lib/farfetch-engine"
import {crawlImweb} from "./lib/imweb-engine"
import {initFxRates} from "./lib/fx"
import {
  diffListing,
  refreshCycleCoverage,
  type RefreshableRow,
  type RefreshUpdate,
} from "./lib/listing-refresh"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {installRequestBlocking} from "./lib/request-blocking"
import {
  enqueueRefreshCandidates,
  checkpointRefreshCycle,
  finalizeRefreshCycle,
  finishRefreshRun,
  loadExistingBrands,
  loadRefreshProductCounts,
  loadRefreshRunOutcomes,
  loadRefreshSourceStates,
  loadRefreshBatchSources,
  markRefreshBatchSourceStarted,
  finishRefreshBatchSource,
  reconcileStaleRefreshRuns,
  startOrResumeRefreshCycle,
  startRefreshRun,
  syncRefreshSources,
  touchProductsLastSeen,
} from "./lib/product-refresh"
import {
  buildRefreshWorklist,
  computeFailureStreaks,
  type RefreshWorklistEntry,
} from "./lib/refresh-source"
import {crawlShopify} from "./lib/shopify-engine"
import {isRefreshBatchSourceRunnable} from "./lib/refresh-batch"
import {crawlSixshop} from "./lib/sixshop-engine"
import {crawlStructuredExisting} from "./lib/structured-refresh-engine"
import type {CrawlResult, PlatformType, Product, SiteConfig} from "./lib/types"
import {toDecimalId} from "./lib/pipeline-integrity-types"
import {crawlUniqlo} from "./lib/uniqlo-engine"
import {crawlZara} from "./lib/zara-engine"

const DB_READ_TIMEOUT_MS = 20_000
const DB_PRIMARY_WRITE_TIMEOUT_MS = 10_000

const ALL_TYPES: PlatformType[] = [
  "cafe24",
  "shopify",
  "imweb",
  "uniqlo",
  "zara",
  "farfetch",
  "sixshop",
  "structured",
]

interface Flags {
  budgetMinutes: number
  limit: number
  types: string[]
  site: string | null
  minCoverage: number
  concurrency: number
  sourceSliceMinutes: number
  dryRun: boolean
  auditPrices: boolean
  priceOnly: boolean
  ignoreBackoff: boolean
  batchId: number | null
  onlyPending: boolean
  maxAttempts: number
  deadlineAt: number | undefined
}

function parseFlags(): Flags {
  const flags: Flags = {
    budgetMinutes: 240,
    limit: 0,
    types: [...ALL_TYPES],
    site: null,
    minCoverage: 0.7,
    concurrency: 2,
    sourceSliceMinutes: 10,
    dryRun: false,
    auditPrices: false,
    priceOnly: false,
    ignoreBackoff: false,
    batchId: null,
    onlyPending: false,
    maxAttempts: 2,
    deadlineAt: undefined,
  }
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") flags.dryRun = true
    else if (arg === "--audit-prices") flags.auditPrices = true
    else if (arg === "--price-only") flags.priceOnly = true
    else if (arg === "--ignore-backoff") flags.ignoreBackoff = true
    else if (arg === "--only-pending") flags.onlyPending = true
    else if (arg.startsWith("--budget-minutes=")) flags.budgetMinutes = Number(arg.split("=")[1])
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.split("=")[1])
    else if (arg.startsWith("--type=")) flags.types = arg.split("=")[1].split(",").filter(Boolean)
    else if (arg.startsWith("--site=")) flags.site = arg.split("=")[1]
    else if (arg.startsWith("--min-coverage=")) flags.minCoverage = Number(arg.split("=")[1])
    else if (arg.startsWith("--concurrency=")) {
      flags.concurrency = Math.max(1, Math.floor(Number(arg.split("=")[1]) || 1))
    } else if (arg.startsWith("--source-slice-minutes=")) {
      flags.sourceSliceMinutes = Math.max(1, Number(arg.split("=")[1]) || 10)
    } else if (arg.startsWith("--batch-id=")) {
      const value = Number(arg.split("=")[1])
      flags.batchId = Number.isInteger(value) && value > 0 ? value : null
    } else if (arg.startsWith("--max-attempts=")) {
      flags.maxAttempts = Math.max(1, Math.floor(Number(arg.split("=")[1]) || 2))
    } else if (arg.startsWith("--deadline-at=")) {
      const value = Date.parse(arg.split("=")[1])
      flags.deadlineAt = Number.isNaN(value) ? undefined : value
    }
  }
  return flags
}

/**
 * 배포 호스트에서만 제외할 source key 목록. 특정 호스트의 네트워크에서만
 * 닿지 않는 판매처를 config 수정 없이 건너뛰기 위한 것이다. config 를 고치면
 * batch_prep 의 `git pull --ff-only` 와 충돌하므로 env 로 받는다.
 */
function parseExcluded(): Set<string> {
  const raw = process.env.REFRESH_EXCLUDE ?? ""
  return new Set(
    raw
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  )
}

async function fetchWorklist(
  db: ProductCollectionClient,
  types: string[],
  ignoreBackoff: boolean,
): Promise<{entries: RefreshWorklistEntry[]; skipped: string[]}> {
  const [sourceStates, productCounts, runOutcomes] = await Promise.all([
    loadRefreshSourceStates(db),
    loadRefreshProductCounts(db),
    loadRefreshRunOutcomes(db),
  ])
  return buildRefreshWorklist({
    configs: PLATFORMS,
    sourceStates,
    productCounts,
    types: new Set(types),
    excluded: parseExcluded(),
    streaks: computeFailureStreaks(runOutcomes),
    ignoreBackoff,
  })
}

/** All DB products belonging to one storefront/source. */
async function fetchExistingRows(
  db: ProductCollectionClient,
  platformKey: string,
): Promise<RefreshableRow[]> {
  const pageSize = 1000
  const rows: RefreshableRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("products")
      .select(
        "id,product_url,updated_at,crawled_at,price,original_price,sale_price,source_price,source_currency,in_stock,last_seen_at",
      )
      .eq("platform", platformKey)
      // ORDER BY 없는 LIMIT/OFFSET 은 페이지 간 행 순서가 보장되지 않아 누락이 생긴다.
      // 누락된 행은 existing 에 없으므로 크롤된 그 URL 이 **신규 상품으로 오인**되어
      // 후보 큐에 들어가고, 워커가 상세 크롤 + LLM 을 태운 뒤에야 중복임을 안다.
      // 실측 2026-07-31: 이미 products 에 있는 URL 이 후보로 3,996건 쌓여 있었고
      // 그중 3,892건이 상품 1,000행을 넘는 platform(=페이지네이션이 도는 경우)에서
      // 나왔다 — sculpstore 3,622행→2,527건, drakes 1,608행→666건.
      // loadExistingBrands 는 같은 이유로 이미 .order("id") 를 붙여 뒀다.
      .order("product_url", {ascending: true})
      .range(offset, offset + pageSize - 1)
      .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
    if (error) throw new Error(`products 조회 실패: ${error.message}`)
    const page = (data ?? []).map((row) => ({...row,
      id: toDecimalId((row as {id: string | number | bigint}).id),
    })) as RefreshableRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

/** Listing-only crawl through every registered engine. */
async function crawlListing(
  config: SiteConfig,
  existingRows: RefreshableRow[] = [],
  options: {cursor?: RefreshWorklistEntry["refresh_cursor"]; deadlineAt?: number} = {},
  runtime: {cafe24Browser?: Browser} = {},
): Promise<CrawlResult> {
  const listingConfig: SiteConfig = {...config, crawlDetails: false, crawlReviews: false}
  switch (config.type) {
    case "shopify":
      return crawlShopify(listingConfig, {listingOnly: true})
    case "imweb":
      return crawlImweb(listingConfig)
    case "uniqlo":
      return crawlUniqlo(listingConfig)
    case "zara":
      return crawlZara(listingConfig)
    case "farfetch":
      return crawlFarfetch(listingConfig)
    case "sixshop":
      return crawlSixshop(listingConfig)
    case "structured":
      return crawlStructuredExisting(
        listingConfig,
        existingRows.map((row) => row.product_url),
      )
    case "cafe24": {
      const browser = runtime.cafe24Browser ?? await chromium.launch({headless: true})
      const ownsBrowser = !runtime.cafe24Browser
      try {
        const context = await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          locale: "ko-KR",
        })
        // 확장자 글롭에서 교체 — 그 방식은 `.js` 추적 스크립트를 못 막아 페이지당
        // 고유 호스트명 17개 중 16개가 그대로 조회됐다 (request-blocking.ts 헤더).
        // Cafe24 테마는 모든 상품 카드에 soldout 배지를 렌더한 뒤 재고 상품에서는
        // CSS로 숨기기도 한다(toomuch 실측). stylesheet를 막으면 computed display가
        // 기본값으로 돌아가 전 상품을 품절로 오판하므로 목록 갱신에서는 CSS를 허용한다.
        await installRequestBlocking(context, {allowStylesheets: true})
        const page = await context.newPage()
        return await crawlCafe24(page, listingConfig, undefined, undefined, {
          listingOnly: true,
          // 가격을 리스트에 안 띄우는 상점 대응 — 가격이 빠진 상품만 상세를 본다.
          // 건강한 상점은 방문 0회다. shopify/imweb 는 JSON/API 에서 가격이 나오므로 대상 아님.
          recoverMissingPriceFromDetail: true,
          priceRecoveryMode: "missing-current",
          detailConcurrency: 4,
          listingCursor: options.cursor ?? undefined,
          listingDeadlineAt: options.deadlineAt,
        })
      } finally {
        if (ownsBrowser) await browser.close()
      }
    }
  }
}

async function applyUpdates(
  db: ProductCollectionClient,
  updates: RefreshUpdate[],
  options: {audit: boolean; priceOnly: boolean},
): Promise<{ok: number; failed: number}> {
  let ok = 0
  let failed = 0
  for (const update of updates) {
    const payload = options.priceOnly
      ? Object.fromEntries(Object.entries(update.patch).filter(([key]) => key !== "in_stock"))
      : update.patch
    if (Object.keys(payload).length === 0) continue
    if (options.audit) {
      ok += 1
      continue
    }
    const {data, error} = await db
      .from("products")
      .update({...payload, crawled_at: update.observedAt, updated_at: new Date().toISOString()})
      .eq("id", update.id)
      .eq("product_url", update.productUrl)
      .eq("updated_at", update.expectedUpdatedAt)
      .select("id")
      .abortSignal(AbortSignal.timeout(DB_PRIMARY_WRITE_TIMEOUT_MS))
    if (error || data?.length !== 1) {
      failed += 1
      if (failed <= 3) console.error(`   ❌ update 실패 ${update.productUrl}: ${error?.message ?? "CAS conflict"}`)
    } else {
      ok += 1
    }
  }
  return {ok, failed}
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)}분`
}

function refreshExceptionCode(
  result: CrawlResult,
  unreachable: string[],
  status: string,
): string | null {
  if (status === "success" || status === "partial") return null
  if (result.errors.some((error) => /robots|disallow/i.test(error))) return "external_block"
  if (result.errors.some((error) => /HTTP (404|410)/i.test(error))) return "endpoint_removed"
  if (result.errors.some((error) => /category|catalog/i.test(error))) return "config_drift"
  if (unreachable.length > 0 || result.errors.some((error) => /timeout|fetch failed|HTTP (429|5\d\d)/i.test(error))) {
    return "transient_exhausted"
  }
  return "db_write_exhausted"
}

async function main() {
  // 가격 UPDATE 도 KRW 환산을 거치므로 갱신 시점 환율을 먼저 받는다.
  await initFxRates()

  const flags = parseFlags()
  const db = createProductCollectionClient()
  const startedAt = Date.now()
  const configuredBudgetMs = flags.budgetMinutes * 60_000
  const budgetMs = flags.deadlineAt
    ? Math.min(configuredBudgetMs, Math.max(0, flags.deadlineAt - startedAt))
    : configuredBudgetMs
  const batchSourceAttempts = new Map<string, number>()

  if (!flags.dryRun && !flags.auditPrices) {
    await syncRefreshSources(db, PLATFORMS)
    try {
      const staleBefore = new Date(startedAt - 12 * 60 * 60_000).toISOString()
      const reconciled = await reconcileStaleRefreshRuns(db, staleBefore)
      if (reconciled > 0) console.log(`🧹 중단된 refresh 실행 기록 ${reconciled}건 정리`)
    } catch (error) {
      console.error(`⚠️ 중단 실행 기록 정리 실패 (계속 진행): ${error}`)
    }
  }
  let [worklist, brands] = await Promise.all([
    fetchWorklist(db, flags.types, flags.ignoreBackoff || flags.auditPrices),
    flags.dryRun || flags.auditPrices ? Promise.resolve([]) : loadExistingBrands(db),
  ])

  if (flags.onlyPending && !flags.batchId) {
    throw new Error("--only-pending requires --batch-id=<id>")
  }
  if (flags.batchId) {
    const batchSources = await loadRefreshBatchSources(db, flags.batchId)
    const allowed = new Map(batchSources.map((source) => [source.platform_key, source]))
    for (const source of batchSources) batchSourceAttempts.set(source.platform_key, source.attempts)
    const selected = worklist.entries.filter((entry) => {
      const source = allowed.get(entry.platform_key)
      return Boolean(
        source &&
        isRefreshBatchSourceRunnable(source.status, source.attempts, flags.maxAttempts),
      )
    })
    const selectedKeys = new Set(selected.map((entry) => entry.platform_key))
    worklist = {
      entries: selected,
      skipped: [
        ...worklist.skipped,
        ...batchSources
          .filter((source) => !selectedKeys.has(source.platform_key))
          .map((source) => `${source.platform_key}:batch-${source.status}`),
      ],
    }
  }

  if (flags.auditPrices) {
    const counts = await loadRefreshProductCounts(db)
    const configs = new Map(PLATFORMS.map((config) => [config.key, config]))
    const quarantined = [...counts.entries()]
      .map(([platform, count]) => ({platform, count, config: configs.get(platform)}))
      .filter((entry) => !entry.config || entry.config.disabled)
      .sort((a, b) => b.count - a.count)
    const missingCount = quarantined.reduce((sum, entry) => sum + entry.count, 0)
    console.log(`🧊 자동 보정 격리: ${quarantined.length}개 소스 · DB ${missingCount}행`)
    for (const entry of quarantined.slice(0, 30)) {
      console.log(
        `   ${entry.platform}: ${entry.count}행 (${entry.config?.disabled ? "disabled" : "config-missing"})`,
      )
    }
  }

  let entries = worklist.entries
  if (flags.site) {
    const config = getSiteConfig(flags.site)
    if (!config) throw new Error(`config 없음: ${flags.site}`)
    const entry = entries.find((item) => item.platform_key === flags.site)
    if (!entry) {
      const reason = worklist.skipped.find((item) => item.startsWith(`${flags.site}:`)) ?? "no-products"
      const hint = reason.includes("backoff") ? " — 강제 실행은 --ignore-backoff" : ""
      throw new Error(`refresh 대상 아님: ${flags.site} (${reason})${hint}`)
    }
    entries = [entry]
  } else if (flags.limit > 0) {
    entries = entries.slice(0, flags.limit)
  }

  const targetProducts = entries.reduce((sum, entry) => sum + entry.product_count, 0)
  console.log(
    `📋 갱신 워크리스트: ${entries.length}개 소스 · DB ${targetProducts}행` +
      ` (스킵 ${worklist.skipped.length}) | 예산 ${flags.budgetMinutes}분` +
      ` | 동시 ${flags.concurrency}개 | 소스 조각 ${flags.sourceSliceMinutes}분` +
      ` | 완전성 가드 ${flags.minCoverage}`,
  )
  if (flags.auditPrices) console.log("   🔍 가격 감사 모드 — 크롤/DB 조회만 수행하고 쓰지 않음")
  if (flags.priceOnly) console.log("   💰 가격 전용 모드 — 재고/last_seen/candidate는 변경하지 않음")
  // 서킷브레이커가 무엇을 억누르고 있는지 항상 보여준다 — 조용히 사라지는 소스가
  // 생기면 이 기능이 오히려 커버리지 구멍을 만든다.
  const backoffSkips = worklist.skipped.filter((item) => item.includes(":backoff("))
  if (backoffSkips.length > 0) {
    const shown = backoffSkips.slice(0, 8).join(", ")
    const rest = backoffSkips.length > 8 ? ` …외 ${backoffSkips.length - 8}개` : ""
    console.log(`   🔌 서킷브레이커 대기 ${backoffSkips.length}개: ${shown}${rest}`)
  }
  if (flags.dryRun) {
    for (const [index, entry] of entries.entries()) {
      console.log(
        `  ${String(index + 1).padStart(4)}. ${entry.platform_key}` +
          ` (${entry.platform_type}, DB ${entry.product_count},` +
          ` last=${entry.last_attempted_at ?? "never"})`,
      )
    }
    if (worklist.skipped.length > 0) {
      console.log(`\n스킵 샘플: ${worklist.skipped.slice(0, 30).join(", ")}`)
    }
    console.log("\n(dry-run — 크롤/DB 쓰기 없음)")
    return
  }

  let done = 0
  let priceChanged = 0
  let stockChanged = 0
  let candidateTotal = 0
  let brandUnmatchedTotal = 0
  let guardTripped = 0
  let attempted = 0
  let partialSlices = 0
  let budgetStopped = false
  let skippedSources = 0
  let writeFailures = 0
  let lastSeenFailures = 0
  let candidateFailures = 0
  let telemetryFailures = 0
  const failures: string[] = []

  const finishRunBestEffort = async (
    run: {id: number; startedAt: number} | null,
    input: Omit<Parameters<typeof finishRefreshRun>[1], "id" | "startedAt">,
  ): Promise<void> => {
    if (!run || flags.auditPrices) return
    try {
      await finishRefreshRun(db, {...input, id: run.id, startedAt: run.startedAt})
    } catch (error) {
      telemetryFailures += 1
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`   ⚠️ ${input.platformKey} 실행 기록 마감 실패 (계속 진행): ${detail}`)
    }
  }

  const initialSourceCount = entries.length
  const sharedCafe24Browser = entries.some((entry) => entry.config.type === "cafe24")
    ? await chromium.launch({headless: true})
    : undefined
  try {
  await runAsyncPool(
    entries,
    flags.concurrency,
    async (entry) => {
      attempted += 1
      const label = `${entry.platform_key} (${entry.config.type})`
      const sourceStartedAt = Date.now()
      let run: {id: number; startedAt: number; sourceStateError?: string | null} | null = flags.auditPrices
        ? {id: 0, startedAt: sourceStartedAt}
        : null
      if (!flags.auditPrices) {
        try {
          run = await startRefreshRun(db, {
            platformKey: entry.platform_key,
          command: flags.priceOnly ? "refresh-listing --price-only" : "refresh-listing",
          batchId: flags.batchId ?? undefined,
          })
          if (run.sourceStateError) {
            telemetryFailures += 1
            console.error(
              `   ⚠️ ${label} source 시작 상태 기록 실패 (실제 갱신은 계속): ${run.sourceStateError}`,
            )
          }
          if (flags.batchId) {
            const attempts = (batchSourceAttempts.get(entry.platform_key) ?? 0) + 1
            await markRefreshBatchSourceStarted(db, {
              batchId: flags.batchId,
              platformKey: entry.platform_key,
              attempts,
            })
            batchSourceAttempts.set(entry.platform_key, attempts)
          }
        } catch (error) {
          telemetryFailures += 1
          const detail = error instanceof Error ? error.message : String(error)
          console.error(`   ⚠️ ${label} 실행 기록 시작 실패 (실제 갱신은 계속): ${detail}`)
        }
      }
      try {
        const cycleStartedAt = flags.auditPrices
          ? entry.refresh_cycle_started_at ?? new Date(sourceStartedAt).toISOString()
          : await startOrResumeRefreshCycle(db, {
              platformKey: entry.platform_key,
              existingStartedAt: entry.refresh_cycle_started_at,
            })
        const sliceDeadlineAt = Math.min(
          sourceStartedAt + flags.sourceSliceMinutes * 60_000,
          flags.deadlineAt ?? Number.POSITIVE_INFINITY,
        )
        const existingPromise = fetchExistingRows(db, entry.platform_key)
        const listingOptions = {
          cursor: entry.refresh_cursor,
          deadlineAt: entry.config.type === "cafe24" ? sliceDeadlineAt : undefined,
        }
        const crawlPromise = entry.config.type === "structured"
          ? existingPromise.then((rows) => crawlListing(entry.config, rows, listingOptions, {cafe24Browser: sharedCafe24Browser}))
          : crawlListing(entry.config, [], listingOptions, {cafe24Browser: sharedCafe24Browser})
        const [crawlResult, existing] = await Promise.all([
          crawlPromise,
          existingPromise,
        ])
        const crawled = crawlResult.products
        const pricingMetrics = {
          sale_detected: crawled.filter((product) => product.pricingObservation?.state === "sale").length,
          regular_confirmed: crawled.filter((product) => product.pricingObservation?.state === "regular").length,
          detail_price_checks: crawled.filter(
            (product) => product.pricingObservation?.source === "detail",
          ).length,
          price_unknown: crawled.filter(
            (product) => !product.pricingObservation || product.pricingObservation.state === "unknown",
          ).length,
          price_unknown_without_current: crawled.filter((product) => {
            const observation = product.pricingObservation
            if (observation?.version === 2 && observation.state !== "unknown") return false
            const current = product.sourcePrice ?? product.price
            return !(typeof current === "number" && Number.isFinite(current) && current > 0)
          }).length,
          invalid_price_pairs: crawled.filter(
            (product) => product.salePrice !== null &&
              (!(product.originalPrice !== null && product.salePrice < product.originalPrice) ||
              product.price !== product.salePrice),
          ).length,
        }
        const priceUpdatesSkipped =
          pricingMetrics.price_unknown_without_current + pricingMetrics.invalid_price_pairs
        const provisional = diffListing({
          crawled,
          existing,
          sourceCurrency: entry.config.sourceCurrency,
          markMissingOutOfStock: false,
        })
        // 완전성 가드는 "리스트가 끝까지 열렸는가"만 본다 — `errors`(엔진/네트워크
        // 실패)와 coverage 다. 품질 경고(`qualityWarnings`, 예: price_missing_rate)는
        // 보지 않는다. 섞여 있던 동안 가격을 못 읽는 것이 재고 이탈 감지까지 막았고
        // 런이 failed 로 남아 성공 이력이 영구히 안 쌓였다 (실측 42개 소스).
        const qualityWarnings = crawlResult.qualityWarnings ?? []
        const unknownWarning = `price_unknown=${pricingMetrics.price_unknown}`
        if (pricingMetrics.price_unknown > 0 && !qualityWarnings.includes(unknownWarning)) {
          qualityWarnings.push(unknownWarning)
        }
        if (pricingMetrics.invalid_price_pairs > 0) {
          qualityWarnings.push(`invalid_price_pairs=${pricingMetrics.invalid_price_pairs}`)
        }
        // 부분 조각에서는 확인하지 않은 상품을 절대 품절 처리하지 않는다. 전체
        // 주기가 끝나면 last_seen_at 과 cycleStartedAt 으로 한 번에 판정한다.
        const unreachable = crawlResult.unreachable ?? []
        const diff = provisional
        const priceN = diff.updates.filter((update) => update.patch.price !== undefined).length
        const stockN = diff.updates.filter((update) =>
          update.reasons.some((reason) => reason.includes("품절") || reason.includes("재입고")),
        ).length
        const applied = await applyUpdates(db, diff.updates, {
          audit: flags.auditPrices,
          priceOnly: flags.priceOnly,
        })
        // 살아있음이 확인된 상품의 생존 타임스탬프. 완전성 가드와 무관하게 올린다 —
        // 확인된 상품은 실제로 살아있고, 사라진 상품을 죽이는 판단은 가드가 따로 한다.
        const seen = flags.auditPrices || flags.priceOnly
          ? {ok: 0, failed: 0}
          : await touchProductsLastSeen(
              db,
              diff.confirmedUrls,
              new Date().toISOString(),
            )
        let queued = {inserted: 0, updated: 0, unchanged: 0, stale: 0, conflicted: 0, rematched: 0, brandUnmatched: 0}
        let candidateError: string | null = null
        if (!flags.auditPrices && !flags.priceOnly) {
          try {
            queued = await enqueueRefreshCandidates(db, {
              products: crawled,
              unknownUrls: diff.unknownUrls,
              config: entry.config,
              brands,
            })
            if (queued.conflicted > 0) candidateFailures += 1
          } catch (error) {
            candidateFailures += 1
            candidateError = error instanceof Error ? error.message : String(error)
            console.error(`   ⚠️ ${label} candidate 적재 실패 (가격·재고는 유지): ${candidateError}`)
          }
        }

        const cycleDegraded =
          entry.refresh_cycle_degraded ||
          crawlResult.errors.length > 0 ||
          unreachable.length > 0 ||
          seen.failed > 0
        const cycleCoverage = flags.auditPrices && !entry.refresh_cycle_started_at
          ? provisional.coverage
          : refreshCycleCoverage(existing, diff.confirmedUrls, cycleStartedAt)
        const complete = !crawlResult.continuation
        const coverageOk = cycleCoverage >= flags.minCoverage
        const markMissingOutOfStock =
          complete && !flags.priceOnly && !cycleDegraded && coverageOk
        const shouldRequeue = Boolean(crawlResult.continuation) && Date.now() - startedAt < budgetMs
        let missingStockN = 0

        if (!flags.auditPrices) {
          if (crawlResult.continuation) {
            await checkpointRefreshCycle(db, {
              platformKey: entry.platform_key,
              cycleStartedAt,
              cursor: crawlResult.continuation,
              degraded: cycleDegraded,
            })
          } else {
            missingStockN = await finalizeRefreshCycle(db, {
              platformKey: entry.platform_key,
              cycleStartedAt,
              markMissingOutOfStock,
            })
          }
        }

        if (crawlResult.continuation) {
          partialSlices += 1
          entry.refresh_cursor = crawlResult.continuation
          entry.refresh_cycle_started_at = cycleStartedAt
          entry.refresh_cycle_degraded = cycleDegraded
          console.log(
            `   ↪ 부분 완료 — category ${crawlResult.continuation.categoryIndex + 1}` +
              ` page ${crawlResult.continuation.page}부터 재개`,
          )
        } else if (!markMissingOutOfStock && !flags.priceOnly) {
          guardTripped += 1
          console.log(
            `   ⚠️ 주기 완전성 가드 — coverage ${(cycleCoverage * 100).toFixed(0)}%` +
              `, degraded=${cycleDegraded}; 미확인 상품 품절 처리 안 함`,
          )
        }

        priceChanged += priceN
        stockChanged += stockN + missingStockN
        candidateTotal += queued.inserted
        brandUnmatchedTotal += queued.brandUnmatched
        writeFailures += applied.failed
        lastSeenFailures += seen.failed
        // 런 성패도 품질 경고를 보지 않는다 — 가격을 못 읽어도 재고 갱신은 성공한 것이다.
        // 경고는 아래 메트릭에 남겨 추적 가능하게 둔다.
        // unreachable 은 failed 로 친다(성공이 아니므로 last_succeeded_at 을 올리면
        // 안 된다). 다만 백오프 사다리는 metrics.unreachable_only 를 보고 건너뛴다.
        const failed =
          applied.failed > 0 || seen.failed > 0 || candidateError !== null || queued.conflicted > 0 || crawlResult.errors.length > 0 || unreachable.length > 0
        const unreachableOnly =
          unreachable.length > 0 && applied.failed === 0 && seen.failed === 0 && crawlResult.errors.length === 0
        const dbPartialOnly =
          (applied.failed > 0 || seen.failed > 0 || candidateError !== null || queued.conflicted > 0) && crawlResult.errors.length === 0 && unreachable.length === 0
        const status = failed
          ? "failed"
          : crawlResult.continuation
            ? "partial"
            : !flags.priceOnly && (cycleDegraded || !coverageOk)
              ? "skipped"
              : "success"
        console.log(
          `✓ ${label}: 리스트 ${crawled.length} · DB ${existing.length}` +
            ` · 변경 ${diff.updates.length + missingStockN}` +
            `(가격 ${priceN}, 재고 ${stockN + missingStockN})` +
            ` · 생존확인 ${seen.ok}` +
            ` · 신규후보 ${queued.inserted} · 후보갱신 ${queued.updated} · 후보충돌 ${queued.conflicted} · 관측브랜드불일치 ${queued.brandUnmatched}` +
            (qualityWarnings.length > 0 ? ` · ⚠️ ${qualityWarnings.join("; ")}` : "") +
            ` · 세일 ${pricingMetrics.sale_detected} · 가격미확정 ${pricingMetrics.price_unknown}` +
            ` · ${minutes(Date.now() - (run?.startedAt ?? sourceStartedAt))}`,
        )
        await finishRunBestEffort(run, {
          platformKey: entry.platform_key,
          status,
          errorMessage: failed
            ? [
                ...crawlResult.errors,
                ...unreachable,
                applied.failed > 0 ? `update failures=${applied.failed}` : "",
                seen.failed > 0 ? `last_seen failures=${seen.failed}` : "",
                candidateError ? "candidate observation write failed" : "",
                queued.conflicted > 0 ? `candidate observation conflicts=${queued.conflicted}` : "",
              ]
                .filter(Boolean)
                .join(" | ")
            : null,
          metrics: {
            crawled: crawled.length,
            db_rows: existing.length,
            updated: applied.ok,
            last_seen_touched: seen.ok,
            price_changed: priceN,
            stock_changed: stockN + missingStockN,
            candidates: queued.inserted,
            candidate_observation_updated: queued.updated,
            candidate_observation_unchanged: queued.unchanged,
            candidate_observation_stale: queued.stale,
            candidate_observation_conflicted: queued.conflicted,
            candidate_rematched: queued.rematched,
            brand_unmatched: queued.brandUnmatched,
            coverage: Number(cycleCoverage.toFixed(3)),
            slice_coverage: Number(diff.coverage.toFixed(3)),
            partial: Boolean(crawlResult.continuation),
            continuation: crawlResult.continuation ?? null,
            cycle_started_at: cycleStartedAt,
            cycle_degraded: cycleDegraded,
            guard_tripped: complete && !markMissingOutOfStock && !flags.priceOnly,
            missing_marked_out_of_stock: missingStockN,
            duplicate_product_observations: crawlResult.stats.duplicateProductObservations ?? 0,
            categories_completed: crawlResult.stats.categoriesCompleted ?? 0,
            engine_errors: crawlResult.errors,
            quality_warnings: qualityWarnings,
            unreachable,
            unreachable_only: unreachableOnly,
            db_partial_only: dbPartialOnly,
            last_seen_failures: seen.failed,
            candidate_enqueue_error: candidateError,
            ...pricingMetrics,
            price_updates_skipped: priceUpdatesSkipped,
            pricing_complete:
              pricingMetrics.price_unknown_without_current === 0 && pricingMetrics.invalid_price_pairs === 0,
          },
        })
        if (flags.batchId) {
          await finishRefreshBatchSource(db, {
            batchId: flags.batchId,
            platformKey: entry.platform_key,
            runId: run?.id,
            status: crawlResult.continuation ? "partial" : status === "success" ? "success" : "exception",
            exceptionCode: refreshExceptionCode(crawlResult, unreachable, status),
            exceptionMessage: failed ? [...crawlResult.errors, ...unreachable].join(" | ") : null,
          })
        }
        // Requeue only after the current run record is closed. Appending to the
        // shared ordered array puts resumed work behind every source that has
        // not received its first slice and prevents two workers from running
        // the same source concurrently.
        if (shouldRequeue) entries.push(entry)
        if (complete) done += 1
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        skippedSources += 1
        failures.push(`${entry.platform_key}: ${detail}`)
        console.error(`✖ ${label} 실패 (다음 소스로 진행): ${detail}`)
        await finishRunBestEffort(run, {
          platformKey: entry.platform_key,
          status: "failed",
          errorMessage: detail,
          metrics: {
            db_partial_only: detail.startsWith("products 조회 실패:"),
          },
        })
        if (flags.batchId) {
          await finishRefreshBatchSource(db, {
            batchId: flags.batchId,
            platformKey: entry.platform_key,
            runId: run?.id,
            status: "exception",
            exceptionCode: "db_write_exhausted",
            exceptionMessage: detail,
          })
        }
      }
    },
  () => {
      const withinBudget = Date.now() - startedAt < budgetMs
      if (!withinBudget) budgetStopped = true
      return withinBudget
    },
  )
  } finally {
    await sharedCafe24Browser?.close()
  }

  if (budgetStopped) {
    console.log(`\n⏱️ 예산 ${flags.budgetMinutes}분 소진 — ${attempted}개 조각 시도 후 종료`)
  }
  console.log(
    `\n📊 갱신 완료: ${done}/${initialSourceCount}개 소스` +
      ` · 조각 ${attempted}(부분 ${partialSlices})` +
      ` · 가격변동 ${priceChanged} · 재고변동 ${stockChanged}` +
      ` · LLM후보 ${candidateTotal} · 브랜드불일치 ${brandUnmatchedTotal}` +
      ` · 가드발동 ${guardTripped} · 소스스킵 ${skippedSources}` +
      ` · UPDATE실패 ${writeFailures} · 생존확인실패 ${lastSeenFailures}` +
      ` · candidate실패 ${candidateFailures} · telemetry실패 ${telemetryFailures}` +
      ` · 소요 ${minutes(Date.now() - startedAt)}`,
  )
  if (failures.length > 0) {
    console.log(`   ⚠️ 실패 ${failures.length}개: ${failures.slice(0, 5).join(" | ")}`)
  }
  if (failures.length > 0 || writeFailures > 0 || lastSeenFailures > 0 || candidateFailures > 0 || telemetryFailures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error("치명 오류:", error)
  process.exit(1)
})
