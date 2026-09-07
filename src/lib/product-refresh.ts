import type {SupabaseClient} from "@supabase/supabase-js"

import {
  buildRefreshCandidateInputs,
  uniqueRefreshConfigs,
  type BrandLookupRow,
  type RefreshRunOutcome,
  type RefreshSourceState,
} from "./refresh-source"
import type {Cafe24ListingCursor, Product, SiteConfig} from "./types"

export type ProductRefreshClient = SupabaseClient

export interface RefreshBatchSource {
  batch_id: number
  platform_key: string
  platform_type: string
  product_count: number
  status: "pending" | "running" | "partial" | "success" | "exception"
  attempts: number
  exception_code: string | null
  exception_message: string | null
}

export interface RefreshBatch {
  id: number
  deadline_at: string
  status: "running" | "success" | "completed_with_exceptions" | "failed"
}

const DB_READ_TIMEOUT_MS = 20_000
const DB_TELEMETRY_TIMEOUT_MS = 10_000
const DB_AUX_WRITE_TIMEOUT_MS = 20_000
const DB_CANDIDATE_TIMEOUT_MS = 45_000

export async function syncRefreshSources(
  db: ProductRefreshClient,
  configs: SiteConfig[],
): Promise<void> {
  const uniqueConfigs = uniqueRefreshConfigs(configs)
  if (uniqueConfigs.length === 0) return
  const {error} = await db.from("product_refresh_sources").upsert(
    uniqueConfigs.map((config) => ({
      platform_key: config.key,
      platform_type: config.type,
      base_url: config.baseUrl,
      enabled: !config.disabled,
    })),
    {onConflict: "platform_key"},
  ).abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
  if (error) throw new Error(`refresh source sync failed: ${error.message}`)
}

export async function loadRefreshBatchSources(
  db: ProductRefreshClient,
  batchId: number,
): Promise<RefreshBatchSource[]> {
  const {data, error} = await db
    .from("product_refresh_batch_sources")
    .select("batch_id,platform_key,platform_type,product_count,status,attempts,exception_code,exception_message")
    .eq("batch_id", batchId)
    .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
  if (error) throw new Error(`refresh batch source load failed: ${error.message}`)
  return (data ?? []) as RefreshBatchSource[]
}

export async function markRefreshBatchSourceStarted(
  db: ProductRefreshClient,
  input: {batchId: number; platformKey: string; attempts: number},
): Promise<void> {
  const {error} = await db
    .from("product_refresh_batch_sources")
    .update({status: "running", attempts: input.attempts, exception_code: null, exception_message: null})
    .eq("batch_id", input.batchId)
    .eq("platform_key", input.platformKey)
    .neq("status", "success")
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (error) throw new Error(`refresh batch source start failed: ${error.message}`)
}

export async function createRefreshBatch(
  db: ProductRefreshClient,
  input: {
    scheduledFor: string
    deadlineAt: string
    sources: Array<{platformKey: string; platformType: string; productCount: number}>
    metrics?: Record<string, unknown>
  },
): Promise<number> {
  const expectedProductCount = input.sources.reduce((sum, source) => sum + source.productCount, 0)
  const {data, error} = await db
    .from("product_refresh_batches")
    .insert({
      scheduled_for: input.scheduledFor,
      deadline_at: input.deadlineAt,
      expected_source_count: input.sources.length,
      expected_product_count: expectedProductCount,
      metrics: input.metrics ?? {},
    })
    .select("id")
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
    .single()
  if (error || !data) throw new Error(`refresh batch create failed: ${error?.message ?? "no data"}`)
  const batchId = Number((data as {id: number}).id)
  if (input.sources.length > 0) {
    const {error: sourceError} = await db
      .from("product_refresh_batch_sources")
      .insert(input.sources.map((source) => ({
        batch_id: batchId,
        platform_key: source.platformKey,
        platform_type: source.platformType,
        product_count: source.productCount,
      })))
      .abortSignal(AbortSignal.timeout(DB_AUX_WRITE_TIMEOUT_MS))
    if (sourceError) throw new Error(`refresh batch sources create failed: ${sourceError.message}`)
  }
  return batchId
}

