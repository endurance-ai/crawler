import type {SupabaseClient} from "@supabase/supabase-js"

import {
  buildRefreshCandidateInputs,
  uniqueRefreshConfigs,
  type BrandLookupRow,
  type RefreshSourceState,
} from "./refresh-source"
import type {Product, SiteConfig} from "./types"

export type ProductRefreshClient = SupabaseClient

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
  )
  if (error) throw new Error(`refresh source sync failed: ${error.message}`)
}

export async function loadRefreshSourceStates(
  db: ProductRefreshClient,
): Promise<RefreshSourceState[]> {
  const rows: RefreshSourceState[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("product_refresh_sources")
      .select("platform_key,last_attempted_at")
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`refresh source state load failed: ${error.message}`)
    const page = (data ?? []) as RefreshSourceState[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

export async function loadRefreshProductCounts(
  db: ProductRefreshClient,
): Promise<Map<string, number>> {
  const {data, error} = await db.rpc("product_refresh_source_stats")
  if (error) throw new Error(`refresh source stats failed: ${error.message}`)
  return new Map(
    ((data ?? []) as Array<{platform_key: string; product_count: number | string}>)
      .map((row) => [row.platform_key, Number(row.product_count)]),
  )
}

export async function startRefreshRun(
  db: ProductRefreshClient,
  input: {platformKey: string; command?: string},
): Promise<{id: number; startedAt: number}> {
  const startedAt = Date.now()
  const now = new Date(startedAt).toISOString()
  const {data, error} = await db
    .from("product_refresh_runs")
    .insert({
      platform_key: input.platformKey,
      status: "running",
      command: input.command ?? process.argv.join(" "),
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`refresh run start failed: ${error?.message ?? "no data"}`)
  const {error: sourceError} = await db
    .from("product_refresh_sources")
    .update({last_attempted_at: now, last_status: "running", last_error: null})
    .eq("platform_key", input.platformKey)
  if (sourceError) throw new Error(`refresh source start update failed: ${sourceError.message}`)
  return {id: Number((data as {id: number}).id), startedAt}
}

export async function finishRefreshRun(
  db: ProductRefreshClient,
  input: {
    id: number
    platformKey: string
    status: "success" | "failed" | "skipped"
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
  if (sourceError) throw new Error(`refresh source finish update failed: ${sourceError.message}`)
}

export async function loadExistingBrands(
  db: ProductRefreshClient,
): Promise<BrandLookupRow[]> {
  const rows: BrandLookupRow[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id,brand_name,brand_name_normalized")
      .range(offset, offset + pageSize - 1)
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
  const {error} = await db
    .from("product_refresh_candidates")
    .upsert(rows, {
      onConflict: "platform_key,identity_key",
      ignoreDuplicates: true,
    })
  if (error) throw new Error(`refresh candidate enqueue failed: ${error.message}`)
  return {
    discovered: rows.filter((row) => row.status === "discovered").length,
    brandUnmatched: rows.filter((row) => row.status === "brand_unmatched").length,
  }
}
