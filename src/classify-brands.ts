#!/usr/bin/env npx tsx
/**
 * Brand 일괄 분류 CLI.
 *
 * app 의 POST /api/internal/classify-brand 를 N개 brand 에 대해 호출.
 * 본 CLI 는 호출 측 (caller) 책임만 담당:
 *   - target brand_id 수집 (DB 또는 인자)
 *   - token bucket 으로 호출 속도 조절
 *   - 429 rate limit 자동 backoff + retry
 *   - 실패 brand_id 파일 박제 (재실행 가능)
 *   - 결과 통계 (classified / queued / skipped / failed)
 *
 * AI 분류 자체는 app endpoint 책임. 본 CLI 는 분류 로직 모름.
 *
 * 사용법:
 *   pnpm tsx src/classify-brands.ts --all                          # 미분류 brand 전체
 *   pnpm tsx src/classify-brands.ts --all --limit 100              # 100개만
 *   pnpm tsx src/classify-brands.ts --brand-id 42                  # 단일 brand
 *   pnpm tsx src/classify-brands.ts --all --force                  # 이미 분류된 것도 재분류
 *   pnpm tsx src/classify-brands.ts --all --concurrency 2          # 병렬 2
 *   pnpm tsx src/classify-brands.ts --all --dry-run                # 대상만 출력
 *   pnpm tsx src/classify-brands.ts --retry-failed                 # 실패 파일 재실행
 *
 * 환경변수 (.env.local):
 *   APP_URL=http://54.116.104.193
 *   INTERNAL_API_KEY=<secret>
 *   DB_URL / DB_TOKEN
 */

import {createClient} from "@supabase/supabase-js"
import * as fs from "fs"
import * as path from "path"

// ─── 환경변수 ────────────────────────────────────────

const APP_URL = process.env.APP_URL
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
const DB_URL = process.env.DB_URL
const DB_TOKEN = process.env.DB_TOKEN

if (!APP_URL || !INTERNAL_API_KEY) {
  console.error("❌ APP_URL / INTERNAL_API_KEY 환경변수 필요 (.env.local)")
  process.exit(1)
}
if (!DB_URL || !DB_TOKEN) {
  console.error("❌ DB_URL / DB_TOKEN 필요")
  process.exit(1)
}

const db = createClient(DB_URL, DB_TOKEN)

// ─── CLI 인자 ────────────────────────────────────────

interface Flags {
  all: boolean
  brandId?: number
  limit?: number
  force: boolean
  dryRun: boolean
  concurrency: number
  interval: number
  retryFailed: boolean
}

function parseArgs(): Flags {
  const args = process.argv.slice(2)
  const f: Flags = {
    all: false,
    force: false,
    dryRun: false,
    concurrency: 1,
    interval: 3000,
    retryFailed: false,
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const eq = a.indexOf("=")
    const key = eq >= 0 ? a.slice(0, eq) : a
    const val = eq >= 0 ? a.slice(eq + 1) : args[i + 1]
    const consumeNext = (): string => (eq >= 0 ? val : args[++i])

    if (key === "--all") f.all = true
    else if (key === "--force") f.force = true
    else if (key === "--dry-run") f.dryRun = true
    else if (key === "--retry-failed") f.retryFailed = true
    else if (key === "--brand-id") f.brandId = parseInt(consumeNext(), 10)
    else if (key === "--limit") f.limit = parseInt(consumeNext(), 10)
    else if (key === "--concurrency") f.concurrency = parseInt(consumeNext(), 10)
    else if (key === "--interval") f.interval = parseInt(consumeNext(), 10)
  }
  if (!f.all && !f.brandId && !f.retryFailed) {
    console.error("❌ --all / --brand-id <id> / --retry-failed 중 하나 필요")
    process.exit(1)
  }
  if (f.concurrency < 1 || f.concurrency > 8) {
    console.error("❌ --concurrency 는 1~8 범위")
    process.exit(1)
  }
  if (!Number.isFinite(f.interval) || f.interval < 1000) {
    console.error("❌ --interval 은 1000ms 이상 (app 엔드포인트 self-DoS 방지)")
    process.exit(1)
  }
  return f
}