export async function finalizeRefreshBatch(
  db: ProductRefreshClient,
  batchId: number,
): Promise<{status: string; pending: number; success: number; exceptions: number}> {
  const {data: rows, error: readError} = await db
    .from("product_refresh_batch_sources")
    .select("status,product_count")
    .eq("batch_id", batchId)
    .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
  if (readError) throw new Error(`refresh batch finalize load failed: ${readError.message}`)
  const sourceRows = (rows ?? []) as Array<{status: RefreshBatchSource["status"]; product_count: number}>
  const pending = sourceRows.filter((row) => row.status === "pending" || row.status === "running" || row.status === "partial").length
  const success = sourceRows.filter((row) => row.status === "success").length
  const exceptions = sourceRows.filter((row) => row.status === "exception").length
  const successProductCount = sourceRows
    .filter((row) => row.status === "success")
    .reduce((sum, row) => sum + Number(row.product_count ?? 0), 0)
  const status = pending > 0 ? "failed" : exceptions > 0 ? "completed_with_exceptions" : "success"
  const {error} = await db
    .from("product_refresh_batches")
    .update({
      status,
      ended_at: new Date().toISOString(),
      success_source_count: success,
      exception_source_count: exceptions,
      success_product_count: successProductCount,
    })
    .eq("id", batchId)
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (error) throw new Error(`refresh batch finalize failed: ${error.message}`)
  return {status, pending, success, exceptions}
}

export async function finishRefreshBatchSource(
  db: ProductRefreshClient,
  input: {
    batchId: number
    platformKey: string
    runId?: number
    status: "partial" | "success" | "exception"
    exceptionCode?: string | null
    exceptionMessage?: string | null
  },
): Promise<void> {
  const {error} = await db
    .from("product_refresh_batch_sources")
    .update({
      status: input.status,
      last_run_id: input.runId ?? null,
      exception_code: input.exceptionCode ?? null,
      exception_message: input.exceptionMessage ?? null,
    })
    .eq("batch_id", input.batchId)
    .eq("platform_key", input.platformKey)
    .neq("status", "success")
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (error) throw new Error(`refresh batch source finish failed: ${error.message}`)
}

