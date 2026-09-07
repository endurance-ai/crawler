#!/usr/bin/env npx tsx

import {PLATFORMS} from "../src/configs/platforms"
import {
  createRefreshBatch,
  finalizeRefreshBatch,
  loadRefreshProductCounts,
  syncRefreshSources,
} from "../src/lib/product-refresh"
import {createProductCollectionClient} from "../src/lib/product-collection"

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
  const sources = PLATFORMS
    .filter((config) => !config.disabled && !excluded.has(config.key))
    .map((config) => ({
      platformKey: config.key,
      platformType: config.type,
      productCount: counts.get(config.key) ?? 0,
    }))
    .filter((source) => source.productCount > 0)
  const deadline = flag("deadline-at")
  if (!deadline) throw new Error("--deadline-at=<ISO timestamp> is required")
  const id = await createRefreshBatch(db, {
    scheduledFor: todayKst(),
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
