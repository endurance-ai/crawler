/**
 * 큐 기반 재수집(재고/가격) 배치 러너.
 *
 * product_crawl_status 에서 "가장 오래 안 건드린" 브랜드부터 뽑아, 시간 예산 안에서
 * 도는 만큼만 재크롤하고 멈춘다. 다음 런이 updated_at 순서로 자연히 이어받으므로
 * 별도 커서 상태가 없다. 브랜드 수가 늘어도 러너는 동일 — 전체 갱신 주기는 예산의
 * 함수로 관측된다 (docs/operations.md §13 큐 모델 참조).
 *
 * 실행 경로는 검증된 bulk-onboarding 파이프라인(tools/onboard-batch.sh)을 청크
 * 단위로 재사용한다: 게이트 OFF 크롤(poc) → 규칙 기반 finalize → canonical import
 * → local Qwen 조건부 보강 → guardrail. 평범한 `crawl --site` 게이트 ON 경로는
 * 온보딩된 브랜드의 비canonical 카테고리 라벨("Cat42" 등)을 전량 드랍해 저장
 * 파일조차 안 남기므로 재수집에 쓸 수 없다 (2026-07-18 saurusgirl 실측,
 * docs/bulk-onboarding.md §0 참조).
 *
 *   pnpm recrawl -- --dry-run                       # 워크리스트만 출력 (크롤 없음)
 *   pnpm recrawl -- --limit=10 --budget-minutes=60  # 파일럿
 *   pnpm recrawl -- --budget-minutes=240            # 운영 (systemd timer)
 *
 * Flags:
 *   --budget-minutes=N        시간 예산 (default 240). 청크 사이에서 체크 — 소진 시 종료.
 *   --limit=N                 최대 브랜드 수 (default 0 = 예산 내 무제한)
 *   --chunk-size=N            청크당 브랜드 수 (default 10)
 *   --chunk-timeout-minutes=N 청크당 타임아웃 (default 120)
 *   --max-failed-chunks=N     연속 실패 청크 임계 — 도달 시 전체 중단 (default 2)
 *   --type=a,b                platform_type 필터 (기본: cafe24,shopify — poc 지원 타입)
 *   --dry-run                 워크리스트 출력만
 *
 * 워크리스트 규칙:
 *   - status in (imported, embedded, crawled) — 정상 사이클 대상
 *   - status = qc_failed 이면서 imported_at 이 남아있는 브랜드 — 재수집 중 실패한
 *     기존 브랜드는 재시도 대상. imported_at 이 null 인 qc_failed 는 온보딩 단계에서
 *     한 번도 import 되지 못한 깨진 사이트이므로 제외 (큐 오염 방지).
 *   - updated_at ASC. import 성공/실패는 import-products 의 sync 가, 크롤/분류 단계
 *     실패는 이 러너가 product_crawl_status 를 touch 해 updated_at 을 밀어준다 —
 *     실패 브랜드가 큐 헤드를 영구 점유하지 않고 맨 뒤로 순환한다.
 *   - 리포 레지스트리(platforms.ts + platforms.generated.ts)에 config 가 없는 키와
 *     poc 미지원 타입(imweb 등)은 스킵하고 요약에 집계한다 (영속화/지원 갭 가시화).
 *
 * 종료 코드: 0 = 정상(예산/큐 소진 포함), 1 = 일부/전체 실패, 2 = CLI 설정 오류.
 */

import {spawn} from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"
import {randomUUID} from "node:crypto"

import {getSiteConfig} from "./configs/platforms"
import type {SiteConfig} from "./lib/types"
import {assessPipelineChild, readPipelineReport} from "./lib/pipeline-report"
import {
  createProductCollectionClient,
  startProductRun,
  finishProductRun,
  upsertProductCrawlStatus,
  type ProductCollectionClient,
} from "./lib/product-collection"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const POC_SUPPORTED_TYPES = new Set(["cafe24", "shopify"])

// ─── CLI 플래그 ──────────────────────────────────────

