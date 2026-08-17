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
import {
  cleanGenderScope,
  inferGenderFromModelDescription,
  type ProductGender,
} from "../src/lib/product-gender"

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

export function cafe24SelectedCategoryNo(html: string): number | null {
  const value = html.match(/#category_no option\[value=(\d+)\]/)?.[1]
  return value ? Number(value) : null
}

export function cafe24CanonicalDetailMatchesProduct(html: string, productNo: string): boolean {
  const escaped = productNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`aProductPurchaseInfo_${escaped}\\b`).test(html)
}

export function cafe24CanonicalDetailGender(
  html: string,
  enabled: boolean,
): ProductGender[] | null {
  if (!enabled) return null
  const gender = inferGenderFromModelDescription(html)
  return gender ? [gender] : null
}

export function cafe24CanonicalDetailUrl(baseUrl: string, productNo: string): string {
  const url = new URL("/product/detail.html", baseUrl)
  url.searchParams.set("product_no", productNo)
  return url.toString()
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

export function cafe24ListingProductNos(html: string): string[] {
  return [...html.matchAll(/(?:[?&]|&amp;)product_no=(\d+)/gi)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index)
}

export function cafe24ListingLastPage(html: string, categoryNo: number): number {
  const pages = [...html.matchAll(/cate_no=(\d+)(?:&|&amp;)page=(\d+)/gi)]
    .filter((match) => Number(match[1]) === categoryNo)
    .map((match) => Number(match[2]))
    .filter(Number.isFinite)
  return Math.max(1, ...pages)
}

const OFFICIAL_CATEGORY_LIST_PATHS: Record<string, string> = {
  // LOW CLASSIC은 Cafe24 기본 list.html 대신 현재 공식 Lc 목록 템플릿을 쓴다.
  lowclassic: "/product/lc-list.html",
}

export function cafe24OfficialCategoryUrl(
  site: string,
  baseUrl: string,
  categoryNo: number,
  page = 1,
): string {
  const url = new URL(OFFICIAL_CATEGORY_LIST_PATHS[site] ?? "/product/list.html", baseUrl)
  url.searchParams.set("cate_no", String(categoryNo))
  if (page > 1) url.searchParams.set("page", String(page))
  return url.toString()
}

export function indexCrawledGender(products: CrawledProduct[]): Map<string, ProductGender[]> {
  const observations = new Map<string, ProductGender[][]>()
  for (const product of products) {
    if (!product.productUrl) continue
    // genderSource가 없는 과거 캐시는 default/unisex 오염 여부를 판별할 수 없다.
    // 공식 부서·상품 근거로 재생성된 engine/url/text 결과만 복구 증거로 사용한다.
    if (!new Set(["engine", "url", "text"]).has(product.genderSource ?? "")) continue
    const productNo = cafe24ProductNo(product.productUrl)
    const gender = cleanGenderScope(product.gender)
    if (!productNo || gender.length !== 1) continue
    observations.set(productNo, [...(observations.get(productNo) ?? []), gender])
  }
  const index = new Map<string, ProductGender[]>()
  for (const [productNo, genders] of observations) {
    const merged = mergeDepartmentGenders(genders)
    if (merged) index.set(productNo, merged)
  }
  return index
}

export function mergeDepartmentGenders(genders: ProductGender[][]): ProductGender[] | null {
  const values = new Set(genders.flat())
  if (values.has("unisex") || (values.has("men") && values.has("women"))) return ["unisex"]
  if (values.size === 1) return [[...values][0]]
  return null
}

const OFFICIAL_PRODUCT_GENDER_OVERRIDES: Record<string, Record<string, ProductGender[]>> = {
  // 공식 상세/카테고리 캐시로 색상 형제까지 교차 확인한, 부서 URL이 유실된 4건.
  // 75: WOMEN 색상 카테고리(112), 84/89: 상세 설명 `남녀공용`,
  // 95: WOMEN 색상 카테고리(112)와 MEN 후디 카테고리(49)에 동일 모델이 함께 노출.
  theinnrs: {
    "75": ["women"],
    "84": ["unisex"],
    "89": ["unisex"],
    "95": ["unisex"],
  },
}

export function officialProductGender(site: string, productNo: string): ProductGender[] | null {
  return OFFICIAL_PRODUCT_GENDER_OVERRIDES[site]?.[productNo] ?? null
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

async function main(): Promise<void> {
  const sites = (flag("site") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  if (sites.length === 0) throw new Error("--site=platform[,platform] 이 필요하다")
  const apply = process.argv.includes("--apply")
  const canonicalDetail = process.argv.includes("--canonical-detail")
  const officialListings = process.argv.includes("--official-listings")
  const dataDir = path.resolve(flag("data-dir") ?? "data")
  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

  const indexes = new Map<string, Map<string, ProductGender[]>>()
  for (const site of sites) {
    const file = path.join(dataDir, `${site}-products.json`)
    const products = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8")) as CrawledProduct[]
      : canonicalDetail ? [] : (() => { throw new Error(`${file}: 크롤 결과 파일이 없다`) })()
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
    if (
      (indexes.get(site)?.size ?? 0) === 0
      && index.size === 0
      && !(canonicalDetail && config?.genderFromModelDescription === true)
    ) {
      throw new Error(`${site}: 상품번호 또는 공식 카테고리 성별 근거가 없다`)
    }
  }

  if (officialListings) {
    for (const site of sites) {
      const config = getSiteConfig(site)
      if (!config?.baseUrl) throw new Error(`${site}: baseUrl이 없다`)
      const observations = new Map<string, ProductGender[][]>()
      for (const [categoryNo, gender] of categoryIndexes.get(site) ?? []) {
        const firstUrl = cafe24OfficialCategoryUrl(site, config.baseUrl, categoryNo)
        const firstResponse = await fetch(firstUrl, {signal: AbortSignal.timeout(20_000)})
        if (!firstResponse.ok) throw new Error(`${site} cate_no=${categoryNo}: HTTP ${firstResponse.status}`)
        const firstHtml = await firstResponse.text()
        const lastPage = Math.min(cafe24ListingLastPage(firstHtml, categoryNo), 100)
        const htmlPages = [firstHtml]
        for (let page = 2; page <= lastPage; page += 1) {
          const response = await fetch(
            cafe24OfficialCategoryUrl(site, config.baseUrl, categoryNo, page),
            {signal: AbortSignal.timeout(20_000)},
          )
          if (!response.ok) throw new Error(`${site} cate_no=${categoryNo} page=${page}: HTTP ${response.status}`)
          htmlPages.push(await response.text())
        }
        const productNos = new Set(htmlPages.flatMap(cafe24ListingProductNos))
        console.log(`${site} official-listing cate_no=${categoryNo} pages=${lastPage} products=${productNos.size}`)
        for (const productNo of productNos) {
          observations.set(productNo, [...(observations.get(productNo) ?? []), gender])
        }
      }
      const index = indexes.get(site) ?? new Map<string, ProductGender[]>()
      for (const [productNo, genders] of observations) {
        const merged = mergeDepartmentGenders(genders)
        if (merged) index.set(productNo, merged)
      }
      indexes.set(site, index)
    }
  }

  const decisions: Array<LegacyRow & {
    after: ProductGender[]
    product_no: string | null
    evidence: "product_no" | "category" | "canonical_category" | "canonical_detail"
  }> = []
  let scanned = 0
  let unmatched = 0
  const unresolved: Array<LegacyRow & {product_no: string | null}> = []
  const scannedRows: Array<LegacyRow & {product_no: string | null; category_no: number | null}> = []
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
        scannedRows.push({
          ...row,
          product_no: cafe24ProductNo(row.product_url),
          category_no: cafe24CategoryNo(row.product_url),
        })
      }
      if (rows.length < 1000) break
    }
  }

  const departmentGenders = new Map<string, ProductGender[][]>()
  for (const row of scannedRows) {
    if (!row.product_no || row.category_no === null) continue
    const gender = categoryIndexes.get(row.platform)?.get(row.category_no)
    if (!gender) continue
    const key = `${row.platform}:${row.product_no}`
    departmentGenders.set(key, [...(departmentGenders.get(key) ?? []), gender])
  }
  for (const row of scannedRows) {
    const productGender = row.product_no
      ? indexes.get(row.platform)?.get(row.product_no) ?? officialProductGender(row.platform, row.product_no)
      : undefined
    const mergedGender = row.product_no
      ? mergeDepartmentGenders(departmentGenders.get(`${row.platform}:${row.product_no}`) ?? [])
      : null
    const categoryGender = row.category_no !== null ? categoryIndexes.get(row.platform)?.get(row.category_no) : undefined
    const after = productGender ?? mergedGender ?? categoryGender
    if (!after) {
      unresolved.push({...row, product_no: row.product_no})
      continue
    }
    decisions.push({
      ...row,
      after,
      product_no: row.product_no,
      evidence: productGender ? "product_no" : "category",
    })
  }

  if (canonicalDetail) {
    const cache = new Map<string, Promise<{categoryNo: number | null; gender: ProductGender[] | null}>>()
    const readDetail = (
      site: string,
      productNo: string,
    ): Promise<{categoryNo: number | null; gender: ProductGender[] | null}> => {
      const key = `${site}:${productNo}`
      const existing = cache.get(key)
      if (existing) return existing
      const baseUrl = getSiteConfig(site)?.baseUrl
      const config = getSiteConfig(site)
      const request = !baseUrl
        ? Promise.resolve({categoryNo: null, gender: null})
        : fetch(cafe24CanonicalDetailUrl(baseUrl, productNo), {signal: AbortSignal.timeout(20_000)})
            .then(async (response) => {
              if (!response.ok) return {categoryNo: null, gender: null}
              const html = await response.text()
              if (!cafe24CanonicalDetailMatchesProduct(html, productNo)) {
                return {categoryNo: null, gender: null}
              }
              return {
                categoryNo: cafe24SelectedCategoryNo(html),
                gender: cafe24CanonicalDetailGender(html, config?.genderFromModelDescription === true),
              }
            })
            .catch(() => ({categoryNo: null, gender: null}))
      cache.set(key, request)
      return request
    }
    let cursor = 0
    const workers = Array.from({length: Math.min(8, unresolved.length)}, async () => {
      while (cursor < unresolved.length) {
        const row = unresolved[cursor++]
        const detail = row.product_no
          ? await readDetail(row.platform, row.product_no)
          : {categoryNo: null, gender: null}
        const after = detail.gender
          ?? (detail.categoryNo !== null ? categoryIndexes.get(row.platform)?.get(detail.categoryNo) : undefined)
        if (!after) {
          unmatched += 1
          continue
        }
        decisions.push({
          ...row,
          after,
          evidence: detail.gender ? "canonical_detail" : "canonical_category",
        })
      }
    })
    await Promise.all(workers)
  } else {
    unmatched = unresolved.length
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
