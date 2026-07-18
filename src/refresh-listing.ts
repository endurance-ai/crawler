/**
 * 리스트-only 재고/가격 갱신 배치.
 *
 * 상세 페이지도, LLM 도 쓰지 않는다. 리스트 페이지만 훑어 이미 DB 에 있는 상품의
 * price/original_price/sale_price/in_stock 만 갱신한다. name/category/color/gender 등
 * 온보딩이 확정한 값은 절대 건드리지 않는다.
 *
 * 왜 `recrawl-batch.ts` 와 별개인가:
 *   recrawl-batch 는 온보딩 파이프라인(tools/onboard-batch.sh)을 재사용해 매 런마다
 *   전 상품 상세 크롤 + LLM 재분류를 돌린다. 카테고리 라벨 드랍 문제를 우회하려던
 *   선택이었지만, 재고/가격 갱신에는 과하다 (2026-07-19 첫 운영 런 실측: 10개 브랜드
 *   청크에 82분, 메모리 캡 상시 접촉, 청크당 LLM $0.014). 갱신에 필요한 가격·재고는
 *   리스트에 이미 있으므로(파일럿 실측 sacredt 43초·LLM 0회) 이 경로로 분리한다.
 *   온보딩/재분류가 필요할 때는 recrawl-batch 를 그대로 쓴다.
 *
 *   pnpm refresh -- --dry-run              # 워크리스트만 출력 (크롤 없음)
 *   pnpm refresh -- --site=rense           # 단일 브랜드 (검증용)
 *   pnpm refresh -- --budget-minutes=240   # 운영 (systemd timer)
 *
 * Flags:
 *   --budget-minutes=N   시간 예산 (default 240). 브랜드 사이에서 체크 — 소진 시 종료.
 *   --limit=N            최대 브랜드 수 (default 0 = 예산 내 무제한)
 *   --type=a,b           platform_type 필터 (default cafe24,shopify,imweb)
 *   --site=key           단일 브랜드만 (워크리스트 무시)
 *   --min-coverage=0.7   완전성 가드 — 리스트에서 재확인된 DB 상품 비율이 이 값
 *                        미만이면 "사라진 상품 = 품절" 처리를 건너뛴다. 카테고리
 *                        일부만 크롤된 부분 실패에서 멀쩡한 상품이 대량으로 숨는
 *                        사고를 막는다. 가격/재고 갱신 자체는 그대로 반영된다.
 *   --dry-run            변경 내역만 출력하고 DB 에 쓰지 않는다
 *
 * 종료 코드: 0 = 정상(예산 소진 포함), 1 = 치명 오류.
 */

import {chromium} from "playwright"

import {getSiteConfig} from "./configs/platforms"
import {crawlCafe24} from "./lib/cafe24-engine"
import {crawlImweb} from "./lib/imweb-engine"
import {crawlShopify} from "./lib/shopify-engine"
import {diffListing, type RefreshableRow, type RefreshUpdate} from "./lib/listing-refresh"
import type {Product, SiteConfig} from "./lib/types"
import {
  createProductCollectionClient,
  startProductRun,
  finishProductRun,
  upsertProductCrawlStatus,
  type ProductCollectionClient,
} from "./lib/product-collection"

const SUPPORTED_TYPES = new Set(["cafe24", "shopify", "imweb"])

interface Flags {
  budgetMinutes: number
  limit: number
  types: string[]
  site: string | null
  minCoverage: number
  dryRun: boolean
}

function parseFlags(): Flags {
  const flags: Flags = {
    budgetMinutes: 240,
    limit: 0,
    types: ["cafe24", "shopify", "imweb"],
    site: null,
    minCoverage: 0.7,
    dryRun: false,
  }
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") flags.dryRun = true
    else if (arg.startsWith("--budget-minutes=")) flags.budgetMinutes = Number(arg.split("=")[1])
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.split("=")[1])
    else if (arg.startsWith("--type=")) flags.types = arg.split("=")[1].split(",").filter(Boolean)
    else if (arg.startsWith("--site=")) flags.site = arg.split("=")[1]
    else if (arg.startsWith("--min-coverage=")) flags.minCoverage = Number(arg.split("=")[1])
  }
  return flags
}

interface WorklistEntry {
  brand_node_id: number
  platform_key: string
  platform_type: string
  status: string
  updated_at: string | null
}

/**
 * 갱신 대상 큐 — "가장 오래 안 건드린" 브랜드부터. recrawl-batch 와 동일한 규칙이라
 * 두 러너가 같은 순서를 공유한다 (docs/operations.md §13 큐 모델).
 */