interface Flags {
  budgetMinutes: number
  limit: number
  maxProducts: number
  includeQcFailed: boolean
  chunkSize: number
  chunkTimeoutMinutes: number
  maxFailedChunks: number
  types: string[]
  dryRun: boolean
}

function parseFlags(): Flags {
  const raw: Record<string, string | boolean> = {}
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue
    const [key, val] = arg.slice(2).split("=")
    raw[key] = val ?? true
  }
  const num = (key: string, def: number): number => {
    const v = raw[key]
    if (typeof v !== "string") return def
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) {
      console.error(`invalid --${key}=${v}`)
      process.exit(2)
    }
    return n
  }
  return {
    budgetMinutes: num("budget-minutes", 240),
    limit: num("limit", 0),
    maxProducts: num("max-products", 0),
    includeQcFailed: raw["include-qc-failed"] === true,
    chunkSize: Math.max(1, num("chunk-size", 10)),
    chunkTimeoutMinutes: num("chunk-timeout-minutes", 120),
    maxFailedChunks: Math.max(1, num("max-failed-chunks", 2)),
    types: typeof raw.type === "string" ? raw.type.split(",") : [...POC_SUPPORTED_TYPES],
    dryRun: raw["dry-run"] === true,
  }
}

// ─── 워크리스트 ──────────────────────────────────────

interface WorklistEntry {
  brand_node_id: number
  platform_key: string
  platform_type: string
  status: string
  updated_at: string | null
  imported_at: string | null
}

interface Worklist {
  entries: Array<WorklistEntry & {config: SiteConfig}>
  skippedNoConfig: string[]
  skippedUnsupported: string[]
}

async function fetchWorklist(
  db: ProductCollectionClient,
  types: string[],
  maxProducts: number,
  includeQcFailed: boolean,
): Promise<Worklist> {
  const PAGE = 1000
  const rows: WorklistEntry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const {data, error} = await db
      .from("product_crawl_status")
      .select("brand_node_id, platform_key, platform_type, status, updated_at, imported_at")
      .or(
        includeQcFailed
          ? "status.in.(imported,embedded,crawled,qc_failed)"
          : "status.in.(imported,embedded,crawled),and(status.eq.qc_failed,imported_at.not.is.null)",
      )
      .not("platform_key", "is", null)
      .order("updated_at", {ascending: true, nullsFirst: true})
      .order("brand_node_id", {ascending: true})
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`worklist 조회 실패: ${error.message}`)
    const page = (data ?? []) as WorklistEntry[]
    rows.push(...page)
    if (page.length < PAGE) break
  }

  // 같은 platform_key 를 공유하는 brand 행은 한 번의 사이트 크롤로 함께 갱신되므로
  // 가장 오래된 행 하나만 남긴다 (rows 는 이미 updated_at ASC).
  const seen = new Set<string>()
  const deduped: WorklistEntry[] = []
  for (const row of rows) {
    if (seen.has(row.platform_key)) continue
    seen.add(row.platform_key)
    deduped.push(row)
  }

  if (maxProducts > 0 && deduped.length > 0) {
    const counts = new Map<number, number>()
    for (let offset = 0; ; offset += PAGE) {
      const {data, error} = await db
        .from("products")
        .select("brand_node_id")
        .in("brand_node_id", deduped.map((row) => row.brand_node_id))
        .range(offset, offset + PAGE - 1)
      if (error) throw new Error(`product count 조회 실패: ${error.message}`)
      for (const row of data ?? []) {
        const brandNodeId = Number((row as {brand_node_id: number}).brand_node_id)
        counts.set(brandNodeId, (counts.get(brandNodeId) ?? 0) + 1)
      }
      if ((data ?? []).length < PAGE) break
    }
    rows.splice(0, rows.length, ...deduped.filter((row) => {
      const count = counts.get(row.brand_node_id) ?? 0
      return count >= 1 && count <= maxProducts
    }))

    const {data: canonicalRows, error: canonicalError} = await db
      .from("product_crawl_brands")
      .select("brand_node_id, platform_key, status, status_updated_at, imported_at")
      .in("brand_node_id", rows.map((row) => row.brand_node_id))
    if (canonicalError) throw new Error(`canonical worklist 조회 실패: ${canonicalError.message}`)
    const canonicalById = new Map(
      (canonicalRows ?? []).map((row) => [Number(row.brand_node_id), row as {
        brand_node_id: number
        platform_key: string | null
        status: string
        status_updated_at: string | null
        imported_at: string | null
      }]),
    )
    rows.splice(0, rows.length, ...rows.flatMap((row) => {
      const canonical = canonicalById.get(row.brand_node_id)
      if (!canonical || canonical.platform_key !== row.platform_key) return []
      return [{...row, status: canonical.status, updated_at: canonical.status_updated_at, imported_at: canonical.imported_at}]
    }))
  } else {
    rows.splice(0, rows.length, ...deduped)
  }

  const allowed = new Set(types)
  const result: Worklist = {entries: [], skippedNoConfig: [], skippedUnsupported: []}
  for (const row of rows) {
    const config = getSiteConfig(row.platform_key)
    if (!config || config.disabled) {
      result.skippedNoConfig.push(row.platform_key)
      continue
    }
    if (!POC_SUPPORTED_TYPES.has(config.type) || !allowed.has(config.type)) {
      result.skippedUnsupported.push(`${row.platform_key}(${config.type})`)
      continue
    }
    result.entries.push({...row, config})
  }
  return result
}

