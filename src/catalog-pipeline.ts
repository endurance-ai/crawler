/** Drain durable product catalog jobs through image, VLM, embedding and matching stages. */
import {execFile} from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import {promisify} from "node:util"
import {createClient} from "@supabase/supabase-js"

const execFileAsync = promisify(execFile)
type Job = {product_id: number | string; platform: string; generation: number; attempts: number}

const valueArg = (name: string): string | null => {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}
const requestedPlatforms = (valueArg("platforms") ?? valueArg("platform") ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean)
const drain = process.argv.includes("--drain")
const matchMode = process.env.CATALOG_MATCH_MODE === "apply" ? "apply" : "shadow"
const limit = Math.max(1, Math.min(1000, Number(valueArg("limit") ?? "200")))
if (!drain && requestedPlatforms.length === 0) throw new Error("--platforms=<keys> or --drain is required")

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

async function logPipelineHealth(point: "start" | "end"): Promise<void> {
  const {data, error} = await db.rpc("product_pipeline_health")
  if (error) {
    console.warn(`pipeline health unavailable point=${point}: ${error.message}`)
    return
  }
  console.log(`pipeline-health ${JSON.stringify({point, ...data})}`)
}

async function runTs(entrypoint: string, args: string[]): Promise<void> {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", entrypoint, ...args], {
    cwd: process.cwd(), env: process.env, maxBuffer: 4_000_000,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function claim(): Promise<Job[]> {
  const {data, error} = await db.rpc("claim_product_catalog_jobs", {
    p_limit: limit,
    p_platforms: requestedPlatforms.length === 0 ? null : requestedPlatforms,
    p_lease_seconds: 14_400,
  })
  if (error) throw error
  return (data ?? []) as Job[]
}

async function embed(platforms: string[]): Promise<void> {
  const aiServerDir = process.env.AI_SERVER_DIR ?? path.resolve(process.cwd(), "..", "ai-server")
  const uv = process.env.UV_BIN ?? "uv"
  let dsn = process.env.KIKOAI_DEVAPP_DSN ?? process.env.DB_DSN
  if (!dsn) {
    const envPath = path.join(aiServerDir, ".env.local")
    if (fs.existsSync(envPath)) {
      const line = fs.readFileSync(envPath, "utf8").split(/\r?\n/)
        .find((entry) => /^DB_DSN=/.test(entry.trim()))
      dsn = line?.trim().slice("DB_DSN=".length).trim().replace(/^(['"])(.*)\1$/, "$2")
    }
  }
  if (!dsn) throw new Error("KIKOAI_DEVAPP_DSN or ai-server .env.local DB_DSN is required")
  const result = await execFileAsync(uv, [
    "run", "python", "scripts/embed_batch_devapp.py", `--platform=${platforms.join(",")}`,
  ], {
    cwd: aiServerDir,
    env: {...process.env, KIKOAI_DEVAPP_DSN: dsn},
    maxBuffer: 8_000_000,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function readyProductIds(ids: Array<number | string>): Promise<Set<string>> {
  const [products, features, embeddings, offers] = await Promise.all([
    db.from("products").select("id,image_selection_version,image_selected_at").in("id", ids),
    db.from("product_features").select("product_id,feature_metadata").in("product_id", ids),
    db.from("product_embeddings").select("product_id").in("product_id", ids),
    db.from("product_offers").select("source_product_id").in("source_product_id", ids),
  ])
  if (products.error) throw products.error
  if (features.error) throw features.error
  if (embeddings.error) throw embeddings.error
  if (offers.error) throw offers.error
  const selected = new Set((products.data ?? []).filter((row) =>
    row.image_selection_version && row.image_selected_at).map((row) => String(row.id)))
  const colored = new Set((features.data ?? []).filter((row) =>
    typeof row.feature_metadata?.primary_color === "string").map((row) => String(row.product_id)))
  const embedded = new Set((embeddings.data ?? []).map((row) => String(row.product_id)))
  const cataloged = new Set((offers.data ?? []).map((row) => String(row.source_product_id)))
  return new Set([...selected].filter((id) => colored.has(id) && embedded.has(id) && cataloged.has(id)))
}

async function finish(job: Job, success: boolean, error?: string): Promise<void> {
  const result = success
    ? await db.rpc("complete_product_catalog_job", {
        p_product_id: job.product_id, p_generation: job.generation,
      })
    : await db.rpc("retry_product_catalog_job", {
        p_product_id: job.product_id, p_generation: job.generation,
        p_error: error ?? "catalog assets are not ready", p_max_attempts: 3,
      })
  if (result.error) throw result.error
}

async function processJobs(jobs: Job[]): Promise<{ready: number; retry: number}> {
  const ids = jobs.map((job) => job.product_id)
  const platforms = [...new Set(jobs.map((job) => job.platform))]
  const stageErrors: string[] = []
  const runStage = async (name: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      stageErrors.push(`${name}: ${message}`)
      console.error(`catalog stage failed stage=${name}: ${message}`)
    }
  }

  try {
    await runStage("image", () => runTs("src/select-product-images.ts", [
      "--from-db", "--apply", "--no-detail", `--product-ids=${ids.join(",")}`,
    ]))
    // Every source product gets a stable singleton/offer before optional
    // cross-shop merging. Asset failures must not make the product disappear.
    await runStage("catalog", () => runTs("src/sync-catalog.ts", [
      `--product-ids=${ids.join(",")}`, "--force-singleton",
    ]))
    await runStage("features", () => runTs("src/enrich-product-features.ts", [
      "--apply", `--product-ids=${ids.join(",")}`, `--limit=${ids.length}`,
    ]))
    await runStage("embedding", () => embed(platforms))
    const ready = await readyProductIds(ids)
    for (const platform of platforms) {
      await runStage(`matching:${platform}`, () => runTs("src/match-catalog-cross-shop.ts", [
        `--platform=${platform}`, ...(matchMode === "apply" ? ["--apply"] : []),
      ]))
    }
    const finishErrors: string[] = []
    for (const job of jobs) {
      const isReady = ready.has(String(job.product_id))
      const missingMessage = [
        "image selection, catalog offer, color feature, or embedding is missing",
        ...stageErrors,
      ].join(" | ")
      try {
        await finish(job, isReady, isReady ? undefined : missingMessage)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        finishErrors.push(`product_id=${job.product_id}: ${message}`)
      }
    }
    console.log(`catalog pipeline ready=${ready.size}/${jobs.length} stage_errors=${stageErrors.length} matchMode=${matchMode} platforms=${platforms.join(",")}`)
    if (finishErrors.length > 0) throw new Error(`catalog job acknowledgements failed: ${finishErrors.join(" | ")}`)
    return {ready: ready.size, retry: jobs.length - ready.size}
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await Promise.all(jobs.map((job) => finish(job, false, message)))
    throw error
  }
}

async function main(): Promise<void> {
  let total = 0
  let ready = 0
  let retry = 0
  await logPipelineHealth("start")
  try {
    do {
      const jobs = await claim()
      if (jobs.length === 0) break
      total += jobs.length
      const result = await processJobs(jobs)
      ready += result.ready
      retry += result.retry
      if (!drain) break
    } while (true)
    console.log(`catalog pipeline claimed=${total} ready=${ready} retry=${retry}`)
  } finally {
    await logPipelineHealth("end")
  }
}

main().catch((error) => {
  console.error("catalog pipeline failed", error)
  process.exitCode = 1
})
