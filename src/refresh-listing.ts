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
import {crawl29cm} from "./lib/29cm-engine"
import {crawlCafe24} from "./lib/cafe24-engine"
import {crawlFarfetch} from "./lib/farfetch-engine"
import {crawlImweb} from "./lib/imweb-engine"
import {diffListing, type RefreshableRow, type RefreshUpdate} from "./lib/listing-refresh"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {
  enqueueRefreshCandidates,
  finishRefreshRun,
  loadExistingBrands,
  loadRefreshProductCounts,
  loadRefreshRunOutcomes,
  loadRefreshSourceStates,
  startRefreshRun,
  syncRefreshSources,
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
  "29cm",
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
    ignoreBackoff: false,
  }
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") flags.dryRun = true
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
      .select("product_url, price, original_price, sale_price, in_stock")
      .eq("platform", platformKey)
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
    case "29cm":
      return crawl29cm(listingConfig)
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
        await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2}", (route) => route.abort())
        const page = await context.newPage()
        return await crawlCafe24(page, listingConfig, undefined, undefined, {listingOnly: true})
      } finally {
        await browser.close()
      }
    }
  }
}

async function applyUpdates(
  db: ProductCollectionClient,
  updates: RefreshUpdate[],
): Promise<{ok: number; failed: number}> {
  let ok = 0
  let failed = 0
  for (const update of updates) {
    const {error} = await db
      .from("products")
      .update({...update.patch, updated_at: new Date().toISOString()})
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

  if (!flags.dryRun) await syncRefreshSources(db, PLATFORMS)
  const [worklist, brands] = await Promise.all([
    fetchWorklist(db, flags.types, flags.ignoreBackoff),
    flags.dryRun ? Promise.resolve([]) : loadExistingBrands(db),
  ])

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
      const run = await startRefreshRun(db, {
        platformKey: entry.platform_key,
        command: "refresh-listing",
      })
      try {
        const [crawlResult, existing] = await Promise.all([
          crawlListing(entry.config),
          fetchExistingRows(db, entry.platform_key),
        ])
        const crawled = crawlResult.products
        const provisional = diffListing({
          crawled,
          existing,
          sourceCurrency: entry.config.sourceCurrency,
          markMissingOutOfStock: false,
        })
        const guardOk =
          crawlResult.errors.length === 0 &&
          provisional.coverage >= flags.minCoverage
        if (!guardOk && provisional.missingUrls.length > 0) {
          guardTripped += 1
          console.log(
            `   ⚠️ 완전성 가드 — coverage ${(provisional.coverage * 100).toFixed(0)}%` +
              `, engine errors ${crawlResult.errors.length}; 누락 ${provisional.missingUrls.length}건 품절 처리 안 함`,
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
        const applied = await applyUpdates(db, diff.updates)
        const queued = await enqueueRefreshCandidates(db, {
          products: unknownProducts(crawled, diff.unknownUrls),
          config: entry.config,
          brands,
        })

        priceChanged += priceN
        stockChanged += stockN
        candidateTotal += queued.discovered
        brandUnmatchedTotal += queued.brandUnmatched
        const failed = applied.failed > 0 || crawlResult.errors.length > 0
        console.log(
          `✓ ${label}: 리스트 ${crawled.length} · DB ${existing.length}` +
            ` · 변경 ${diff.updates.length}(가격 ${priceN}, 재고 ${stockN})` +
            ` · LLM후보 ${queued.discovered} · 브랜드불일치 ${queued.brandUnmatched}` +
            ` · ${minutes(Date.now() - run.startedAt)}`,
        )
        await finishRefreshRun(db, {
          id: run.id,
          platformKey: entry.platform_key,
          status: failed ? "failed" : "success",
          startedAt: run.startedAt,
          errorMessage: failed
            ? [...crawlResult.errors, applied.failed > 0 ? `update failures=${applied.failed}` : ""]
                .filter(Boolean)
                .join(" | ")
            : null,
          metrics: {
            crawled: crawled.length,
            db_rows: existing.length,
            updated: applied.ok,
            price_changed: priceN,
            stock_changed: stockN,
            candidates: queued.discovered,
            brand_unmatched: queued.brandUnmatched,
            coverage: Number(diff.coverage.toFixed(3)),
            guard_tripped: !guardOk,
            engine_errors: crawlResult.errors,
          },
        })
        done += 1
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        failures.push(`${entry.platform_key}: ${detail}`)
        console.error(`✖ ${label} 실패: ${detail}`)
        await finishRefreshRun(db, {
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
