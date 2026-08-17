#!/usr/bin/env npx tsx
/**
 * 공식 Shopify 성별 컬렉션 소속을 product handle로 과거 DB 행에 연결한다.
 *
 * 일반 import를 다시 돌리지 않고 gender_source=unverified_legacy 행의 gender만
 * 교정한다. 삭제·병합은 하지 않으며, --apply가 없으면 읽기 전용으로 분포만 낸다.
 */
import * as path from "node:path"
import {pathToFileURL} from "node:url"

import {createClient} from "@supabase/supabase-js"

import {getSiteConfig} from "../src/configs/platforms"
import {isKidsText, type ProductGender} from "../src/lib/product-gender"
import {fetchShopifyGenderByHandle} from "../src/lib/shopify-engine"

interface LegacyRow {
  id: number
  platform: string
  name: string
  product_url: string
  tags: string[] | null
  gender: string[] | null
  gender_source: string | null
}

export function shopifyProductHandle(productUrl: string): string | null {
  try {
    const match = new URL(productUrl).pathname.match(/^\/products\/([^/]+)\/?$/i)
    return match ? decodeURIComponent(match[1]).toLowerCase() : null
  } catch {
    return null
  }
}

export function isLegacyKidsRow(row: Pick<LegacyRow, "name" | "product_url" | "tags">): boolean {
  return isKidsText([row.name, row.product_url, ...(row.tags ?? [])].join(" "))
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

async function main(): Promise<void> {
  const sites = (flag("site") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  if (sites.length === 0) throw new Error("--site=platform[,platform] 이 필요하다")
  const apply = process.argv.includes("--apply")
  const country = flag("country") ?? "KR"
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

  const genderIndexes = new Map<string, Record<string, ProductGender>>()
  for (const site of sites) {
    const config = getSiteConfig(site)
    if (!config?.shopifyGenderCollections) throw new Error(`${site}: 공식 Shopify 성별 컬렉션 설정이 없다`)
    const errors: string[] = []
    const index = await fetchShopifyGenderByHandle(config, country, "", errors)
    if (errors.length > 0) throw new Error(`${site}: 공식 컬렉션 수집 실패\n${errors.join("\n")}`)
    genderIndexes.set(site, index)
    console.log(`${site} official handles=${Object.keys(index).length}`)
  }

  const db = createClient(dbUrl, dbToken)
  const decisions: Array<LegacyRow & {handle: string; after: ProductGender}> = []
  let scanned = 0
  let kids = 0
  let unmatched = 0
  for (const site of sites) {
    let cursor = 0
    for (;;) {
      const {data, error} = await db
        .from("products")
        .select("id,platform,name,product_url,tags,gender,gender_source")
        .eq("platform", site)
        .eq("gender_source", "unverified_legacy")
        .gt("id", cursor)
        .order("id", {ascending: true})
        .limit(1000)
      if (error) throw error
      const rows = (data ?? []) as LegacyRow[]
      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id
      for (const row of rows) {
        scanned += 1
        if (isLegacyKidsRow(row)) {
          kids += 1
          continue
        }
        const handle = shopifyProductHandle(row.product_url)
        const after = handle ? genderIndexes.get(site)?.[handle] : undefined
        if (!handle || !after) {
          unmatched += 1
          continue
        }
        decisions.push({...row, handle, after})
      }
      if (rows.length < 1000) break
    }
  }

  const counts = {men: 0, women: 0, unisex: 0}
  for (const {after} of decisions) counts[after] += 1
  console.log({scanned, matched: decisions.length, kids, unmatched, ...counts})
  for (const row of decisions.slice(0, 20)) {
    console.log(`sample id=${row.id} ${row.platform} ${row.handle} ${row.gender} -> ${row.after}`)
  }
  if (!apply) return

  let updated = 0
  let stale = 0
  for (const gender of ["men", "women", "unisex"] as ProductGender[]) {
    const group = decisions.filter(({after}) => after === gender)
    for (let i = 0; i < group.length; i += 100) {
      const batch = group.slice(i, i + 100)
      const {data, error} = await db
        .from("products")
        .update({gender: [gender], gender_source: "engine", updated_at: new Date().toISOString()})
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