// ─── Endpoint Response 타입 ──────────────────────────

interface ClassifyResponse {
  ok: boolean
  brand_id?: number
  result?: "classified" | "queued" | "skipped"
  primary_node?: string
  secondary_node?: string | null
  confidence?: number
  model_id?: string
  latency_ms?: number
  queued_reason?: string
  skipped_reason?: string
  error?: string
}

// ─── Token bucket ───────────────────────────────────

const tokenBucket = {
  interval: 3000,
  batchSize: 4,
  queue: [] as Array<() => void>,
  timer: null as ReturnType<typeof setInterval> | null,
  rateLimitHits: 0,

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve)
      if (!this.timer) this.startDraining()
    })
  },

  startDraining() {
    this.drainBatch()
    this.timer = setInterval(() => this.drainBatch(), this.interval)
  },

  drainBatch() {
    const count = Math.min(this.batchSize, this.queue.length)
    for (let i = 0; i < count; i++) this.queue.shift()!()
  },

  onSuccess() {
    this.rateLimitHits = Math.max(0, this.rateLimitHits - 1)
    if (this.rateLimitHits === 0) {
      // 성공 누적 → 간격 5% 단축 (최소 3000ms)
      this.interval = Math.max(3000, Math.floor(this.interval * 0.95))
      this.restartTimer()
    }
  },

  onRateLimit() {
    this.rateLimitHits++
    // 429 만나면 50% 증가 (최대 30000ms)
    this.interval = Math.min(30000, Math.floor(this.interval * 1.5))
    this.restartTimer()
  },

  restartTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.queue.length > 0) this.startDraining()
  },

  stop() {
    if (this.timer) clearInterval(this.timer)
  },
}

// ─── HTTP 호출 + retry ────────────────────────────────

const FAILED_LOG = path.join("/tmp", "classify-brands-failed.jsonl")

interface FailedRow {
  brand_id: number
  brand_name?: string
  attempts: number
  last_error: string
  ts: string
}

function appendFailed(row: FailedRow) {
  fs.appendFileSync(FAILED_LOG, JSON.stringify(row) + "\n")
}