export async function loadRefreshSourceStates(
  db: ProductRefreshClient,
): Promise<RefreshSourceState[]> {
  const rows: RefreshSourceState[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("product_refresh_sources")
      .select(
        "platform_key,last_attempted_at,refresh_cursor,refresh_cycle_started_at,refresh_cycle_degraded",
      )
      .range(offset, offset + pageSize - 1)
      .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
    if (error) throw new Error(`refresh source state load failed: ${error.message}`)
    const page = (data ?? []) as RefreshSourceState[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

/**
 * PostgREST 는 PATCH 필터를 쿼리스트링에 싣는다. `in.(...)` 에 URL 을 몇 개
 * 넣을지 개수로 정하면 안 된다 — cafe24 rewrite URL 은 한글 슬러그가
 * 퍼센트 인코딩되어 개당 250 자를 넘기기도 한다. 그래서 바이트 예산으로 자른다.
 * nginx 기본 `large_client_header_buffers 4 8k` 보다 넉넉히 아래로 잡았다.
 */
const LAST_SEEN_FILTER_BUDGET_BYTES = 2000

export function chunkByEncodedLength(
  values: string[],
  budgetBytes = LAST_SEEN_FILTER_BUDGET_BYTES,
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0
  for (const value of values) {
    // +3 = 인코딩된 값 사이의 구분자·인용부호 여유분.
    const cost = encodeURIComponent(value).length + 3
    if (current.length > 0 && size + cost > budgetBytes) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(value)
    size += cost
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * PostgREST 로 보내는 **본문(body)** 예산. 위 `LAST_SEEN_FILTER_BUDGET_BYTES` 는
 * 쿼리스트링용이라 여기 쓸 수 없다 — 한도가 걸리는 곳이 다르다.
 *
 * nginx 기본 `client_max_body_size` 는 1MB 다. 배열 구분자·헤더 여유를 두고 절반으로
 * 실측(2026-08-01) 후보 1행의 `raw_product` 는 평균 792B · p95 2.3KB 다.
 * 연구실→dev-app 공인망에서 512KB 요청이 nginx 408로 끊긴 이력이 있어 128KB로
 * 낮춘다. 요청 수보다 한 청크 실패의 영향 범위를 줄이는 쪽을 택한다.
 */
const UPSERT_BODY_BUDGET_BYTES = 128_000

/**
 * 행 배열을 직렬화 크기 기준으로 자른다.
 *
 * 왜 개수가 아니라 크기인가: 후보 행은 `raw_product`(Product 전체 JSON)를 통째로
 * 싣는다. 이미지 배열 길이에 따라 행 크기가 수 배 차이 나므로 개수로 자르면
 * 어떤 소스에서는 여전히 한도를 넘는다.
 *
 * 한 행이 예산보다 커도 버리지 않는다 — 단독 청크로 보내고 결과는 서버가 정한다.
 * 조용히 누락시키는 것보다 413 이 나는 편이 낫다.
 */
export function chunkRowsByJsonSize<T>(
  rows: T[],
  budgetBytes = UPSERT_BODY_BUDGET_BYTES,
): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let size = 0
  for (const row of rows) {
    // +1 = 배열 구분자.
    const cost = Buffer.byteLength(JSON.stringify(row), "utf8") + 1
    if (current.length > 0 && size + cost > budgetBytes) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(row)
    size += cost
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * 이번 리스트에서 살아있음이 확인된 상품의 `last_seen_at` 을 올린다.
 *
 * 왜 필요한가: `applyUpdates` 는 **변경된 행만** 쓴다(실측 평균 32행/런). 값이
 * 그대로인 상품은 `updated_at` 조차 안 올라가므로, 지금 DB 에는 상품별 생존
 * 신호가 아예 없다. 그 결과 `docs/operations.md` §6 의 soft-delete sweep 스펙을
 * 그대로 실행하면 재고 상품 88,411 중 75,235(85%)가 품절 처리된다 (실측
 * 2026-07-30). sweep 을 만들기 전에 이 타임스탬프를 먼저 믿을 수 있게 해야 한다.
 *
 * 부분 실패한 크롤에서도 호출해도 된다 — 확인된 상품은 실제로 살아있고, 사라진
 * 상품을 죽이는 판단(완전성 가드)과는 별개다.
 */
export async function touchProductsLastSeen(
  db: ProductRefreshClient,
  productUrls: string[],
  seenAt: string,
): Promise<{ok: number; failed: number}> {
  let ok = 0
  let failed = 0
  for (const chunk of chunkByEncodedLength(productUrls)) {
    const {error} = await db
      .from("products")
      .update({last_seen_at: seenAt})
      .in("product_url", chunk)
      .abortSignal(AbortSignal.timeout(DB_AUX_WRITE_TIMEOUT_MS))
    if (error) {
      failed += chunk.length
      if (failed <= chunk.length) console.error(`   ❌ last_seen_at 갱신 실패: ${error.message}`)
    } else {
      ok += chunk.length
    }
  }
  return {ok, failed}
}

/**
 * 서킷브레이커용 런 이력. 조회 창을 두는 이유는 두 가지다 — 이력 테이블이 무한히
 * 커져도 요청 수가 일정하고, 창보다 오래된 성공은 "지금 살아있다" 는 근거가 못 된다.
 * 창 안에 아무 기록이 없으면 스트릭이 안 잡혀 그대로 시도된다 (fail-open).
 */
export async function loadRefreshRunOutcomes(
  db: ProductRefreshClient,
  lookbackDays = 30,
): Promise<RefreshRunOutcome[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 3_600_000).toISOString()
  const rows: RefreshRunOutcome[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("product_refresh_runs")
      .select("platform_key,status,started_at,metrics")
      .gte("started_at", since)
      .order("started_at", {ascending: false})
      .range(offset, offset + pageSize - 1)
      .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
    if (error) throw new Error(`refresh run history load failed: ${error.message}`)
    // metrics 는 jsonb 라 그대로 두면 RefreshRunOutcome 과 모양이 다르다 —
    // 서킷브레이커가 보는 unreachable_only 만 평평하게 끌어올린다.
    const page = (data ?? []) as Array<RefreshRunOutcome & {metrics?: Record<string, unknown> | null}>
    rows.push(
      ...page.map((row) => ({
        platform_key: row.platform_key,
        status: row.status,
        started_at: row.started_at,
        unreachable_only: Boolean(row.metrics?.unreachable_only),
        db_partial_only: Boolean(row.metrics?.db_partial_only),
      })),
    )
    if (page.length < pageSize) break
  }
  return rows
}

export async function loadRefreshProductCounts(
  db: ProductRefreshClient,
): Promise<Map<string, number>> {
  const {data, error} = await db
    .rpc("product_refresh_source_stats")
    .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
  if (error) throw new Error(`refresh source stats failed: ${error.message}`)
  return new Map(
    ((data ?? []) as Array<{platform_key: string; product_count: number | string}>)
      .map((row) => [row.platform_key, Number(row.product_count)]),
  )
}

export async function startRefreshRun(
  db: ProductRefreshClient,
  input: {platformKey: string; command?: string; batchId?: number},
): Promise<{id: number; startedAt: number; sourceStateError: string | null}> {
  const startedAt = Date.now()
  const now = new Date(startedAt).toISOString()
  const {data, error} = await db
    .from("product_refresh_runs")
    .insert({
      platform_key: input.platformKey,
      status: "running",
      command: input.command ?? process.argv.join(" "),
      batch_id: input.batchId ?? null,
    })
    .select("id")
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
    .single()
  if (error || !data) throw new Error(`refresh run start failed: ${error?.message ?? "no data"}`)
  const {error: sourceError} = await db
    .from("product_refresh_sources")
    .update({last_attempted_at: now, last_status: "running", last_error: null})
    .eq("platform_key", input.platformKey)
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  return {
    id: Number((data as {id: number}).id),
    startedAt,
    sourceStateError: sourceError?.message ?? null,
  }
}

export async function startOrResumeRefreshCycle(
  db: ProductRefreshClient,
  input: {platformKey: string; existingStartedAt: string | null},
): Promise<string> {
  if (input.existingStartedAt) return input.existingStartedAt
  const startedAt = new Date().toISOString()
  const {error} = await db
    .from("product_refresh_sources")
    .update({
      refresh_cycle_started_at: startedAt,
      refresh_cursor: null,
      refresh_cycle_degraded: false,
    })
    .eq("platform_key", input.platformKey)
    .is("refresh_cycle_started_at", null)
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (error) throw new Error(`refresh cycle start failed: ${error.message}`)
  return startedAt
}

export async function checkpointRefreshCycle(
  db: ProductRefreshClient,
  input: {
    platformKey: string
    cycleStartedAt: string
    cursor: Cafe24ListingCursor
    degraded: boolean
  },
): Promise<void> {
  const {error} = await db
    .from("product_refresh_sources")
    .update({
      refresh_cursor: input.cursor,
      refresh_cycle_started_at: input.cycleStartedAt,
      refresh_cycle_degraded: input.degraded,
      last_status: "partial",
      last_error: null,
    })
    .eq("platform_key", input.platformKey)
    .eq("refresh_cycle_started_at", input.cycleStartedAt)
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (error) throw new Error(`refresh cycle checkpoint failed: ${error.message}`)
}

export async function finalizeRefreshCycle(
  db: ProductRefreshClient,
  input: {platformKey: string; cycleStartedAt: string; markMissingOutOfStock: boolean},
): Promise<number> {
  const {data, error} = await db
    .rpc("finalize_product_refresh_cycle", {
      p_platform_key: input.platformKey,
      p_cycle_started_at: input.cycleStartedAt,
      p_mark_missing_out_of_stock: input.markMissingOutOfStock,
    })
    .abortSignal(AbortSignal.timeout(DB_AUX_WRITE_TIMEOUT_MS))
  if (error) throw new Error(`refresh cycle finalize failed: ${error.message}`)
  return Number(data ?? 0)
}

export async function reconcileStaleRefreshRuns(
  db: ProductRefreshClient,
  before: string,
): Promise<number> {
  const {data, error} = await db
    .rpc("reconcile_stale_product_refresh_runs", {p_before: before})
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (error) throw new Error(`stale refresh reconciliation failed: ${error.message}`)
  return Number(data ?? 0)
}

export async function finishRefreshRun(
  db: ProductRefreshClient,
  input: {
    id: number
    platformKey: string
    status: "partial" | "success" | "failed" | "skipped"
    metrics?: Record<string, unknown>
    errorMessage?: string | null
    startedAt: number
  },
): Promise<void> {
  const now = new Date().toISOString()
  const {error} = await db
    .from("product_refresh_runs")
    .update({
      status: input.status,
      ended_at: now,
      duration_ms: Date.now() - input.startedAt,
      metrics: input.metrics ?? {},
      error_message: input.errorMessage ?? null,
    })
    .eq("id", input.id)
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (error) throw new Error(`refresh run finish failed: ${error.message}`)

  const sourcePatch: Record<string, unknown> = {
    last_status: input.status,
    last_error: input.errorMessage ?? null,
  }
  if (input.status === "success") sourcePatch.last_succeeded_at = now
  const {error: sourceError} = await db
    .from("product_refresh_sources")
    .update(sourcePatch)
    .eq("platform_key", input.platformKey)
    .abortSignal(AbortSignal.timeout(DB_TELEMETRY_TIMEOUT_MS))
  if (sourceError) throw new Error(`refresh source finish update failed: ${sourceError.message}`)
}

/**
 * 2026-07-29 버그 수정: `ORDER BY` 없는 `LIMIT/OFFSET` 페이지네이션은 페이지 사이에
 * 정렬 순서가 안정적이라는 보장이 없다 — Postgres 는 그 경우 결과 순서를 보장하지
 * 않으므로, 페이지 경계에서 행이 중복되거나 통째로 누락될 수 있다. brand_nodes 하나가
 * 누락되면 그 브랜드의 신규 상품이 전량 brand_unmatched 로 파킹된다.
 */
export async function loadExistingBrands(
  db: ProductRefreshClient,
): Promise<BrandLookupRow[]> {
  const rows: BrandLookupRow[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id,brand_name,brand_name_normalized")
      .order("id", {ascending: true})
      .range(offset, offset + pageSize - 1)
      .abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS))
    if (error) throw new Error(`brand lookup load failed: ${error.message}`)
    const page = (data ?? []) as BrandLookupRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

export async function enqueueRefreshCandidates(
  db: ProductRefreshClient,
  input: {
    products: Product[]
    config: SiteConfig
    brands: BrandLookupRow[]
  },
): Promise<{discovered: number; brandUnmatched: number}> {
  const rows = buildRefreshCandidateInputs(
    input.products as Array<Product & Record<string, unknown>>,
    input.config,
    input.brands,
  )
  if (rows.length === 0) return {discovered: 0, brandUnmatched: 0}
  // 한 번에 보내면 큰 소스에서 nginx 413 이 난다. 실측 2026-08-01: browns 는
  // 크롤 자체는 807초 동안 정상이었는데 이 upsert 에서 매번 죽어 **후보가 한 건도
  // 적재된 적이 없었다**(0건). 런이 failed 로 끝나니 완전성 가드도 성공 이력을
  // 못 쌓아, 재고 7,426건이 갱신 없이 방치됐다.
  for (const chunk of chunkRowsByJsonSize(rows)) {
    const {error} = await db
      .from("product_refresh_candidates")
      .upsert(chunk, {
        onConflict: "platform_key,identity_key",
        ignoreDuplicates: true,
      })
      .abortSignal(AbortSignal.timeout(DB_CANDIDATE_TIMEOUT_MS))
    // upsert 는 ignoreDuplicates 라 다음 정기 refresh가 같은 후보를 다시 보내도 안전하다.
    if (error) throw new Error(`refresh candidate enqueue failed: ${error.message}`)
  }
  return {
    discovered: rows.filter((row) => row.status === "discovered").length,
    brandUnmatched: rows.filter((row) => row.status === "brand_unmatched").length,
  }
}
