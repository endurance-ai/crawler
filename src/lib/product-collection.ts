import {createClient, type SupabaseClient} from "@supabase/supabase-js"

export type ProductCollectionStage = "detect" | "config" | "crawl" | "qc" | "import" | "embed" | "manual"
export type ProductCollectionRunStatus = "queued" | "running" | "success" | "failed" | "skipped"

export interface ProductCollectionTarget {
  id: number
  brand_name: string
  homepage_url: string
  gender_scope: string[]
  price_band: string
  priority: number
  planner_status: string
  planner_notes: string | null
  platform_key: string | null
  platform_type: string
  category_discovery: string
  categories: unknown[]
  detection: Record<string, unknown>
  tech_status: string
  config_status: string
  latest_artifact_path: string | null
  latest_artifact_sha256: string | null
  qc_summary: Record<string, unknown>
  last_error: string | null
  blocked_reason: string | null
  tech_notes: string | null
  updated_at: string
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

export async function startProductRun(
  db: ProductCollectionClient,
  input: {
    targetId: number
    stage: ProductCollectionStage
    command?: string
    actor?: string
    platformKey?: string | null
    status?: ProductCollectionRunStatus
  },
): Promise<number> {
  const {data, error} = await db
    .from("product_collection_runs")
    .insert({
      target_id: input.targetId,
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

  const {error} = await db.from("product_collection_runs").update(update).eq("id", runId)
  if (error) throw new Error(`failed to finish product run: ${error.message}`)
}

export async function updateProductTarget(
  db: ProductCollectionClient,
  targetId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const {error} = await db
    .from("product_collection_targets")
    .update({...patch, updated_by: patch.updated_by ?? "crawler-cli"})
    .eq("id", targetId)
  if (error) throw new Error(`failed to update product target ${targetId}: ${error.message}`)
}

export async function loadProductTarget(
  db: ProductCollectionClient,
  targetId: number,
): Promise<ProductCollectionTarget | null> {
  const {data, error} = await db
    .from("product_collection_targets")
    .select("*")
    .eq("id", targetId)
    .maybeSingle()
  if (error) throw new Error(`failed to load product target ${targetId}: ${error.message}`)
  return (data as ProductCollectionTarget | null) ?? null
}
