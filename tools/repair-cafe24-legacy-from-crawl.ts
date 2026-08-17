#!/usr/bin/env npx tsx
/**
 * 현행 Cafe24 공식 부서 크롤 결과를 product_no로 과거 DB 행에 연결한다.
 *
 * Cafe24 상품 URL의 cate_no/slug는 바뀔 수 있어 일반 import가 같은 상품을 새
 * 행으로 만들 수 있다. 이 도구는 platform + product_no만 식별자로 사용하고,
 * gender_source=unverified_legacy인 기존 행만 갱신한다. 삭제나 병합은 하지 않는다.
 *
 * 사용법:
 *   pnpm exec dotenv -e .env -e .env.local -- tsx tools/repair-cafe24-legacy-from-crawl.ts --site=humanity,en-1111
 *   ... --site=humanity,en-1111 --apply
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {pathToFileURL} from "node:url"

import {createClient} from "@supabase/supabase-js"

import {getSiteConfig} from "../src/configs/platforms"
import {cleanGenderScope, type ProductGender} from "../src/lib/product-gender"

interface CrawledProduct {
  productUrl?: string
  gender?: string[]
  genderSource?: string
}

interface LegacyRow {
  id: number
  platform: string
  product_url: string
  gender: string[] | null
  gender_source: string | null
}

export function cafe24ProductNo(productUrl: string): string | null {
  try {
    const url = new URL(productUrl)
    return url.searchParams.get("product_no")
      ?? url.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/i)?.[1]
      ?? null
  } catch {
    return null
  }
}

export function cafe24CategoryNo(productUrl: string): number | null {
  try {
    const url = new URL(productUrl)
    const value = url.searchParams.get("cate_no")
      ?? url.pathname.match(/\/category\/(\d+)(?:\/|$)/i)?.[1]
    return value ? Number(value) : null
  } catch {
    return null
  }
}

export function indexCrawledGender(products: CrawledProduct[]): Map<string, ProductGender[]> {
  const index = new Map<string, ProductGender[]>()
  for (const product of products) {
    if (!product.productUrl) continue
    const productNo = cafe24ProductNo(product.productUrl)
    const gender = cleanGenderScope(product.gender)
    if (!productNo || gender.length !== 1) continue
    const previous = index.get(productNo)
    if (previous && previous[0] !== gender[0]) {
      throw new Error(`같은 product_no의 성별 충돌: ${productNo} (${previous[0]} vs ${gender[0]})`)
    }
    index.set(productNo, gender)
  }
  return index
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

async function main(): Promise<void> {
  const sites = (flag("site") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  if (sites.length === 0) throw new Error("--site=platform[,platform] 이 필요하다")
  const apply = process.argv.includes("--apply")
  const dataDir = path.resolve(flag("data-dir") ?? "data")
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

  const indexes = new Map<string, Map<string, ProductGender[]>>()
  for (const site of sites) {
    const file = path.join(dataDir, `${site}-products.json`)
    const products = JSON.parse(fs.readFileSync(file, "utf8")) as CrawledProduct[]
    const index = indexCrawledGender(products)
    indexes.set(site, index)
  }

  const db = createClient(dbUrl, dbToken)
  const categoryIndexes = new Map<string, Map<number, ProductGender[]>>()
  for (const site of sites) {
    const config = getSiteConfig(site)
    const categories = config?.category && "categories" in config.category
      ? config.category.categories ?? []
      : []
    const index = new Map<number, ProductGender[]>()
    for (const category of categories) {
      const gender = cleanGenderScope(category.gender)
      if (gender.length === 1) index.set(category.cateNo, gender)
    }
    categoryIndexes.set(site, index)
    if ((indexes.get(site)?.size ?? 0) === 0 && index.size === 0) {
      throw new Error(`${site}: 상품번호 또는 공식 카테고리 성별 근거가 없다`)
    }
  }

  const decisions: Array<LegacyRow & {
    after: ProductGender[]
    product_no: string | null
    evidence: "product_no" | "category"
  }> = []
  let scanned = 0
  let unmatched = 0
  for (const site of sites) {
    let cursor = 0
    for (;;) {
      const {data, error} = await db
        .from("products")
        .select("id,platform,product_url,gender,gender_source")
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
        const productNo = cafe24ProductNo(row.product_url)
        const categoryNo = cafe24CategoryNo(row.product_url)
        const productGender = productNo ? indexes.get(site)?.get(productNo) : undefined
        const categoryGender = categoryNo !== null ? categoryIndexes.get(site)?.get(categoryNo) : undefined
        const after = productGender ?? categoryGender
        if (!after) {
          unmatched += 1
          continue
        }
        decisions.push({
          ...row,
          after,
          product_no: productNo,
          evidence: productGender ? "product_no" : "category",
        })
      }
      if (rows.length < 1000) break
    }
  }

  const counts = new Map<string, number>()
  for (const decision of decisions) {
    const key = `${decision.platform}\t${decision.after[0]}\t${decision.evidence}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  console.log(`mode=${apply ? "apply" : "dry-run"} scanned=${scanned} matched=${decisions.length} unmatched=${unmatched}`)
  for (const [key, count] of [...counts].sort()) console.log(`${key}\t${count}`)
  for (const decision of decisions.slice(0, 10)) {
    console.log(`sample id=${decision.id} evidence=${decision.evidence} product_no=${decision.product_no} ${decision.gender} -> ${decision.after}`)
  }

  if (!apply) return
  let updated = 0
  let stale = 0
  const groups = new Map<string, typeof decisions>()
  for (const decision of decisions) {
    const key = JSON.stringify(decision.after)
    groups.set(key, [...(groups.get(key) ?? []), decision])
  }
  for (const [genderJson, group] of groups) {
    const gender = JSON.parse(genderJson) as ProductGender[]
    for (let i = 0; i < group.length; i += 100) {
      const batch = group.slice(i, i + 100)
      const {data, error} = await db
        .from("products")
        .update({gender, gender_source: "engine", updated_at: new Date().toISOString()})
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
