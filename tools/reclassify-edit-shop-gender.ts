#!/usr/bin/env npx tsx
/**
 * Reclassify the five edit-shop curation sources from first-party evidence.
 *
 * Dry-run by default. `--apply` writes only evidence-backed changes and marks
 * KITH kids products and unresolved blanket-unisex rows out of stock because
 * the adult gender schema cannot safely represent them. A rollback snapshot is
 * written to the operating system's temporary directory before writes.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {pathToFileURL} from "node:url"

import {createClient, type SupabaseClient} from "@supabase/supabase-js"

import {inferGenderFromText, type ProductGender} from "../src/lib/product-gender"
import {toDecimalId} from "../src/lib/pipeline-integrity-types"
import {reclassificationSnapshotPath} from "../src/lib/reclassification-snapshot"
import {
  cafe24ListingLastPage,
  cafe24ListingProductNos,
  cafe24OfficialCategoryUrl,
  cafe24ProductNo,
} from "./repair-cafe24-legacy-from-crawl"

const EDIT_SHOPS = ["8division", "slowsteadyclub", "etcseoul", "fr8ight", "kith"] as const
type EditShop = typeof EDIT_SHOPS[number]
type GenderSource = "engine" | "repair_text" | "repair_brand_scope"

export interface EditShopProductRow {
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

export interface ClassificationDecision {
  gender: ProductGender | null
  source: GenderSource | null
  reason:
    | "official_department"
    | "official_department_tag"
    | "explicit_product_text"
    | "single_gender_brand"
    | "kids_out_of_scope"
}

interface ClassificationEvidence {
  officialGender: ProductGender | null
  brandGenderScope: string[] | null
}

interface OfficialDepartment {
  site: Exclude<EditShop, "etcseoul" | "kith">
  baseUrl: string
  categoryNo: number
  gender: Exclude<ProductGender, "unisex">
}

const OFFICIAL_DEPARTMENTS: readonly OfficialDepartment[] = [
  {site: "8division", baseUrl: "https://www.8division.com", categoryNo: 2682, gender: "men"},
  {site: "8division", baseUrl: "https://www.8division.com", categoryNo: 2740, gender: "women"},
  {site: "slowsteadyclub", baseUrl: "https://slowsteadyclub.com", categoryNo: 1330, gender: "men"},
  {site: "slowsteadyclub", baseUrl: "https://slowsteadyclub.com", categoryNo: 1331, gender: "women"},
  // FR8IGHT's generic CATEGORIES page also contains EASTLOGUE WOMAN. These
  // mutually exclusive brand-level All pages avoid manufacturing unisex from
  // that overlap.
  {site: "fr8ight", baseUrl: "https://fr8ight.co.kr", categoryNo: 1193, gender: "men"},
  {site: "fr8ight", baseUrl: "https://fr8ight.co.kr", categoryNo: 1194, gender: "men"},
  {site: "fr8ight", baseUrl: "https://fr8ight.co.kr", categoryNo: 1259, gender: "men"},
  {site: "fr8ight", baseUrl: "https://fr8ight.co.kr", categoryNo: 1532, gender: "men"},
  {site: "fr8ight", baseUrl: "https://fr8ight.co.kr", categoryNo: 1539, gender: "women"},
]

const WEAK_SOURCES = new Set([null, "unverified_legacy", "config_default", "legacy_backfill"])
const BLANKET_UNISEX_SOURCES = new Set([
  ...WEAK_SOURCES,
  "engine",
  "brand_scope",
  "repair_brand_scope",
])

function normalizedTags(tags: string[] | null): Set<string> {
  return new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()))
}

function kithDepartmentGender(name: string, tags: string[] | null): ProductGender | null {
  const values = normalizedTags(tags)
  const men = values.has("mens")
  const women = values.has("wmns")
  if (men && women) {
    if (/\bWMNS\b|\bKith Women\b/i.test(name)) return "women"
    if (/\bMENS\b|\bKith Men\b/i.test(name)) return "men"
    return "unisex"
  }
  if (men) return "men"
  if (women) return "women"
  return null
}

function isKithKids(tags: string[] | null): boolean {
  return normalizedTags(tags).has("kids")
}

export function mergeOfficialDepartmentMemberships(
  memberships: ReadonlySet<Exclude<ProductGender, "unisex">>,
): ProductGender | null {
  if (memberships.has("men") && memberships.has("women")) return "unisex"
  if (memberships.has("men")) return "men"
  if (memberships.has("women")) return "women"
  return null
}

export function resolveOfficialDepartmentMemberships(
  site: string,
  memberships: ReadonlySet<Exclude<ProductGender, "unisex">>,
): ProductGender | null {
  // FR8IGHT's men evidence comes from broad brand "All" pages; the explicit
  // EASTLOGUE WOMAN page is the narrower product-level classification.
  if (site === "fr8ight" && memberships.has("women")) return "women"
  return mergeOfficialDepartmentMemberships(memberships)
}

export function classifyEditShopProduct(
  row: EditShopProductRow,
  evidence: ClassificationEvidence,
): ClassificationDecision | null {
  if (row.platform === "kith" && isKithKids(row.tags)) {
    return {gender: null, source: null, reason: "kids_out_of_scope"}
  }
  if (evidence.officialGender) {
    return {gender: evidence.officialGender, source: "engine", reason: "official_department"}
  }
  if (row.platform === "kith") {
    const gender = kithDepartmentGender(row.name, row.tags)
    if (gender) return {gender, source: "engine", reason: "official_department_tag"}
  }
  const explicit = inferGenderFromText(row.name)
  if (explicit) return {gender: explicit, source: "repair_text", reason: "explicit_product_text"}

  const scope = (evidence.brandGenderScope ?? []).filter(
    (value): value is ProductGender => value === "men" || value === "women" || value === "unisex",
  )
  // A mixed/unisex brand scope describes the catalogue, not this SKU. Only a
  // verified single-gender brand can safely narrow an individual product.
  if (scope.length === 1 && (scope[0] === "men" || scope[0] === "women")) {
    return {gender: scope[0], source: "repair_brand_scope", reason: "single_gender_brand"}
  }
  return null
}

export function shouldDeactivateUnresolvedUnisex(row: EditShopProductRow): boolean {
  return row.in_stock
    && row.gender?.length === 1
    && row.gender[0] === "unisex"
    && BLANKET_UNISEX_SOURCES.has(row.gender_source)
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {"User-Agent": "Mozilla/5.0 (compatible; kiko.ai gender audit)"},
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

async function fetchDepartmentProductNos(department: OfficialDepartment): Promise<Set<string>> {
  const firstUrl = cafe24OfficialCategoryUrl(
    department.site,
    department.baseUrl,
    department.categoryNo,
  )
  const firstHtml = await fetchHtml(firstUrl)
  const lastPage = Math.min(cafe24ListingLastPage(firstHtml, department.categoryNo), 100)
  const productNos = new Set(cafe24ListingProductNos(firstHtml))
  let page = 2
  await Promise.all(Array.from({length: Math.min(4, Math.max(0, lastPage - 1))}, async () => {
    while (page <= lastPage) {
      const current = page
      page += 1
      const html = await fetchHtml(cafe24OfficialCategoryUrl(
        department.site,
        department.baseUrl,
        department.categoryNo,
        current,
      ))
      for (const productNo of cafe24ListingProductNos(html)) productNos.add(productNo)
    }
  }))
  if (productNos.size === 0) {
    throw new Error(`${department.site} cate_no=${department.categoryNo}: no products found`)
  }
  console.log(
    `${department.site} cate_no=${department.categoryNo} gender=${department.gender} pages=${lastPage} products=${productNos.size}`,
  )
  return productNos
}

async function buildOfficialGenderIndex(): Promise<Map<string, ProductGender>> {
  const observations = new Map<string, Set<Exclude<ProductGender, "unisex">>>()
  const fetched = await Promise.all(OFFICIAL_DEPARTMENTS.map(async (department) => ({
    department,
    productNos: await fetchDepartmentProductNos(department),
  })))
  for (const {department, productNos} of fetched) {
    for (const productNo of productNos) {
      const key = `${department.site}:${productNo}`
      const genders = observations.get(key) ?? new Set<Exclude<ProductGender, "unisex">>()
      genders.add(department.gender)
      observations.set(key, genders)
    }
  }
  return new Map([...observations].flatMap(([key, genders]) => {
    const gender = resolveOfficialDepartmentMemberships(key.split(":", 1)[0], genders)
    return gender ? [[key, gender]] : []
  }))
}

async function readProducts(db: SupabaseClient): Promise<EditShopProductRow[]> {
  const rows: EditShopProductRow[] = []
  let cursor = "0"
  for (;;) {
    const {data, error} = await db.from("products")
      .select("id,platform,name,product_url,tags,gender,gender_source,brand_node_id,in_stock,updated_at")
      .in("platform", [...EDIT_SHOPS])
      .gt("id", cursor)
      .order("id", {ascending: true})
      .limit(1000)
    if (error) throw error
    const page = (data ?? []).map((row) => ({
      ...row,
      id: toDecimalId((row as {id: string | number | bigint}).id),
    })) as EditShopProductRow[]
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
  const result = new Map<number, string[] | null>()
  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200)
    const {data, error} = await db.from("brand_nodes").select("id,gender_scope").in("id", batch)
    if (error) throw error
    for (const row of data ?? []) result.set(Number(row.id), row.gender_scope as string[] | null)
  }
  return result
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) {
    const group = key(value)
    result[group] = (result[group] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(result).sort())
}

async function updateGenderRows(
  db: SupabaseClient,
  rows: Array<{row: EditShopProductRow; decision: ClassificationDecision}>,
  updatedAt: string,
): Promise<number> {
  let updated = 0
  const groups = new Map<string, typeof rows>()
  for (const item of rows) {
    const key = `${item.decision.gender}\t${item.decision.source}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  for (const group of groups.values()) {
    const {gender, source} = group[0].decision
    if (!gender || !source) continue
    for (let index = 0; index < group.length; index += 100) {
      const batch = group.slice(index, index + 100)
      const {data, error} = await db.from("products")
        .update({gender: [gender], gender_source: source, updated_at: updatedAt})
        .in("id", batch.map(({row}) => row.id))
        .select("id")
      if (error) throw error
      if ((data?.length ?? 0) !== batch.length) {
        throw new Error(`gender update count mismatch expected=${batch.length} actual=${data?.length ?? 0}`)
      }
      updated += data.length
    }
  }
  return updated
}

async function deactivateRows(
  db: SupabaseClient,
  rows: EditShopProductRow[],
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
      throw new Error(`deactivation count mismatch expected=${batch.length} actual=${data?.length ?? 0}`)
    }
    updated += data.length
  }
  return updated
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply")
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

  const officialIndex = await buildOfficialGenderIndex()
  const db = createClient(dbUrl, dbToken)
  const rows = await readProducts(db)
  const brandIds = [...new Set(rows.flatMap((row) => row.brand_node_id === null ? [] : [row.brand_node_id]))]
  const brandScopes = await readBrandScopes(db, brandIds)
  const classified = rows.map((row) => {
    const productNo = cafe24ProductNo(row.product_url)
    const officialGender = productNo ? officialIndex.get(`${row.platform}:${productNo}`) ?? null : null
    return {
      row,
      decision: classifyEditShopProduct(row, {
        officialGender,
        brandGenderScope: row.brand_node_id === null ? null : brandScopes.get(row.brand_node_id) ?? null,
      }),
    }
  })
  const kids = classified
    .filter(({row, decision}) => decision?.reason === "kids_out_of_scope" && row.in_stock)
    .map(({row}) => row)
  const genderUpdates = classified.flatMap(({row, decision}) => {
    if (!decision?.gender || !decision.source) return []
    const before = Array.isArray(row.gender) && row.gender.length === 1 ? row.gender[0] : null
    const authoritative = decision.reason === "official_department" || decision.reason === "official_department_tag"
    const weakExisting = WEAK_SOURCES.has(row.gender_source)
    const knownBlanketUnisex = before === "unisex" && row.gender_source === "engine"
    const mayOverride = authoritative || weakExisting || knownBlanketUnisex
    const provenanceUpgrade = (authoritative || weakExisting) && row.gender_source !== decision.source
    return mayOverride && (before !== decision.gender || provenanceUpgrade) ? [{row, decision}] : []
  })
  const unresolved = classified.filter(({decision}) => decision === null).map(({row}) => row)
  const unresolvedUnisex = unresolved.filter(shouldDeactivateUnresolvedUnisex)
  const valueChanges = genderUpdates.filter(
    ({row, decision}) => row.gender?.[0] !== decision.gender,
  )

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scanned: rows.length,
    official_index: officialIndex.size,
    classified: classified.length - unresolved.length - classified.filter(({decision}) => decision?.reason === "kids_out_of_scope").length,
    gender_updates: genderUpdates.length,
    gender_value_changes: valueChanges.length,
    kids_out_of_scope_active: kids.length,
    unresolved_preserved: unresolved.length,
    unresolved_unisex_active_to_deactivate: unresolvedUnisex.length,
    updates_by_platform: countBy(genderUpdates, ({row}) => row.platform),
    updates_by_transition: countBy(
      genderUpdates,
      ({row, decision}) => `${row.platform}:${row.gender?.[0] ?? "null"}->${decision.gender}:${decision.reason}`,
    ),
    unresolved_by_platform: countBy(unresolved, (row) => row.platform),
    unresolved_unisex_deactivations_by_platform: countBy(unresolvedUnisex, (row) => row.platform),
  }, null, 2))
  for (const {row, decision} of valueChanges.slice(0, 40)) {
    console.log(
      `sample id=${row.id} platform=${row.platform} ${row.gender?.[0] ?? "null"}/${row.gender_source ?? "null"} -> ${decision.gender}/${decision.source} (${decision.reason}) ${row.name}`,
    )
  }
  if (!apply) return

  const updatedAt = new Date().toISOString()
  const snapshotPath = reclassificationSnapshotPath(
    "edit-shop-gender-reclassification",
    updatedAt,
  )
  fs.writeFileSync(snapshotPath, JSON.stringify({
    generated_at: updatedAt,
    gender_updates: genderUpdates.map(({row, decision}) => ({
      id: row.id,
      platform: row.platform,
      before_gender: row.gender,
      before_source: row.gender_source,
      before_updated_at: row.updated_at,
      after_gender: decision.gender ? [decision.gender] : null,
      after_source: decision.source,
      reason: decision.reason,
    })),
    kids_deactivated: kids.map((row) => ({
      id: row.id,
      platform: row.platform,
      before_in_stock: row.in_stock,
      before_updated_at: row.updated_at,
    })),
    unresolved_unisex_deactivated: unresolvedUnisex.map((row) => ({
      id: row.id,
      platform: row.platform,
      before_gender: row.gender,
      before_source: row.gender_source,
      before_in_stock: row.in_stock,
      before_updated_at: row.updated_at,
    })),
  }, null, 2))

  const updated = await updateGenderRows(db, genderUpdates, updatedAt)
  const kidsDeactivated = await deactivateRows(db, kids, updatedAt)
  const unresolvedUnisexDeactivated = await deactivateRows(db, unresolvedUnisex, updatedAt)
  console.log(JSON.stringify({
    updated,
    kids_deactivated: kidsDeactivated,
    unresolved_unisex_deactivated: unresolvedUnisexDeactivated,
    snapshot: snapshotPath,
  }, null, 2))
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
