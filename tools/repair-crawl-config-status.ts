#!/usr/bin/env npx tsx
/**
 * Backfills a stale `product_crawl_status.config_status` for cafe24 rows that
 * are already `status='imported'` but never got `config_status` synced to
 * "ready"/"blocked" — legacy rows imported before import-products.ts started
 * writing that field (see CLAUDE.md §"Product Crawl Status Sync"). This does
 * NOT touch `status`; it only recomputes config_status/platform_type from the
 * current SiteConfig, exactly like syncProductCrawlStatus does on a fresh
 * import.
 */
import * as fs from "node:fs"
import * as path from "node:path"

import {getSiteConfig} from "../src/configs/platforms"
import {queuePlatformType} from "../src/lib/platform-config-lifecycle"
import {createProductCollectionClient} from "../src/lib/product-collection"

interface StatusRow {
  brand_node_id: number
  platform_key: string
  platform_type: string | null
  config_status: string | null
}

interface ConfigStatusRepair {
  brand_node_id: number
  platform_key: string
  before_config_status: string | null
  before_platform_type: string | null
  after_config_status: "ready" | "blocked"
  after_platform_type: string
}

interface RepairPlanFile {
  version: 1
  generated_at: string
  scanned: number
  unresolved_count: number
  unresolved_samples: string[]
  changes: ConfigStatusRepair[]
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

function computeRepair(row: StatusRow): ConfigStatusRepair | null {
  const config = getSiteConfig(row.platform_key)
  if (!config) return null
  const afterConfigStatus = config.disabled ? "blocked" : "ready"
  const afterPlatformType = queuePlatformType(config.type)
  if (row.config_status === afterConfigStatus && row.platform_type === afterPlatformType) return null
  return {
    brand_node_id: row.brand_node_id,
    platform_key: row.platform_key,
    before_config_status: row.config_status,
    before_platform_type: row.platform_type,
    after_config_status: afterConfigStatus,
    after_platform_type: afterPlatformType,
  }
}

async function loadCandidateRows(): Promise<StatusRow[]> {
  const db = createProductCollectionClient()
  const {data, error} = await db
    .from("product_crawl_status")
    .select("brand_node_id, platform_key, platform_type, config_status")
    .eq("platform_type", "cafe24")
    .eq("status", "imported")
    .in("config_status", ["needed", "not_started"])
  if (error) throw new Error(`load failed: ${error.message}`)
  return (data ?? []) as StatusRow[]
}

async function writePlan(outputPath: string): Promise<void> {
  const absolute = path.resolve(outputPath)
  if (fs.existsSync(absolute) && !process.argv.includes("--force")) {
    throw new Error(`plan exists: ${absolute} (use --force to replace)`)
  }
  const rows = await loadCandidateRows()
  const changes: ConfigStatusRepair[] = []
  const unresolved: string[] = []
  for (const row of rows) {
    const repair = computeRepair(row)
    if (repair) changes.push(repair)
    else if (!getSiteConfig(row.platform_key)) unresolved.push(row.platform_key)
  }
  const plan: RepairPlanFile = {
    version: 1,
    generated_at: new Date().toISOString(),
    scanned: rows.length,
    unresolved_count: unresolved.length,
    unresolved_samples: unresolved.slice(0, 30),
    changes,
  }
  fs.writeFileSync(absolute, `${JSON.stringify(plan, null, 2)}\n`, {flag: "w"})
  console.log(
    `plan=${absolute} scanned=${rows.length} changes=${changes.length} unresolved=${unresolved.length}`,
  )
}

function validatePlan(raw: unknown): RepairPlanFile {
  if (!raw || typeof raw !== "object") throw new Error("invalid plan")
  const plan = raw as Partial<RepairPlanFile>
  if (plan.version !== 1 || !Array.isArray(plan.changes)) throw new Error("unsupported repair plan")
  return plan as RepairPlanFile
}

async function applyPlan(planPath: string): Promise<void> {
  const absolute = path.resolve(planPath)
  const plan = validatePlan(JSON.parse(fs.readFileSync(absolute, "utf8")))

  // Drift check: recompute from current configs before writing anything.
  for (const change of plan.changes) {
    const config = getSiteConfig(change.platform_key)
    if (!config) throw new Error(`config no longer resolves for ${change.platform_key} — regenerate the plan`)
    const afterConfigStatus = config.disabled ? "blocked" : "ready"
    const afterPlatformType = queuePlatformType(config.type)
    if (afterConfigStatus !== change.after_config_status || afterPlatformType !== change.after_platform_type) {
      throw new Error(`current config for ${change.platform_key} no longer matches the plan — regenerate it`)
    }
  }

  const db = createProductCollectionClient()
  let updated = 0
  let stale = 0
  for (const change of plan.changes) {
    const {data, error} = await db
      .from("product_crawl_status")
      .update({
        config_status: change.after_config_status,
        platform_type: change.after_platform_type,
      })
      .eq("brand_node_id", change.brand_node_id)
      .eq("status", "imported")
      .in("config_status", ["needed", "not_started"])
      .select("brand_node_id")
    if (error) throw new Error(`apply failed for ${change.platform_key}: ${error.message}`)
    if ((data?.length ?? 0) > 0) updated++
    else stale++
  }
  console.log(`applied=${updated} stale_or_already_changed=${stale} plan=${absolute}`)
}

async function main(): Promise<void> {
  const planOutput = flag("plan")
  const applyInput = flag("apply")
  if ((planOutput ? 1 : 0) + (applyInput ? 1 : 0) !== 1) {
    throw new Error("use exactly one: --plan=/path.json (read-only) or --apply=/path.json")
  }
  if (planOutput) await writePlan(planOutput)
  else await applyPlan(applyInput!)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
