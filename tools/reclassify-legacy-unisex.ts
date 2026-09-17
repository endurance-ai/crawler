#!/usr/bin/env npx tsx
/**
 * Reclassify or quarantine legacy products whose `unisex` value is not backed
 * by product-level evidence.
 *
 * Dry-run is the default. `--apply` updates evidence-backed rows and marks
 * unresolved active rows out of stock because the DB contract has no
 * `unknown` gender value. A rollback snapshot is written before any write.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {pathToFileURL} from "node:url"

import {createClient, type SupabaseClient} from "@supabase/supabase-js"

import {SITE_GENDER_DEFAULTS} from "../src/configs/gender-defaults"
import {getSiteConfig, PLATFORMS} from "../src/configs/platforms"
import {
  inferGenderFromText,
  isKidsText,
  type GenderSource,
  type ProductGender,
} from "../src/lib/product-gender"
import {toDecimalId} from "../src/lib/pipeline-integrity-types"
import {reclassificationSnapshotPath} from "../src/lib/reclassification-snapshot"
import {
  EDIT_SHOP_GENDER_RECLASSIFIED_SITES,
  HISTORICAL_BLANKET_UNISEX_SITES,
} from "../src/lib/unisex-quarantine"
import {cafe24CategoryNo} from "./repair-cafe24-legacy-from-crawl"

// These sites previously stamped product-type categories as `engine=unisex`.
// Keep the history here even after the live config is corrected, otherwise the
// repair tool can no longer identify already-written contaminated rows.
const LEGACY_SOURCES = new Set<string | null>([
  null,
  "unverified_legacy",
  "legacy_backfill",
  "brand_scope",
  "repair_brand_scope",
])

type RepairSource = "engine" | "repair_text" | "repair_brand_scope" | "config_default"
type RepairReason =
  | "official_category"
  | "explicit_product_text"
  | "explicit_tag_text"
  | "verified_site_default"
  | "single_gender_brand"
  | "kids_out_of_scope"
  | "unresolved"

export interface LegacyUnisexRow {
  id: string
  platform: string
  name: string
  product_url: string
  tags: string[] | null
  gender: string[] | null
  gender_source: string | null
  brand_node_id: number | null
  in_stock: boolean
  updated_at?: string | null
}

export interface LegacyUnisexDecision {
  gender: ProductGender | null
  source: RepairSource | null
  reason: RepairReason
}

interface LegacyUnisexEvidence {
  categoryGender: ProductGender | null
  verifiedSiteDefault: ProductGender | null
  brandGenderScope: string[] | null
}

export function isSuspectLegacyUnisex(
  source: string | null,
  hasUnverifiedUnisexDefault: boolean,
  hasBlanketUnisexCategories: boolean,
): boolean {
  if (LEGACY_SOURCES.has(source)) return true
  if (source === "config_default" && hasUnverifiedUnisexDefault) return true
  if (source === "engine" && hasBlanketUnisexCategories) return true
  return false
}

export function classifyLegacyUnisex(
  row: Pick<LegacyUnisexRow, "name" | "product_url" | "tags">,
  evidence: LegacyUnisexEvidence,
): LegacyUnisexDecision {
  const kidsText = [row.name, row.product_url, ...(row.tags ?? [])].join(" ")
  if (isKidsText(kidsText)) {
    return {gender: null, source: null, reason: "kids_out_of_scope"}
  }
  if (evidence.categoryGender) {
    return {gender: evidence.categoryGender, source: "engine", reason: "official_category"}
  }
  const nameGender = inferGenderFromText(row.name)
  if (nameGender) {
    return {gender: nameGender, source: "repair_text", reason: "explicit_product_text"}
  }
  const tagGender = inferGenderFromText((row.tags ?? []).join(" "))
  if (tagGender) {
    return {gender: tagGender, source: "repair_text", reason: "explicit_tag_text"}
  }
  if (evidence.verifiedSiteDefault === "men" || evidence.verifiedSiteDefault === "women") {
    return {
      gender: evidence.verifiedSiteDefault,
      source: "config_default",
      reason: "verified_site_default",
    }
  }
  const scope = (evidence.brandGenderScope ?? []).filter(
    (value): value is ProductGender => value === "men" || value === "women" || value === "unisex",
  )
  if (scope.length === 1 && (scope[0] === "men" || scope[0] === "women")) {
    return {gender: scope[0], source: "repair_brand_scope", reason: "single_gender_brand"}
  }
  return {gender: null, source: null, reason: "unresolved"}
}

function rawConfigFlags(): Map<string, {
  hasUnverifiedUnisexDefault: boolean
  hasBlanketUnisexCategories: boolean
}> {
  return new Map(PLATFORMS.map((raw) => {
    const resolved = getSiteConfig(raw.key)
    const categories = raw.category && "categories" in raw.category
      ? raw.category.categories ?? []
      : []
    return [raw.key, {
      hasUnverifiedUnisexDefault: raw.defaultGender?.length === 1
        && raw.defaultGender[0] === "unisex"
        && resolved?.verifiedUnisexDefault !== true,
      hasBlanketUnisexCategories: resolved?.verifiedUnisexDefault !== true
        && (
          HISTORICAL_BLANKET_UNISEX_SITES.has(raw.key)
          || categories.some((category) => (
            category.gender?.length === 1
            && category.gender[0] === "unisex"
            && !/(?:unisex|공용)/iu.test(category.name)
          ))
        ),
    }]
  }))
}

function resolvedCategoryGender(platform: string, productUrl: string): ProductGender | null {
  const categoryNo = cafe24CategoryNo(productUrl)
  if (categoryNo === null) return null
  const config = getSiteConfig(platform)
  const categories = config?.category && "categories" in config.category
    ? config.category.categories ?? []
    : []
  const gender = categories.find((category) => category.cateNo === categoryNo)?.gender
  return gender?.length === 1 ? gender[0] as ProductGender : null
}

async function readUnisexRows(
  db: SupabaseClient,
  activeOnly = false,
): Promise<LegacyUnisexRow[]> {
  const rows: LegacyUnisexRow[] = []
  let cursor = "0"
  for (;;) {
    let query = db.from("products")
      .select("id,platform,name,product_url,tags,gender,gender_source,brand_node_id,in_stock,updated_at")
      .contains("gender", ["unisex"])
      .gt("id", cursor)
      .order("id", {ascending: true})
      .limit(1000)
    if (activeOnly) query = query.eq("in_stock", true)
    const {data, error} = await query
    if (error) throw error
    const page = (data ?? []).map((row) => ({
      ...row,
      id: toDecimalId((row as {id: string | number | bigint}).id),
    })) as LegacyUnisexRow[]
    if (page.length === 0) break
    rows.push(...page)
    cursor = page[page.length - 1].id
    if (page.length < 1000) break
  }
  return rows
}

async function readBrandScopes(
  db: SupabaseClient,
  ids: number[],
): Promise<Map<number, string[] | null>> {
  const scopes = new Map<number, string[] | null>()
  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200)
    const {data, error} = await db.from("brand_nodes").select("id,gender_scope").in("id", batch)
    if (error) throw error
    for (const row of data ?? []) scopes.set(Number(row.id), row.gender_scope as string[] | null)
  }
  return scopes
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    const group = key(value)
    counts[group] = (counts[group] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
}

async function updateClassifiedRows(
  db: SupabaseClient,
  updates: Array<{row: LegacyUnisexRow; decision: LegacyUnisexDecision}>,
  updatedAt: string,
): Promise<number> {
  const groups = new Map<string, typeof updates>()
  for (const update of updates) {
    const key = `${update.decision.gender}\t${update.decision.source}`
    groups.set(key, [...(groups.get(key) ?? []), update])
  }
  let updated = 0
  for (const group of groups.values()) {
    const decision = group[0].decision
    if (!decision.gender || !decision.source) continue
    for (let index = 0; index < group.length; index += 100) {
      const batch = group.slice(index, index + 100)
      const {data, error} = await db.from("products")
        .update({
          gender: [decision.gender],
          gender_source: decision.source as GenderSource,
          updated_at: updatedAt,
        })
        .in("id", batch.map(({row}) => row.id))
        .select("id")
      if (error) throw error
      if ((data?.length ?? 0) !== batch.length) {
        throw new Error(`gender update mismatch expected=${batch.length} actual=${data?.length ?? 0}`)
      }
      updated += data.length
    }
  }
  return updated
}

async function deactivateRows(
  db: SupabaseClient,
  rows: LegacyUnisexRow[],
  updatedAt: string,
): Promise<number> {
  let updated = 0
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100)
    const {data, error} = await db.from("products")
      .update({in_stock: false, updated_at: updatedAt})
      .in("id", batch.map(({id}) => id))
      .eq("in_stock", true)
      .select("id")
    if (error) throw error
    if ((data?.length ?? 0) !== batch.length) {
      throw new Error(`deactivation mismatch expected=${batch.length} actual=${data?.length ?? 0}`)
    }
    updated += data.length
  }
  return updated
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply")
  const activeOnly = process.argv.includes("--active-only")
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

  const db = createClient(dbUrl, dbToken)
  const flags = rawConfigFlags()
  const allUnisexRows = await readUnisexRows(db, activeOnly)
  const candidates = allUnisexRows.filter((row) => {
    if (EDIT_SHOP_GENDER_RECLASSIFIED_SITES.has(row.platform)) return false
    const configFlags = flags.get(row.platform) ?? {
      hasUnverifiedUnisexDefault: false,
      hasBlanketUnisexCategories: false,
    }
    return isSuspectLegacyUnisex(
      row.gender_source,
      configFlags.hasUnverifiedUnisexDefault,
      configFlags.hasBlanketUnisexCategories,
    )
  })
  const brandIds = [...new Set(candidates.flatMap(
    (row) => row.brand_node_id === null ? [] : [row.brand_node_id],
  ))]
  const brandScopes = await readBrandScopes(db, brandIds)

  const classified = candidates.map((row) => {
    const configuredDefault = SITE_GENDER_DEFAULTS[row.platform]
    const verifiedSiteDefault = configuredDefault?.length === 1
      ? configuredDefault[0] as ProductGender
      : null
    const decision = classifyLegacyUnisex(row, {
      categoryGender: resolvedCategoryGender(row.platform, row.product_url),
      verifiedSiteDefault,
      brandGenderScope: row.brand_node_id === null ? null : brandScopes.get(row.brand_node_id) ?? null,
    })
    return {row, decision}
  })
  const updates = classified.filter(({row, decision}) => (
    decision.gender !== null
    && decision.source !== null
    && (decision.gender !== "unisex" || row.gender_source !== decision.source)
  ))
  const valueChanges = updates.filter(({decision}) => decision.gender !== "unisex")
  const unresolved = classified.filter(({decision}) => decision.gender === null)
  const toDeactivate = unresolved.filter(({row}) => row.in_stock).map(({row}) => row)

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    active_only: activeOnly,
    unisex_scanned: allUnisexRows.length,
    suspect_candidates: candidates.length,
    classified: classified.length - unresolved.length,
    gender_updates: updates.length,
    gender_value_changes: valueChanges.length,
    unresolved: unresolved.length,
    unresolved_active_to_deactivate: toDeactivate.length,
    candidates_by_source: countBy(candidates, (row) => row.gender_source ?? "NULL"),
    updates_by_transition: countBy(
      updates,
      ({row, decision}) => `${row.platform}:unisex->${decision.gender}:${decision.reason}`,
    ),
    deactivations_by_platform: countBy(toDeactivate, (row) => row.platform),
  }, null, 2))
  for (const {row, decision} of valueChanges.slice(0, 40)) {
    console.log(
      `sample id=${row.id} platform=${row.platform} unisex/${row.gender_source ?? "null"} -> ${decision.gender}/${decision.source} (${decision.reason}) ${row.name}`,
    )
  }
  if (!apply) return

  const updatedAt = new Date().toISOString()
  const snapshotPath = reclassificationSnapshotPath(
    "legacy-unisex-reclassification",
    updatedAt,
  )
  fs.writeFileSync(snapshotPath, JSON.stringify({
    generated_at: updatedAt,
    gender_updates: updates.map(({row, decision}) => ({
      id: row.id,
      platform: row.platform,
      before_gender: row.gender,
      before_source: row.gender_source,
      before_updated_at: row.updated_at,
      after_gender: decision.gender ? [decision.gender] : null,
      after_source: decision.source,
      reason: decision.reason,
    })),
    deactivated: toDeactivate.map((row) => ({
      id: row.id,
      platform: row.platform,
      before_in_stock: row.in_stock,
      before_updated_at: row.updated_at,
    })),
  }, null, 2))

  const updated = await updateClassifiedRows(db, updates, updatedAt)
  const deactivated = await deactivateRows(db, toDeactivate, updatedAt)
  console.log(JSON.stringify({updated, deactivated, snapshot: snapshotPath}, null, 2))
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
