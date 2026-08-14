#!/usr/bin/env npx tsx
/**
 * Source-level listing refresh.
 *
 * Existing products: update only price/original_price/sale_price/in_stock.
 * New product URLs: enqueue for the separate existing-brand-only LLM worker.
 * This command never inserts brand_nodes and never imports a new product
 * directly.
 */

import {chromium} from "playwright"

import {PLATFORMS, getSiteConfig} from "./configs/platforms"
import {runAsyncPool} from "./lib/async-pool"
import {crawlCafe24} from "./lib/cafe24-engine"
import {crawlFarfetch} from "./lib/farfetch-engine"
import {crawlImweb} from "./lib/imweb-engine"
import {diffListing, type RefreshableRow, type RefreshUpdate} from "./lib/listing-refresh"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {installRequestBlocking} from "./lib/request-blocking"
import {
  enqueueRefreshCandidates,
  finishRefreshRun,
  loadExistingBrands,
  loadRefreshProductCounts,
  loadRefreshRunOutcomes,
  loadRefreshSourceStates,
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
import type {CrawlResult, PlatformType, Product, SiteConfig} from "./lib/types"
import {crawlUniqlo} from "./lib/uniqlo-engine"
import {crawlZara} from "./lib/zara-engine"

const ALL_TYPES: PlatformType[] = [
  "cafe24",
  "shopify",
  "imweb",
  "uniqlo",
  "zara",
  "farfetch",
]

interface Flags {
  budgetMinutes: number
  limit: number
  types: string[]
  site: string | null
  minCoverage: number
  concurrency: number
  dryRun: boolean
  auditPrices: boolean
  priceOnly: boolean
  ignoreBackoff: boolean
}

function parseFlags(): Flags {
  const flags: Flags = {
    budgetMinutes: 240,
    limit: 0,
    types: [...ALL_TYPES],
    site: null,
    minCoverage: 0.7,
    concurrency: 2,
    dryRun: false,
    auditPrices: false,
    priceOnly: false,
    ignoreBackoff: false,
  }
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") flags.dryRun = true
    else if (arg === "--audit-prices") flags.auditPrices = true
    else if (arg === "--price-only") flags.priceOnly = true
    else if (arg === "--ignore-backoff") flags.ignoreBackoff = true
    else if (arg.startsWith("--budget-minutes=")) flags.budgetMinutes = Number(arg.split("=")[1])
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.split("=")[1])
    else if (arg.startsWith("--type=")) flags.types = arg.split("=")[1].split(",").filter(Boolean)
    else if (arg.startsWith("--site=")) flags.site = arg.split("=")[1]
    else if (arg.startsWith("--min-coverage=")) flags.minCoverage = Number(arg.split("=")[1])
    else if (arg.startsWith("--concurrency=")) {
      flags.concurrency = Math.max(1, Math.floor(Number(arg.split("=")[1]) || 1))
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
      .select("product_url, price, original_price, sale_price, source_price, source_currency, in_stock")
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
    if (error) throw new Error(`products 조회 실패: ${error.message}`)
    const page = (data ?? []) as RefreshableRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

/** Listing-only crawl through every registered engine. */
async function crawlListing(config: SiteConfig): Promise<CrawlResult> {
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
    case "cafe24": {
      const browser = await chromium.launch({headless: true})
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
          detailConcurrency: 4,
        })
      } finally {
        await browser.close()
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
    const {error} = await db
      .from("products")
      .update({...payload, updated_at: new Date().toISOString()})
      .eq("product_url", update.productUrl)
    if (error) {
      failed += 1
      if (failed <= 3) console.error(`   ❌ update 실패 ${update.productUrl}: ${error.message}`)
    } else {
      ok += 1
    }
  }
  return {ok, failed}
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)}분`
}

function unknownProducts(crawled: Product[], urls: string[]): Product[] {
  const unknown = new Set(urls)
  return crawled.filter((product) => unknown.has(product.productUrl))
}

async function main() {
  const flags = parseFlags()
  const db = createProductCollectionClient()
  const startedAt = Date.now()
  const budgetMs = flags.budgetMinutes * 60_000

  if (!flags.dryRun && !flags.auditPrices) await syncRefreshSources(db, PLATFORMS)
  const [worklist, brands] = await Promise.all([
    fetchWorklist(db, flags.types, flags.ignoreBackoff || flags.auditPrices),
    flags.dryRun || flags.auditPrices ? Promise.resolve([]) : loadExistingBrands(db),
  ])

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
      ` | 동시 ${flags.concurrency}개 | 완전성 가드 ${flags.minCoverage}`,
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
  let budgetStopped = false
  const failures: string[] = []

  await runAsyncPool(
    entries,
    flags.concurrency,
    async (entry) => {
      attempted += 1
      const label = `${entry.platform_key} (${entry.config.type})`
      const run = flags.auditPrices
        ? {id: 0, startedAt: Date.now()}
        : await startRefreshRun(db, {
            platformKey: entry.platform_key,
            command: flags.priceOnly ? "refresh-listing --price-only" : "refresh-listing",
          })
      try {
        const [crawlResult, existing] = await Promise.all([
          crawlListing(entry.config),
          fetchExistingRows(db, entry.platform_key),
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
          invalid_price_pairs: crawled.filter(
            (product) => product.salePrice !== null &&
              (!(product.originalPrice !== null && product.salePrice < product.originalPrice) ||
              product.price !== product.salePrice),
          ).length,
        }
        const priceUpdatesSkipped = pricingMetrics.price_unknown + pricingMetrics.invalid_price_pairs
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
        if (pricingMetrics.price_unknown > 0) {
          qualityWarnings.push(`price_unknown=${pricingMetrics.price_unknown}`)
        }
        if (pricingMetrics.invalid_price_pairs > 0) {
          qualityWarnings.push(`invalid_price_pairs=${pricingMetrics.invalid_price_pairs}`)
        }
        // 닿지 못한 것(unreachable)은 가드에서는 errors 와 동일하게 본다 — 리스트가
        // 안 열렸는데 사라진 상품을 품절 처리하면 안 된다. 백오프에서만 다르게 센다.
        const unreachable = crawlResult.unreachable ?? []
        const guardOk =
          crawlResult.errors.length === 0 &&
          unreachable.length === 0 &&
          provisional.coverage >= flags.minCoverage
        if (!guardOk && provisional.missingUrls.length > 0) {
          guardTripped += 1
          console.log(
            `   ⚠️ 완전성 가드 — coverage ${(provisional.coverage * 100).toFixed(0)}%` +
              `, engine errors ${crawlResult.errors.length}, 도달실패 ${unreachable.length}` +
              `; 누락 ${provisional.missingUrls.length}건 품절 처리 안 함`,
          )
        }
        const diff = guardOk
          ? diffListing({
              crawled,
              existing,
              sourceCurrency: entry.config.sourceCurrency,
              markMissingOutOfStock: true,
            })
          : provisional
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
          : await touchProductsLastSeen(db, diff.confirmedUrls, new Date(run.startedAt).toISOString())
        const queued = flags.auditPrices || flags.priceOnly
          ? {discovered: 0, brandUnmatched: 0, queued: 0}
          : await enqueueRefreshCandidates(db, {
              products: unknownProducts(crawled, diff.unknownUrls),
              config: entry.config,
              brands,
            })

        priceChanged += priceN
        stockChanged += stockN
        candidateTotal += queued.discovered
        brandUnmatchedTotal += queued.brandUnmatched
        // 런 성패도 품질 경고를 보지 않는다 — 가격을 못 읽어도 재고 갱신은 성공한 것이다.
        // 경고는 아래 메트릭에 남겨 추적 가능하게 둔다.
        // unreachable 은 failed 로 친다(성공이 아니므로 last_succeeded_at 을 올리면
        // 안 된다). 다만 백오프 사다리는 metrics.unreachable_only 를 보고 건너뛴다.
        const failed =
          applied.failed > 0 || seen.failed > 0 || crawlResult.errors.length > 0 || unreachable.length > 0
        const unreachableOnly =
          unreachable.length > 0 && applied.failed === 0 && seen.failed === 0 && crawlResult.errors.length === 0
        console.log(
          `✓ ${label}: 리스트 ${crawled.length} · DB ${existing.length}` +
            ` · 변경 ${diff.updates.length}(가격 ${priceN}, 재고 ${stockN})` +
            ` · 생존확인 ${seen.ok}` +
            ` · LLM후보 ${queued.discovered} · 브랜드불일치 ${queued.brandUnmatched}` +
            (qualityWarnings.length > 0 ? ` · ⚠️ ${qualityWarnings.join("; ")}` : "") +
            ` · 세일 ${pricingMetrics.sale_detected} · 가격미확정 ${pricingMetrics.price_unknown}` +
            ` · ${minutes(Date.now() - run.startedAt)}`,
        )
        if (!flags.auditPrices) await finishRefreshRun(db, {
          id: run.id,
          platformKey: entry.platform_key,
          status: failed ? "failed" : "success",
          startedAt: run.startedAt,
          errorMessage: failed
            ? [
                ...crawlResult.errors,
                ...unreachable,
                applied.failed > 0 ? `update failures=${applied.failed}` : "",
                seen.failed > 0 ? `last_seen failures=${seen.failed}` : "",
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
            stock_changed: stockN,
            candidates: queued.discovered,
            brand_unmatched: queued.brandUnmatched,
            coverage: Number(diff.coverage.toFixed(3)),
            guard_tripped: !guardOk,
            engine_errors: crawlResult.errors,
            quality_warnings: qualityWarnings,
            unreachable,
            unreachable_only: unreachableOnly,
            ...pricingMetrics,
            price_updates_skipped: priceUpdatesSkipped,
            pricing_complete: pricingMetrics.price_unknown === 0 && pricingMetrics.invalid_price_pairs === 0,
          },
        })
        done += 1
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        failures.push(`${entry.platform_key}: ${detail}`)
        console.error(`✖ ${label} 실패: ${detail}`)
        if (!flags.auditPrices) await finishRefreshRun(db, {
          id: run.id,
          platformKey: entry.platform_key,
          status: "failed",
          errorMessage: detail,
          startedAt: run.startedAt,
        })
      }
    },
    () => {
      const withinBudget = Date.now() - startedAt < budgetMs
      if (!withinBudget) budgetStopped = true
      return withinBudget
    },
  )

  if (budgetStopped) {
    console.log(`\n⏱️ 예산 ${flags.budgetMinutes}분 소진 — ${attempted}개 소스 시도 후 종료`)
  }
  console.log(
    `\n📊 갱신 완료: ${done}개 소스 · 가격변동 ${priceChanged} · 재고변동 ${stockChanged}` +
      ` · LLM후보 ${candidateTotal} · 브랜드불일치 ${brandUnmatchedTotal}` +
      ` · 가드발동 ${guardTripped} · 소요 ${minutes(Date.now() - startedAt)}`,
  )
  if (failures.length > 0) {
    console.log(`   ⚠️ 실패 ${failures.length}개: ${failures.slice(0, 5).join(" | ")}`)
  }
}

main().catch((error) => {
  console.error("치명 오류:", error)
  process.exit(1)
})