// ─── 서브프로세스 실행 ────────────────────────────────

function runChunk(args: {
  configsPath: string
  chunkIndex: number
  chunkSize: number
  outRoot: string
  timeoutMs: number
}): Promise<{code: number | null; timedOut: boolean}> {
  return new Promise((resolve) => {
    const child = spawn(
      "bash",
      [
        "tools/onboard-batch.sh",
        "--configs",
        args.configsPath,
        "--chunk-size",
        String(args.chunkSize),
        "--start",
        String(args.chunkIndex),
        "--end",
        String(args.chunkIndex),
        "--out-root",
        args.outRoot,
        // 재수집 대상은 이미 등록된 브랜드다. 신규 brand_node 생성은 막되,
        // 품절 행도 기존 상품과 함께 upsert하도록 --in-stock-only는 사용하지 않는다.
        "--import-flags",
        "--no-new-brands",
      ],
      {cwd: REPO_ROOT, stdio: "inherit", env: process.env, detached: true},
    )
    let timedOut = false
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return
      try { process.kill(-child.pid, signal) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      killGroup("SIGTERM")
      setTimeout(() => killGroup("SIGKILL"), 30_000).unref()
    }, args.timeoutMs)
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({code, timedOut})
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({code: -1, timedOut})
    })
  })
}

/** onboard-batch.sh 가 청크 완료 시 append 하는 tally CSV 의 해당 청크 행. */
function readTallyRow(outRoot: string, chunkIndex: number): {brandsPass: number; importOk: number; crawled: number} | null {
  const tallyPath = path.join(REPO_ROOT, outRoot, "onboard-tally.csv")
  if (!fs.existsSync(tallyPath)) return null
  const lines = fs.readFileSync(tallyPath, "utf-8").trim().split("\n").slice(1)
  for (const line of lines) {
    const cols = line.split(",")
    if (Number(cols[0]) === chunkIndex) {
      return {
        brandsPass: Number(cols[2] ?? 0),
        crawled: Number(cols[3] ?? 0),
        importOk: Number(cols[4] ?? 0),
      }
    }
  }
  return null
}

/** crawl/classify 단계 실패 브랜드의 status 를 touch — updated_at 이 밀려 큐 맨 뒤로
 * 순환하고, admin 에서 last_error 로 보인다. import 도달 브랜드는 import-products 의
 * 기존 sync 가 처리하므로 여기선 건드리지 않는다. */