async function callClassify(
  brandId: number,
  brandName: string,
  force: boolean,
  maxRetries = 3,
): Promise<{response: ClassifyResponse | null; httpStatus: number; attempts: number}> {
  let attempts = 0
  let httpStatus = 0
  const label = `   [brand=${brandId}]`

  while (attempts < maxRetries) {
    attempts++

    // ── Step 1: token bucket 대기 ─────────────────
    const tokenStart = Date.now()
    await tokenBucket.acquire()
    const tokenWait = Date.now() - tokenStart
    console.log(
      `${label} 🎫 token acquired (waited ${tokenWait}ms, interval=${tokenBucket.interval}ms, queue=${tokenBucket.queue.length})`,
    )

    // ── Step 2: HTTP POST ─────────────────────────
    const url = `${APP_URL}/api/internal/classify-brand`
    console.log(
      `${label} 📡 POST ${url} { brand_id: ${brandId}, force: ${force} } (attempt ${attempts}/${maxRetries})`,
    )

    try {
      const fetchStart = Date.now()
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": INTERNAL_API_KEY!,
        },
        body: JSON.stringify({brand_id: brandId, force}),
      })
      const fetchMs = Date.now() - fetchStart
      httpStatus = res.status
      console.log(`${label} ⏱️  HTTP ${httpStatus} (${fetchMs}ms)`)

      const json = (await res.json().catch(() => ({}))) as ClassifyResponse
      console.log(
        `${label} 📦 result=${json.result ?? "—"} ok=${json.ok}${
          json.error ? ` error=${json.error.slice(0, 80)}` : ""
        }`,
      )

      // 200 = 정상 (classified / queued / skipped 모두 200)
      if (res.ok) {
        tokenBucket.onSuccess()
        return {response: json, httpStatus, attempts}
      }

      // 429 또는 vlm_failed(상위 모델 서비스 오류를 502로 래핑) → retry
      const errStr = json.error ?? ""
      const is429 =
        httpStatus === 429 ||
        errStr.includes("status=429") ||
        errStr.includes("rate_limit")

      if (is429 || httpStatus >= 500) {
        tokenBucket.onRateLimit()
        const backoff = Math.min(20_000, 2 ** attempts * 2000)
        if (attempts < maxRetries) {
          console.log(
            `${label} ⚠️  ${is429 ? "rate_limit" : `http_${httpStatus}`} — token bucket 간격 ${tokenBucket.interval}ms 로 증가, backoff ${backoff}ms 후 재시도`,
          )
          await sleep(backoff)
          continue
        }
        console.log(`${label} 💀 max retries (${maxRetries}) 도달 — 실패 처리`)
      } else {
        console.log(`${label} 🚫 4xx no-retry (httpStatus=${httpStatus})`)
      }

      // 4xx no-retry (400 invalid input, 404 not found 등)
      return {response: json, httpStatus, attempts}
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`${label} 🌐 network error: ${msg}`)
      if (attempts < maxRetries) {
        const backoff = 2 ** attempts * 1000
        console.log(`${label} 🔄 ${backoff}ms 후 재시도`)
        await sleep(backoff)
        continue
      }
      return {response: {ok: false, error: `network: ${msg}`}, httpStatus: 0, attempts}
    }
  }
  return {response: {ok: false, error: "max_retries_exceeded"}, httpStatus, attempts}
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── 대상 brand 수집 ────────────────────────────────

interface BrandTarget {
  id: number
  brand_name: string
}

async function fetchTargets(flags: Flags): Promise<BrandTarget[]> {
  if (flags.retryFailed) {
    if (!fs.existsSync(FAILED_LOG)) {
      console.error(`❌ 실패 로그 없음: ${FAILED_LOG}`)
      process.exit(1)
    }
    const lines = fs.readFileSync(FAILED_LOG, "utf-8").trim().split("\n").filter(Boolean)
    const ids = [...new Set(lines.map((l) => (JSON.parse(l) as FailedRow).brand_id))]
    // rotate old log (append 모드라 누적되므로)
    fs.renameSync(FAILED_LOG, FAILED_LOG + ".prev")
    const targets: BrandTarget[] = []
    const PAGE = 1000
    for (let i = 0; i < ids.length; i += PAGE) {
      const chunk = ids.slice(i, i + PAGE)
      const {data, error} = await db
        .from("brand_nodes")
        .select("id, brand_name")
        .in("id", chunk)
      if (error) {
        console.error(`❌ brand_nodes 조회 실패: ${error.message}`)
        process.exit(1)
      }
      targets.push(...((data ?? []) as BrandTarget[]))
    }
    return targets
  }

  if (flags.brandId) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id, brand_name")
      .eq("id", flags.brandId)
      .single()
    if (error || !data) {
      console.error(`❌ brand_id=${flags.brandId} 조회 실패`)
      process.exit(1)
    }
    return [data as BrandTarget]
  }

  // --all
  // products 가 1개 이상 있는 brand 만 대상 (product 0개 brand 는 분류 불가능).
  // 엑셀에서 import 됐지만 crawler 가 적재 안 한 brand 가 다수 있음 (~2,395개).
  // PostgREST 한방 쿼리로는 EXISTS 표현 어려워 RPC 또는 2-step. 여기선 2-step:
  //   ① brand_node_id 별 product 카운트 조회 (id 만)
  //   ② brand_nodes 조회 후 위 set 으로 필터
  const productBrandIds = new Set<number>()
  {
    const PAGE = 1000
    let offset = 0
    for (;;) {
      const {data, error} = await db
        .from("products")
        .select("brand_node_id")
        .not("brand_node_id", "is", null)
        .range(offset, offset + PAGE - 1)
      if (error) {
        console.error(`❌ products.brand_node_id 조회 실패: ${error.message}`)
        process.exit(1)
      }
      if (!data?.length) break
      for (const row of data) {
        if (row.brand_node_id != null) productBrandIds.add(row.brand_node_id as number)
      }
      if (data.length < PAGE) break
      offset += PAGE
    }
  }

  const targets: BrandTarget[] = []
  const PAGE = 1000
  let offset = 0
  for (;;) {
    let query = db
      .from("brand_nodes")
      .select("id, brand_name")
      .order("id", {ascending: true})
      .range(offset, offset + PAGE - 1)
    // force=false 면 미분류만 (primary_style_node_id IS NULL)
    if (!flags.force) {
      query = query.is("primary_style_node_id", null)
    }
    const {data, error} = await query
    if (error) {
      console.error(`❌ brand_nodes 조회 실패: ${error.message}`)
      process.exit(1)
    }
    if (!data?.length) break
    // products 있는 brand 만 포함
    for (const row of data as BrandTarget[]) {
      if (productBrandIds.has(row.id)) targets.push(row)
    }
    if (data.length < PAGE) break
    offset += PAGE
    if (flags.limit && targets.length >= flags.limit) break
  }
  if (flags.limit) return targets.slice(0, flags.limit)
  return targets
}

