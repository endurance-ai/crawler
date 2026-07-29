import {createClient, type SupabaseClient} from "@supabase/supabase-js"

export type ProductCollectionStage =
  | "detect"
  | "config"
  | "crawl"
  | "image_select"
  | "qc"
  | "import"
  | "embed"
  | "manual"
export type ProductCollectionRunStatus = "queued" | "running" | "success" | "failed" | "skipped"

export interface ProductCrawlBrand {
  brand_node_id: number
  brand_name: string
  brand_name_normalized: string | null
  gender_scope: string[] | null
  source_platforms: string[] | null
  price_min_usd: number | string | null
  price_max_usd: number | string | null
  wiki: Record<string, unknown> | null
  homepage_url: string | null
  wiki_status: string | null
  brand_updated_at: string | null
  status_created_at: string | null
  status_updated_at: string | null
  has_status_row: boolean
  status: string
  config_status: string
  platform_key: string | null
  platform_type: string
  category_discovery: string
  categories: unknown[]
  detection: Record<string, unknown>
  latest_artifact_path: string | null
  latest_artifact_sha256: string | null
  qc_summary: Record<string, unknown>
  last_error: string | null
  blocked_reason: string | null
  notes: string | null
  detected_at: string | null
  crawled_at: string | null
  imported_at: string | null
  embedded_at: string | null
}

export type ProductCollectionClient = SupabaseClient

export function createProductCollectionClient(): ProductCollectionClient {
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) {
    throw new Error("DB_URL and DB_TOKEN are required")
  }
  return createClient(dbUrl, dbToken)
}

export async function loadProductCrawlBrand(
  db: ProductCollectionClient,
  brandNodeId: number,
): Promise<ProductCrawlBrand | null> {
  const {data, error} = await db
    .from("product_crawl_brands")
    .select("*")
    .eq("brand_node_id", brandNodeId)
    .maybeSingle()
  if (error) throw new Error(`failed to load brand_node ${brandNodeId}: ${error.message}`)
  return (data as ProductCrawlBrand | null) ?? null
}

export async function startProductRun(
  db: ProductCollectionClient,
  input: {
    brandNodeId: number
    stage: ProductCollectionStage
    command?: string
    actor?: string
    platformKey?: string | null
    status?: ProductCollectionRunStatus
  },
): Promise<number> {
  const {data, error} = await db
    .from("product_crawl_runs")
    .insert({
      brand_node_id: input.brandNodeId,
      stage: input.stage,
      status: input.status ?? "running",
      command: input.command ?? process.argv.join(" "),
      actor: input.actor ?? "crawler-cli",
      platform_key: input.platformKey ?? null,
    })
    .select("id")
    .single()

  if (error || !data) {
    throw new Error(`failed to start product run: ${error?.message ?? "no data"}`)
  }
  return (data as {id: number}).id
}

export async function finishProductRun(
  db: ProductCollectionClient,
  runId: number,
  patch: {
    status: ProductCollectionRunStatus
    metrics?: Record<string, unknown>
    artifactPath?: string | null
    errorMessage?: string | null
    startedAt?: number
  },
): Promise<void> {
  const endedAt = new Date()
  const update: Record<string, unknown> = {
    status: patch.status,
    ended_at: endedAt.toISOString(),
    metrics: patch.metrics ?? {},
    artifact_path: patch.artifactPath ?? null,
    error_message: patch.errorMessage ?? null,
  }
  if (patch.startedAt) update.duration_ms = Date.now() - patch.startedAt

  const {error} = await db.from("product_crawl_runs").update(update).eq("id", runId)
  if (error) throw new Error(`failed to finish product run: ${error.message}`)
}

export async function upsertProductCrawlStatus(
  db: ProductCollectionClient,
  brandNodeId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const {error} = await db
    .from("product_crawl_status")
    .upsert({brand_node_id: brandNodeId, ...patch}, {onConflict: "brand_node_id"})
  if (error) throw new Error(`failed to update product crawl status ${brandNodeId}: ${error.message}`)
}