async function fetchWorklist(
  db: ProductCollectionClient,
  types: string[],
): Promise<{entries: Array<WorklistEntry & {config: SiteConfig}>; skipped: string[]}> {
  const PAGE = 1000
  const rows: WorklistEntry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const {data, error} = await db
      .from("product_crawl_status")
      .select("brand_node_id, platform_key, platform_type, status, updated_at")
      .in("status", ["imported", "embedded"])
      .not("platform_key", "is", null)
      .order("updated_at", {ascending: true, nullsFirst: true})
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`worklist 조회 실패: ${error.message}`)
    const page = (data ?? []) as WorklistEntry[]
    rows.push(...page)
    if (page.length < PAGE) break
  }

  const seen = new Set<string>()
  const entries: Array<WorklistEntry & {config: SiteConfig}> = []
  const skipped: string[] = []
  for (const row of rows) {
    if (seen.has(row.platform_key)) continue
    seen.add(row.platform_key)
    const config = getSiteConfig(row.platform_key)
    if (!config || config.disabled) {
      skipped.push(row.platform_key)
      continue
    }
    if (!SUPPORTED_TYPES.has(config.type) || !types.includes(config.type)) {
      skipped.push(`${row.platform_key}(${config.type})`)
      continue
    }
    entries.push({...row, config})
  }
  return {entries, skipped}
}

/** 브랜드의 DB 보유 상품 — 갱신이 건드리는 컬럼만. */
async function fetchExistingRows(
  db: ProductCollectionClient,
  brandNodeId: number,
): Promise<RefreshableRow[]> {
  const PAGE = 1000
  const rows: RefreshableRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const {data, error} = await db
      .from("products")
      .select("product_url, price, original_price, sale_price, in_stock")
      .eq("brand_node_id", brandNodeId)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`products 조회 실패: ${error.message}`)
    const page = (data ?? []) as RefreshableRow[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

/** 리스트-only 크롤. 상세는 끄고 품절도 남긴다. */
async function crawlListing(config: SiteConfig): Promise<Product[]> {
  // crawlDetails 가 config 에 true 로 박혀 있어도 갱신에서는 상세를 돌지 않는다.
  const listingConfig: SiteConfig = {...config, crawlDetails: false}

  if (config.type === "shopify") {
    const result = await crawlShopify(listingConfig, {listingOnly: true})
    return result.products
  }
  if (config.type === "imweb") {
    // imweb 엔진은 품절을 이미 산출물에 남긴다 (파일럿 2026-07-18 정책 분리).
    const result = await crawlImweb(listingConfig)
    return result.products
  }

  const browser = await chromium.launch({headless: true})
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "ko-KR",
    })
    // 리스트만 볼 것이므로 이미지/폰트/CSS 는 받지 않는다 — 갱신 경로의 주된 속도 이득.
    await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2}", (route) => route.abort())
    const page = await context.newPage()
    const result = await crawlCafe24(page, listingConfig, undefined, undefined, {listingOnly: true})
    return result.products
  } finally {
    await browser.close()
  }
}

