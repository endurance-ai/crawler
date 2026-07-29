#!/usr/bin/env npx tsx

import * as fs from "node:fs"
import * as path from "node:path"

import {PLATFORMS} from "../src/configs/platforms"
import {createProductCollectionClient} from "../src/lib/product-collection"
import {
  buildPlatformRepairPlan,
  type ProductPlatformRepair,
  type ProductPlatformRow,
} from "../src/lib/refresh-source"

interface RepairPlanFile {
  version: 1
  generated_at: string
  product_count: number
  unchanged: number
  ambiguous_count: number
  unresolved_count: number
  ambiguous_samples: ProductPlatformRow[]
  unresolved_samples: ProductPlatformRow[]
  changes: ProductPlatformRepair[]
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

async function loadProducts(): Promise<ProductPlatformRow[]> {
  const db = createProductCollectionClient()
  const rows: ProductPlatformRow[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("products")
      .select("id,platform,product_url")
      .order("id", {ascending: true})
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`products load failed: ${error.message}`)
    const page = (data ?? []) as ProductPlatformRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

function validatePlan(raw: unknown): RepairPlanFile {
  if (!raw || typeof raw !== "object") throw new Error("invalid plan")
  const plan = raw as Partial<RepairPlanFile>
  if (plan.version !== 1 || !Array.isArray(plan.changes)) throw new Error("unsupported repair plan")
  for (const row of plan.changes) {
    if (
      !Number.isInteger(row.id) ||
      typeof row.product_url !== "string" ||
      typeof row.before !== "string" ||
      typeof row.after !== "string"
    ) {
      throw new Error("invalid repair plan row")
    }
  }
  return plan as RepairPlanFile
}

async function writePlan(outputPath: string): Promise<void> {
  const absolute = path.resolve(outputPath)
  if (fs.existsSync(absolute) && !process.argv.includes("--force")) {
    throw new Error(`plan exists: ${absolute} (use --force to replace)`)
  }
  const products = await loadProducts()
  const result = buildPlatformRepairPlan(products, PLATFORMS)
  const plan: RepairPlanFile = {
    version: 1,
    generated_at: new Date().toISOString(),
    product_count: products.length,
    unchanged: result.unchanged,
    ambiguous_count: result.ambiguous.length,
    unresolved_count: result.unresolved.length,
    ambiguous_samples: result.ambiguous.slice(0, 100),
    unresolved_samples: result.unresolved.slice(0, 100),
    changes: result.changes,
  }
  fs.writeFileSync(absolute, `${JSON.stringify(plan, null, 2)}\n`, {flag: "w"})
  console.log(
    `plan=${absolute} products=${products.length} changes=${result.changes.length}` +
      ` ambiguous=${result.ambiguous.length} unresolved=${result.unresolved.length}`,
  )
}

async function applyPlan(planPath: string): Promise<void> {
  const absolute = path.resolve(planPath)
  const plan = validatePlan(JSON.parse(fs.readFileSync(absolute, "utf8")))
  const validKeys = new Set(PLATFORMS.map((config) => config.key))
  if (plan.changes.some((change) => !validKeys.has(change.after))) {
    throw new Error("plan contains a target platform key absent from current configs")
  }

  // Recompute the mapping from the plan rows against current configs. This
  // catches config/host drift between plan creation and apply.
  const verification = buildPlatformRepairPlan(
    plan.changes.map((change) => ({
      id: change.id,
      platform: change.before,
      product_url: change.product_url,
    })),
    PLATFORMS,
  )
  const expected = new Map(plan.changes.map((change) => [change.id, change.after]))
  if (
    verification.changes.length !== plan.changes.length ||
    verification.changes.some((change) => expected.get(change.id) !== change.after)
  ) {
    throw new Error("current config/host mapping no longer matches the repair plan")
  }

  const db = createProductCollectionClient()
  const grouped = new Map<string, ProductPlatformRepair[]>()
  for (const change of plan.changes) {
    const key = `${change.before}\u0000${change.after}`
    const rows = grouped.get(key) ?? []
    rows.push(change)
    grouped.set(key, rows)
  }

  let updated = 0
  let stale = 0
  for (const rows of grouped.values()) {
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100)
      const before = batch[0].before
      const after = batch[0].after
      const {data, error} = await db
        .from("products")
        .update({platform: after, updated_at: new Date().toISOString()})
        .eq("platform", before)
        .in("id", batch.map((row) => row.id))
        .select("id")
      if (error) throw new Error(`repair apply failed ${before}->${after}: ${error.message}`)
      updated += data?.length ?? 0
      stale += batch.length - (data?.length ?? 0)
    }
  }
  console.log(`applied=${updated} stale_or_already_changed=${stale} plan=${absolute}`)
}

async function main(): Promise<void> {
  const planOutput = flag("plan")
  const applyInput = flag("apply")
  if ((planOutput ? 1 : 0) + (applyInput ? 1 : 0) !== 1) {
    throw new Error(
      "use exactly one: --plan=/absolute/path.json (read-only) or --apply=/absolute/path.json",
    )
  }
  if (planOutput) await writePlan(planOutput)
  else await applyPlan(applyInput!)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