async function recordFailedBrands(
  db: ProductCollectionClient,
  worklist: Map<string, WorklistEntry>,
  failedKeys: string[],
  detail: string,
): Promise<void> {
  for (const key of failedKeys) {
    const entry = worklist.get(key)
    if (!entry) continue
    try {
      const runId = await startProductRun(db, {
        brandNodeId: entry.brand_node_id,
        stage: "crawl",
        actor: "recrawl-batch",
        platformKey: key,
        status: "failed",
      })
      await finishProductRun(db, runId, {status: "failed", errorMessage: detail})
      await upsertProductCrawlStatus(db, entry.brand_node_id, {last_error: `recrawl: ${detail}`})
    } catch (e) {
      console.warn(`⚠️ 실패 기록 실패 (${key}): ${e instanceof Error ? e.message : e}`)
    }
  }
}

// ─── Discord 알림 ────────────────────────────────────

async function notifyDiscord(title: string, color: number, fields: Array<{name: string; value: string}>) {
  const url = process.env.DISCORD_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        username: "kiko-recrawl",
        embeds: [{title, color, fields, timestamp: new Date().toISOString()}],
      }),
    })
  } catch (e) {
    console.warn(`⚠️ Discord 알림 실패: ${e instanceof Error ? e.message : e}`)
  }
}

// ─── 메인 ────────────────────────────────────────────