/** 바뀐 행만 컬럼 단위 UPDATE. upsert 를 쓰면 category/color 가 날아간다. */
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
      failed++
      if (failed <= 3) console.error(`   ❌ update 실패 ${update.productUrl}: ${error.message}`)
    } else {
      ok++
    }
  }
  return {ok, failed}
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)}분`
}

async function main() {
  const flags = parseFlags()
  const db = createProductCollectionClient()
  const startedAt = Date.now()
  const budgetMs = flags.budgetMinutes * 60_000

  let entries: Array<WorklistEntry & {config: SiteConfig}>
  if (flags.site) {
    const config = getSiteConfig(flags.site)
    if (!config) {
      console.error(`config 없음: ${flags.site}`)
      process.exit(1)
    }
    const {data} = await db
      .from("product_crawl_status")
      .select("brand_node_id, platform_key, platform_type, status, updated_at")
      .eq("platform_key", flags.site)
      .limit(1)
    const row = (data ?? [])[0] as WorklistEntry | undefined
    if (!row) {
      console.error(`product_crawl_status 행 없음: ${flags.site} (온보딩 전 브랜드는 갱신 대상이 아님)`)
      process.exit(1)
    }
    entries = [{...row, config}]
  } else {
    const worklist = await fetchWorklist(db, flags.types)
    entries = flags.limit > 0 ? worklist.entries.slice(0, flags.limit) : worklist.entries
    console.log(
      `📋 갱신 워크리스트: ${entries.length}개 브랜드 (스킵 ${worklist.skipped.length})` +
        ` | 예산 ${flags.budgetMinutes}분 | 완전성 가드 ${flags.minCoverage}`,
    )
    if (flags.dryRun) {
      for (const [i, e] of entries.entries()) {
        console.log(
          `  ${String(i + 1).padStart(4)}. ${e.platform_key} (${e.config.type}, ${e.status},` +
            ` updated_at=${e.updated_at ?? "null"})`,
        )
      }
      console.log(`\n(dry-run — 크롤/DB 쓰기 없음)`)
      return
    }
  }

  let done = 0
  let priceChanged = 0
  let stockChanged = 0
  let unknownTotal = 0
  let guardTripped = 0
  const failures: string[] = []

  for (const entry of entries) {
    if (Date.now() - startedAt >= budgetMs) {
      console.log(`\n⏱️  예산 ${flags.budgetMinutes}분 소진 — ${done}개 브랜드 처리 후 종료`)
      break
    }

    const label = `${entry.platform_key} (${entry.config.type})`
    const brandStart = Date.now()
    const runId = await startProductRun(db, {
      brandNodeId: entry.brand_node_id,
      stage: "crawl",
      command: "refresh-listing",
    })

    try {
      const [crawled, existing] = await Promise.all([
        crawlListing(entry.config),
        fetchExistingRows(db, entry.brand_node_id),
      ])

      const provisional = diffListing({
        crawled,
        existing,
        sourceCurrency: entry.config.sourceCurrency,
        markMissingOutOfStock: false,
      })
      const guardOk = provisional.coverage >= flags.minCoverage
      if (!guardOk && provisional.missingUrls.length > 0) {
        guardTripped++
        console.log(
          `   ⚠️ 완전성 가드 발동 — coverage ${(provisional.coverage * 100).toFixed(0)}%` +
            ` < ${(flags.minCoverage * 100).toFixed(0)}%, 사라진 ${provisional.missingUrls.length}개는 품절 처리하지 않음`,
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

      const priceN = diff.updates.filter((u) => u.patch.price !== undefined).length
      const stockN = diff.updates.filter((u) => u.reasons.some((r) => r.includes("품절") || r.includes("재입고"))).length
      priceChanged += priceN
      stockChanged += stockN
      unknownTotal += diff.unknownUrls.length

      const {ok, failed} = flags.dryRun
        ? {ok: 0, failed: 0}
        : await applyUpdates(db, diff.updates)

      console.log(
        `✓ ${label}: 리스트 ${crawled.length} · DB ${existing.length} ·` +
          ` 변경 ${diff.updates.length}(가격 ${priceN}, 재고 ${stockN})` +
          ` · 신규후보 ${diff.unknownUrls.length} · ${minutes(Date.now() - brandStart)}` +
          (failed > 0 ? ` · ⚠️ 실패 ${failed}` : ""),
      )

      await finishProductRun(db, runId, {
        status: failed > 0 ? "failed" : "success",
        metrics: {
          crawled: crawled.length,
          db_rows: existing.length,
          updated: ok,
          price_changed: priceN,
          stock_changed: stockN,
          unknown_urls: diff.unknownUrls.length,
          coverage: Number(diff.coverage.toFixed(3)),
          guard_tripped: !guardOk,
        },
      })
      // updated_at 을 밀어 큐 뒤로 보낸다 (워크리스트가 updated_at ASC 이므로).
      await upsertProductCrawlStatus(db, entry.brand_node_id, {
        platform_key: entry.platform_key,
        updated_at: new Date().toISOString(),
      })
      done++
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      failures.push(`${entry.platform_key}: ${detail}`)
      console.error(`✖ ${label} 실패: ${detail}`)
      await finishProductRun(db, runId, {status: "failed", errorMessage: detail})
      await upsertProductCrawlStatus(db, entry.brand_node_id, {
        platform_key: entry.platform_key,
        last_error: `refresh: ${detail}`,
        // 실패해도 큐 헤드를 영구 점유하지 않도록 뒤로 돌린다.
        updated_at: new Date().toISOString(),
      })
    }
  }

  console.log(
    `\n📊 갱신 완료: ${done}개 브랜드 · 가격변동 ${priceChanged} · 재고변동 ${stockChanged}` +
      ` · 신규후보 ${unknownTotal} · 가드발동 ${guardTripped} · 소요 ${minutes(Date.now() - startedAt)}`,
  )
  if (unknownTotal > 0) {
    console.log(`   ℹ️ 신규후보는 적재하지 않았다 — 카테고리/성별이 없어 온보딩 경로가 필요하다.`)
  }
  if (failures.length > 0) {
    console.log(`   ⚠️ 실패 ${failures.length}개: ${failures.slice(0, 5).join(" | ")}`)
  }
}

main().catch((err) => {
  console.error("치명 오류:", err)
  process.exit(1)
})
