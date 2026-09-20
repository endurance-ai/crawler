#!/usr/bin/env npx tsx

import {PLATFORMS} from "../src/configs/platforms"
import {
  createRefreshBatch,
  finalizeRefreshBatch,
  loadRefreshProductCounts,
  syncRefreshSources,
} from "../src/lib/product-refresh"
import {createProductCollectionClient} from "../src/lib/product-collection"
import {uniqueRefreshConfigs} from "../src/lib/refresh-source"

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

async function start(): Promise<void> {
  const db = createProductCollectionClient()
  await syncRefreshSources(db, PLATFORMS)
  const counts = await loadRefreshProductCounts(db)
  const excluded = new Set(
    (process.env.REFRESH_EXCLUDE ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const sources = uniqueRefreshConfigs(PLATFORMS)
    .filter((config) => !config.disabled && !excluded.has(config.key))
    .map((config) => ({
      platformKey: config.key,
      platformType: config.type,
      productCount: counts.get(config.key) ?? 0,
    }))
    .filter((source) => source.productCount > 0)
  const deadline = flag("deadline-at")
  if (!deadline) throw new Error("--deadline-at=<ISO timestamp> is required")
  const scheduledFor = flag("scheduled-for") ?? todayKst()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) {
    throw new Error("--scheduled-for=<YYYY-MM-DD> is invalid")
  }
  const {data: current, error: currentError} = await db
    .from("product_refresh_batches")
    .select("id,status")
    .eq("scheduled_for", scheduledFor)
    .order("id", {ascending: false})
    .limit(1)
    .maybeSingle()
  if (currentError) throw new Error(`refresh batch resume lookup failed: ${currentError.message}`)
  if (current) {
    const batchId = Number((current as {id: number}).id)
    const {error: resumeError} = await db
      .from("product_refresh_batches")
      .update({status: "running", ended_at: null, deadline_at: deadline})
      .eq("id", batchId)
    if (resumeError) throw new Error(`refresh batch resume failed: ${resumeError.message}`)
    console.log(String(batchId))
    return
  }
  const id = await createRefreshBatch(db, {
    scheduledFor,
    deadlineAt: deadline,
    sources,
    metrics: {excluded: [...excluded]},
  })
  console.log(String(id))
}

async function finalize(): Promise<void> {
  const rawId = flag("id")
  if (!rawId || !/^\d+$/.test(rawId)) throw new Error("--id=<batch id> is required")
  const result = await finalizeRefreshBatch(createProductCollectionClient(), Number(rawId))
  console.log(JSON.stringify(result))
}

async function main(): Promise<void> {
  if (has("start") === has("finalize")) {
    throw new Error("use exactly one of --start or --finalize")
  }
  if (has("start")) await start()
  else await finalize()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
