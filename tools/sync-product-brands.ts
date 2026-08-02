#!/usr/bin/env npx tsx
/**
 * 단일브랜드 자사몰의 products.brand를 config.brand와 일치시킨다.
 *
 * 기본은 dry-run이다. `--apply`일 때만 DB를 수정한다. 멀티브랜드몰과
 * config.brand가 없는 플랫폼은 항상 제외한다.
 *
 *   npx dotenv -e .env.local -- npx tsx tools/sync-product-brands.ts
 *   npx dotenv -e .env.local -- npx tsx tools/sync-product-brands.ts --apply
 *   npx dotenv -e .env.local -- npx tsx tools/sync-product-brands.ts --site=apc-us --apply
 */

import {PLATFORMS} from "../src/configs/platforms"
import {createProductCollectionClient} from "../src/lib/product-collection"

const APPLY = process.argv.includes("--apply")
const siteArg = process.argv.find((arg) => arg.startsWith("--site="))
const requestedSites = siteArg
  ? new Set(siteArg.slice("--site=".length).split(",").map((value) => value.trim()).filter(Boolean))
  : null

interface ProductBrandRow {
  id: string | number
  platform: string
  brand: string | null
  brand_node_id: number | null
}

function loadTargets(): Map<string, string> {
  const targets = new Map<string, string>()
  for (const config of PLATFORMS) {
    const brand = config.brand?.trim()
    if (!brand || config.multiBrand || (requestedSites && !requestedSites.has(config.key))) continue
    const existing = targets.get(config.key)
    if (existing && existing !== brand) {
      throw new Error(`동일 platform key의 brand 충돌: ${config.key} (${existing} / ${brand})`)
    }
    targets.set(config.key, brand)
  }
  if (requestedSites) {
    const missing = [...requestedSites].filter((site) => !targets.has(site))
    if (missing.length > 0) {
      throw new Error(`단일브랜드 config.brand 대상을 찾지 못함: ${missing.join(", ")}`)
    }
  }
  return targets
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function main(): Promise<void> {
  const db = createProductCollectionClient()
  const targets = loadTargets()
  const brandNodeIds = new Map<string, number>()
  const mismatches = new Map<string, ProductBrandRow[]>()
  const platformKeys = [...targets.keys()]

  for (const platformChunk of chunks(platformKeys, 40)) {
    const {data, error} = await db
      .from("product_crawl_status")
      .select("platform_key,brand_node_id")
      .in("platform_key", platformChunk)
    if (error) throw new Error(`product_crawl_status 조회 실패: ${error.message}`)
    for (const row of (data ?? []) as Array<{platform_key: string | null; brand_node_id: number}>) {
      if (row.platform_key) brandNodeIds.set(row.platform_key, row.brand_node_id)
    }
  }

  // PostgREST URL 길이와 기본 1,000행 제한을 함께 피한다.
  for (const platformChunk of chunks(platformKeys, 40)) {
    const pageSize = 1000
    for (let offset = 0; ; offset += pageSize) {
      const {data, error} = await db
        .from("products")
        .select("id,platform,brand,brand_node_id")
        .in("platform", platformChunk)
        .range(offset, offset + pageSize - 1)
      if (error) throw new Error(`products 조회 실패: ${error.message}`)
      const rows = (data ?? []) as ProductBrandRow[]
      for (const row of rows) {
        const expected = targets.get(row.platform)
        const expectedNodeId = brandNodeIds.get(row.platform)
        const nodeMismatch = expectedNodeId !== undefined && row.brand_node_id !== expectedNodeId
        if (!expected || (row.brand === expected && !nodeMismatch)) continue
        const bucket = mismatches.get(row.platform) ?? []
        bucket.push(row)
        mismatches.set(row.platform, bucket)
      }
      if (rows.length < pageSize) break
    }
  }

  const total = [...mismatches.values()].reduce((sum, rows) => sum + rows.length, 0)
  console.log(`\n=== products.brand 동기화 — ${APPLY ? "APPLY" : "DRY-RUN"} ===`)
  console.log(`단일브랜드 config: ${targets.size}개`)
  console.log(`brand_node 연결 확인 가능: ${brandNodeIds.size}개`)
  console.log(`불일치 products: ${total}건`)

  for (const [platform, rows] of [...mismatches].sort(([a], [b]) => a.localeCompare(b))) {
    const expected = targets.get(platform)!
    const expectedNodeId = brandNodeIds.get(platform)
    const nodeMismatchCount = expectedNodeId === undefined
      ? 0
      : rows.filter((row) => row.brand_node_id !== expectedNodeId).length
    const oldCounts = new Map<string, number>()
    for (const row of rows) {
      const old = row.brand ?? "(null)"
      oldCounts.set(old, (oldCounts.get(old) ?? 0) + 1)
    }
    const samples = [...oldCounts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([brand, count]) => `${JSON.stringify(brand)} ${count}건`)
      .join(", ")
    console.log(
      `  ${platform}: ${rows.length}건 → ${JSON.stringify(expected)}` +
      `${expectedNodeId === undefined ? "" : ` / brand_node_id=${expectedNodeId} (${nodeMismatchCount}건)`}` +
      ` (${samples})`,
    )
  }

  if (!APPLY || total === 0) {
    if (!APPLY && total > 0) console.log("\n실제 반영하려면 --apply를 붙여 재실행하세요.")
    return
  }

  let updated = 0
  for (const [platform, rows] of mismatches) {
    const expected = targets.get(platform)!
    const expectedNodeId = brandNodeIds.get(platform)
    for (const idChunk of chunks(rows.map((row) => row.id), 250)) {
      const {data, error} = await db
        .from("products")
        .update({
          brand: expected,
          ...(expectedNodeId === undefined ? {} : {brand_node_id: expectedNodeId}),
        })
        .in("id", idChunk)
        .select("id")
      if (error) throw new Error(`${platform} brand 갱신 실패: ${error.message}`)
      updated += data?.length ?? 0
    }
  }
  if (updated !== total) throw new Error(`갱신 수 불일치: expected=${total}, updated=${updated}`)
  console.log(`\n✅ products 브랜드/브랜드 노드 ${updated}건 직접 반영 완료`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
