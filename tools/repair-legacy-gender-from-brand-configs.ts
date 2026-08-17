#!/usr/bin/env npx tsx
/** 공식몰에서 검증한 브랜드 기본 성별을 편집샵의 동일 brand_node 상품에 연결한다. */
import * as path from "node:path"
import {pathToFileURL} from "node:url"

import {createClient} from "@supabase/supabase-js"

import {SITE_GENDER_DEFAULTS} from "../src/configs/gender-defaults"
import {getSiteConfig} from "../src/configs/platforms"
import {isKidsText, type ProductGender} from "../src/lib/product-gender"

interface StatusRow {platform_key: string | null; brand_node_id: number | null}
interface LegacyRow {
  id: number
  platform: string
  brand: string | null
  brand_node_id: number | null
  name: string
  product_url: string
  tags: string[] | null
  gender: string[] | null
}

export function verifiedBrandGenderIndex(rows: StatusRow[]): Map<number, ProductGender> {
  const candidates = new Map<number, Set<ProductGender>>()
  for (const row of rows) {
    if (!row.platform_key || row.brand_node_id === null) continue
    const config = getSiteConfig(row.platform_key)
    const configured = config?.defaultGender
    if (!configured || configured.length !== 1) continue
    const gender = configured[0] as ProductGender
    const curatedSingleGender = gender !== "unisex" && SITE_GENDER_DEFAULTS[row.platform_key]?.[0] === gender
    const verifiedUnisex = gender === "unisex" && config?.verifiedUnisexDefault === true
    if (!curatedSingleGender && !verifiedUnisex) continue
    const set = candidates.get(row.brand_node_id) ?? new Set<ProductGender>()
    set.add(gender)
    candidates.set(row.brand_node_id, set)
  }
  return new Map([...candidates]
    .filter(([, genders]) => genders.size === 1)
    .map(([brandNodeId, genders]) => [brandNodeId, [...genders][0]]))
}

function isKids(row: LegacyRow): boolean {
  return isKidsText([row.name, row.product_url, ...(row.tags ?? [])].join(" "))
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply")
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
  const db = createClient(dbUrl, dbToken)

  const statuses: StatusRow[] = []
  for (let offset = 0;; offset += 1000) {
    const {data, error} = await db.from("product_crawl_status")
      .select("platform_key,brand_node_id").range(offset, offset + 999)
    if (error) throw error
    statuses.push(...((data ?? []) as StatusRow[]))
    if ((data?.length ?? 0) < 1000) break
  }
  const index = verifiedBrandGenderIndex(statuses)

  const decisions: Array<LegacyRow & {after: ProductGender}> = []
  let scanned = 0
  let kids = 0
  let unmatched = 0
  let cursor = 0
  for (;;) {
    const {data, error} = await db.from("products")
      .select("id,platform,brand,brand_node_id,name,product_url,tags,gender")
      .eq("gender_source", "unverified_legacy")
      .gt("id", cursor).order("id", {ascending: true}).limit(1000)
    if (error) throw error
    const rows = (data ?? []) as LegacyRow[]
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id
    for (const row of rows) {
      scanned += 1
      if (isKids(row)) {
        kids += 1
        continue
      }
      const after = row.brand_node_id === null ? undefined : index.get(row.brand_node_id)
      if (!after) {
        unmatched += 1
        continue
      }
      decisions.push({...row, after})
    }
    if (rows.length < 1000) break
  }

  const counts = {men: 0, women: 0, unisex: 0}
  const platforms = new Map<string, number>()
  for (const row of decisions) {
    counts[row.after] += 1
    platforms.set(row.platform, (platforms.get(row.platform) ?? 0) + 1)
  }
  console.log({verifiedBrands: index.size, scanned, matched: decisions.length, kids, unmatched, ...counts})
  console.log([...platforms].sort((a, b) => b[1] - a[1]))
  for (const row of decisions.slice(0, 20)) {
    console.log(`sample id=${row.id} platform=${row.platform} brand=${row.brand} ${row.gender} -> ${row.after}`)
  }
  if (!apply) return

  let updated = 0
  let stale = 0
  for (const gender of ["men", "women", "unisex"] as ProductGender[]) {
    const group = decisions.filter(({after}) => after === gender)
    for (let i = 0; i < group.length; i += 100) {
      const batch = group.slice(i, i + 100)
      const {data, error} = await db.from("products")
        .update({gender: [gender], gender_source: "config_default", updated_at: new Date().toISOString()})
        .in("id", batch.map(({id}) => id))
        .eq("gender_source", "unverified_legacy")
        .select("id")
      if (error) throw error
      const wrote = data?.length ?? 0
      updated += wrote
      stale += batch.length - wrote
    }
  }
  console.log(`updated=${updated} stale=${stale}`)
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