function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)}m`
}

async function main() {
  const flags = parseFlags()
  const db = createProductCollectionClient()
  const startedAt = Date.now()
  const budgetMs = flags.budgetMinutes * 60_000

  const worklist = await fetchWorklist(db, flags.types, flags.maxProducts, flags.includeQcFailed)
  let entries = worklist.entries
  if (flags.limit > 0) entries = entries.slice(0, flags.limit)

  console.log(
    `📋 워크리스트: ${entries.length}개 대상` +
      ` (config 없음 ${worklist.skippedNoConfig.length}, 미지원 타입 ${worklist.skippedUnsupported.length})` +
      ` | 예산 ${flags.budgetMinutes}분 | chunk ${flags.chunkSize}`,
  )
  if (worklist.skippedNoConfig.length > 0) {
    console.log(`   ⚠️ config 미등록 (영속화 필요): ${worklist.skippedNoConfig.join(", ")}`)
  }
  if (worklist.skippedUnsupported.length > 0) {
    console.log(`   ⚠️ poc 미지원 타입: ${worklist.skippedUnsupported.join(", ")}`)
  }

  if (flags.dryRun) {
    for (const [i, e] of entries.entries()) {
      console.log(
        `  ${String(i + 1).padStart(4)}. ${e.platform_key} (${e.platform_type}, ${e.status},` +
          ` updated_at=${e.updated_at ?? "null"})`,
      )
    }
    return
  }

  // 워크리스트(오래된 순) 그대로 configs JSON 을 물질화 — onboard-batch.sh 가
  // 이 순서대로 청크를 자른다. out-root 는 런마다 새로 만들어 이전 런의 크롤
  // 캐시(청크 스킵)와 섞이지 않게 한다.
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)
  const outRoot = path.join("poc-runs", `recrawl-${stamp}-${randomUUID()}`)
  fs.mkdirSync(path.join(REPO_ROOT, outRoot), {recursive: true})
  const configsPath = path.join(REPO_ROOT, outRoot, "worklist-configs.json")
  fs.writeFileSync(configsPath, JSON.stringify(entries.map((e) => e.config), null, 2), "utf-8")

  const byKey = new Map<string, WorklistEntry>(entries.map((e) => [e.platform_key, e]))
  const totalChunks = Math.ceil(entries.length / flags.chunkSize)
  let chunksRun = 0
  let brandsAttempted = 0
  let importOkTotal = 0
  let crawledTotal = 0
  const failedBrands: string[] = []
  let consecutiveFailedChunks = 0
  let failedChunks = 0
  let stopReason = "큐 소진"

  for (let c = 0; c < totalChunks; c++) {
    if (Date.now() - startedAt >= budgetMs) {
      stopReason = `예산 ${flags.budgetMinutes}분 소진`
      break
    }
    if (consecutiveFailedChunks >= flags.maxFailedChunks) {
      stopReason = `연속 실패 청크 ${consecutiveFailedChunks}개 — 시스템 장애 의심, 중단`
      break
    }

    const chunkKeys = entries
      .slice(c * flags.chunkSize, (c + 1) * flags.chunkSize)
      .map((e) => e.platform_key)
    console.log(`\n▶ chunk ${c + 1}/${totalChunks}: ${chunkKeys.join(", ")}`)

    const res = await runChunk({
      configsPath,
      chunkIndex: c,
      chunkSize: flags.chunkSize,
      outRoot,
      timeoutMs: flags.chunkTimeoutMinutes * 60_000,
    })
    chunksRun++
    brandsAttempted += chunkKeys.length

    const tally = readTallyRow(outRoot, c)
    const chunkReport = await readPipelineReport(path.join(REPO_ROOT, outRoot, "_chunks", `chunk-${c}-report.json`)).catch(() => null)
    const assessment = assessPipelineChild(chunkReport, res.code, chunkKeys)
    const importOk = assessment.applied
    importOkTotal += importOk
    crawledTotal += tally?.crawled ?? 0

    const chunkFailed = !assessment.success || res.timedOut
    if (chunkFailed) {
      failedChunks++
      consecutiveFailedChunks++
      const detail = res.timedOut
        ? `chunk timeout ${flags.chunkTimeoutMinutes}m`
        : `chunk exit ${res.code}, import_ok=${importOk}`
      console.error(`  ✖ chunk ${c} 실패 (${detail})`)
    } else {
      consecutiveFailedChunks = 0
    }

    // Actual import outcomes determine completion, including partial failures.
    const failed = res.timedOut ? chunkKeys : assessment.failedPlatforms
    failedBrands.push(...failed)
    if (failed.length > 0) {
      await recordFailedBrands(
        db,
        byKey,
        failed,
        res.timedOut ? `chunk ${c} timeout` : `chunk ${c} import report incomplete`,
      )
    }
  }

  const aborted = consecutiveFailedChunks >= flags.maxFailedChunks
  const elapsed = minutes(Date.now() - startedAt)
  const summary =
    `청크 ${chunksRun}/${totalChunks} | 브랜드 ${brandsAttempted}개 시도` +
    ` / 실패 ${failedBrands.length} / 상품 크롤 ${crawledTotal} / import ${importOkTotal}` +
    ` | 잔여 큐 ${entries.length - brandsAttempted} | ${elapsed} | ${stopReason}`
  console.log(`\n🏁 ${summary}`)
  if (failedBrands.length > 0) console.log(`  실패: ${failedBrands.join(", ")}`)

  await notifyDiscord(
    aborted ? "🛑 recrawl 중단" : failedBrands.length > 0 ? "⚠️ recrawl 완료 (일부 실패)" : "✅ recrawl 완료",
    aborted ? 0xc62828 : failedBrands.length > 0 ? 0xf9a825 : 0x2e7d32,
    [
      {name: "결과", value: summary.slice(0, 1000)},
      ...(failedBrands.length > 0
        ? [{name: "실패 브랜드", value: failedBrands.join(", ").slice(0, 1000)}]
        : []),
      ...(worklist.skippedNoConfig.length > 0
        ? [
            {
              name: `config 미등록 ${worklist.skippedNoConfig.length}개 (영속화 필요)`,
              value: worklist.skippedNoConfig.join(", ").slice(0, 1000),
            },
          ]
        : []),
    ],
  )

  process.exit(failedChunks > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error(`💥 recrawl 치명 오류: ${e instanceof Error ? e.stack : e}`)
  await notifyDiscord("💥 recrawl 치명 오류", 0xc62828, [
    {name: "error", value: String(e instanceof Error ? e.message : e).slice(0, 1000)},
  ])
  process.exit(1)
})