// ─── Main ────────────────────────────────────────────

interface Stats {
  classified: number
  queued: Map<string, number>
  skipped: Map<string, number>
  failed: number
  total: number
}

async function main() {
  const flags = parseArgs()
  tokenBucket.interval = flags.interval

  console.log(`\n${"━".repeat(60)}`)
  console.log(`🚀 brand 일괄 분류 시작`)
  console.log(`${"━".repeat(60)}`)
  console.log(`   📍 endpoint     : ${APP_URL}/api/internal/classify-brand`)
  console.log(`   ⚙️  concurrency  : ${flags.concurrency}`)
  console.log(`   ⏱️  initial gap  : ${flags.interval}ms (token bucket 시작값)`)
  console.log(`   🔁 force        : ${flags.force}`)
  console.log(`   🔍 dry-run      : ${flags.dryRun}`)
  console.log(`   📁 failed log   : ${FAILED_LOG}`)
  console.log(`${"━".repeat(60)}\n`)

  console.log(`📥 대상 brand 조회 중...`)
  const targets = await fetchTargets(flags)
  console.log(`   ✓ ${targets.length}개 brand 로드 완료\n`)

  if (flags.dryRun) {
    for (const t of targets.slice(0, 20)) {
      console.log(`   [${t.id}] ${t.brand_name}`)
    }
    if (targets.length > 20) console.log(`   ... (+${targets.length - 20})`)
    return
  }

  if (targets.length === 0) {
    console.log("✅ 분류 대상 없음")
    return
  }

  // 실패 로그 초기화 (이번 런)
  if (fs.existsSync(FAILED_LOG) && !flags.retryFailed) {
    fs.renameSync(FAILED_LOG, FAILED_LOG + ".prev")
  }

  const stats: Stats = {
    classified: 0,
    queued: new Map(),
    skipped: new Map(),
    failed: 0,
    total: targets.length,
  }

  let completed = 0
  const startedAt = Date.now()

  async function worker(slice: BrandTarget[]) {
    for (const t of slice) {
      const idx = completed + 1
      const elapsed0 = Math.round((Date.now() - startedAt) / 1000)
      const rate0 = idx / Math.max(elapsed0, 1)
      const eta0 = Math.round((targets.length - idx) / Math.max(rate0, 0.001))

      console.log(`${"─".repeat(60)}`)
      console.log(`🏷️  [${idx}/${targets.length}] ${t.brand_name} (brand_id=${t.id})`)
      console.log(`   📊 elapsed=${elapsed0}s, eta=${eta0}s, rate=${rate0.toFixed(2)} brand/s`)

      const {response, httpStatus, attempts} = await callClassify(t.id, t.brand_name, flags.force)
      completed++

      if (!response || !response.ok) {
        stats.failed++
        const err = response?.error ?? `http_${httpStatus}`
        console.log(`   ❌ FAILED — ${err} (attempts=${attempts})`)
        appendFailed({
          brand_id: t.id,
          brand_name: t.brand_name,
          attempts,
          last_error: err,
          ts: new Date().toISOString(),
        })
        continue
      }

      if (response.result === "classified") {
        stats.classified++
        console.log(
          `   ✅ classified — primary=${response.primary_node}, secondary=${response.secondary_node ?? "-"}, confidence=${response.confidence}, model=${response.model_id}, latency=${response.latency_ms}ms`,
        )
      } else if (response.result === "queued") {
        const reason = response.queued_reason ?? "unknown"
        stats.queued.set(reason, (stats.queued.get(reason) ?? 0) + 1)
        console.log(`   ⏸️  queued — reason=${reason}`)
      } else if (response.result === "skipped") {
        const reason = response.skipped_reason ?? "unknown"
        stats.skipped.set(reason, (stats.skipped.get(reason) ?? 0) + 1)
        console.log(`   ⏭️  skipped — reason=${reason}`)
      }
    }
  }

  // concurrency 만큼 worker 분할
  const slices: BrandTarget[][] = Array.from({length: flags.concurrency}, () => [])
  for (let i = 0; i < targets.length; i++) {
    slices[i % flags.concurrency].push(targets[i])
  }
  await Promise.all(slices.map(worker))

  tokenBucket.stop()

  // ── 통계 ─────────────────────────────────────
  const totalElapsed = Math.round((Date.now() - startedAt) / 1000)
  const queuedTotal = [...stats.queued.values()].reduce((a, b) => a + b, 0)
  const skippedTotal = [...stats.skipped.values()].reduce((a, b) => a + b, 0)
  const successRate = ((stats.classified / Math.max(stats.total, 1)) * 100).toFixed(1)

  console.log(`\n${"═".repeat(60)}`)
  console.log(`🏁 일괄 분류 완료`)
  console.log(`${"═".repeat(60)}`)
  console.log(`   ⏱️  총 시간    : ${totalElapsed}s`)
  console.log(`   🚀 평균 속도   : ${(stats.total / Math.max(totalElapsed, 1)).toFixed(2)} brand/s`)
  console.log(`   🎯 성공률      : ${successRate}% (${stats.classified}/${stats.total})`)
  console.log(``)
  console.log(`   ✅ classified : ${stats.classified}`)
  if (queuedTotal > 0) {
    console.log(`   ⏸️  queued     : ${queuedTotal}`)
    for (const [r, n] of stats.queued) console.log(`        └─ ${r}: ${n}`)
  } else {
    console.log(`   ⏸️  queued     : 0`)
  }
  if (skippedTotal > 0) {
    console.log(`   ⏭️  skipped    : ${skippedTotal}`)
    for (const [r, n] of stats.skipped) console.log(`        └─ ${r}: ${n}`)
  } else {
    console.log(`   ⏭️  skipped    : 0`)
  }
  console.log(`   ❌ failed     : ${stats.failed}`)
  console.log(`${"═".repeat(60)}\n`)

  if (stats.failed > 0) {
    console.log(`📝 실패 로그: ${FAILED_LOG}`)
    console.log(`   🔄 재실행: pnpm tsx src/classify-brands.ts --retry-failed\n`)
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err)
  tokenBucket.stop()
  process.exit(1)
})
