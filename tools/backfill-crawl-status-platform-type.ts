#!/usr/bin/env npx tsx
/**
 * product_crawl_status.platform_type = 'unknown' 을 products.platform 실측으로 채운다.
 *
 * 이게 채워지면 `generate-platform-configs` 가 해당 브랜드의 config 를 emit 하고,
 * 그때부터 refresh 워크리스트에 편입돼 가격·재고가 갱신된다. 배경과 근거는
 * `src/lib/platform-type-backfill.ts` 헤더 참조.
 *
 * 기본은 dry-run 이다. 쓰기는 --apply 를 명시해야 한다.
 *
 *   tsx tools/backfill-crawl-status-platform-type.ts                # 계획만
 *   tsx tools/backfill-crawl-status-platform-type.ts --type=shopify # 엔진 한정
 *   tsx tools/backfill-crawl-status-platform-type.ts --apply
 */

import {createProductCollectionClient} from "../src/lib/product-collection"
import {
  planPlatformTypeBackfill,
  type PlatformTypeBackfillInput,
} from "../src/lib/platform-type-backfill"

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

interface BrandRow {
  brand_node_id: number
  platform_key: string | null
  platform_type: string
  categories: unknown
}

async function page<T>(
  load: (from: number, to: number) => PromiseLike<{data: unknown; error: {message: string} | null}>,
  label: string,
): Promise<T[]> {
  const rows: T[] = []
  const size = 1000
  for (let offset = 0; ; offset += size) {
    const {data, error} = await load(offset, offset + size - 1)
    if (error) throw new Error(`${label} 조회 실패: ${error.message}`)
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < size) break
  }
  return rows
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply")
  const typeFilter = flag("type")
  const db = createProductCollectionClient()

  const brands = await page<BrandRow>(
    (from, to) =>
      db
        .from("product_crawl_brands")
        .select("brand_node_id,platform_key,platform_type,categories")
        .eq("platform_type", "unknown")
        .not("homepage_url", "is", null)
        .not("platform_key", "is", null)
        .range(from, to),
    "product_crawl_brands",
  )

  // 엔진 타입이 소스 키 자리에 박힌 상품만 근거로 쓴다 — 이미 정상 라벨인 상품은
  // 그 소스가 refresh 로 돌고 있다는 뜻이라 백필 대상이 아니다.
  const products = await page<{brand_node_id: number | null; platform: string; in_stock: boolean}>(
    (from, to) =>
      db
        .from("products")
        .select("brand_node_id,platform,in_stock")
        .in("platform", ["cafe24", "shopify"])
        .range(from, to),
    "products",
  )

  const evidence = new Map<number, {platforms: string[]; inStock: number}>()
  for (const product of products) {
    if (product.brand_node_id === null) continue
    const bucket = evidence.get(product.brand_node_id) ?? {platforms: [], inStock: 0}
    bucket.platforms.push(product.platform)
    if (product.in_stock) bucket.inStock += 1
    evidence.set(product.brand_node_id, bucket)
  }

  const inputs: PlatformTypeBackfillInput[] = brands
    .filter((row): row is BrandRow & {platform_key: string} => row.platform_key !== null)
    .map((row) => ({
      brand_node_id: row.brand_node_id,
      platform_key: row.platform_key,
      platform_type: row.platform_type,
      productPlatforms: evidence.get(row.brand_node_id)?.platforms ?? [],
      inStockProducts: evidence.get(row.brand_node_id)?.inStock ?? 0,
      categoryCount: Array.isArray(row.categories) ? row.categories.length : 0,
    }))

  const plan = planPlatformTypeBackfill(inputs)
  const changes = typeFilter ? plan.changes.filter((c) => c.to === typeFilter) : plan.changes

  const byType = new Map<string, {brands: number; products: number; needsDetection: number}>()
  for (const change of changes) {
    const cur = byType.get(change.to) ?? {brands: 0, products: 0, needsDetection: 0}
    cur.brands += 1
    cur.products += change.inStockProducts
    if (change.needsCategoryDetection) cur.needsDetection += 1
    byType.set(change.to, cur)
  }

  console.log(
    `unknown 브랜드 ${brands.length}개 · 백필 대상 ${changes.length}개` +
      ` · 보류 ${plan.skipped.length}개${typeFilter ? ` · --type=${typeFilter}` : ""}`,
  )
  for (const [type, stat] of byType) {
    console.log(
      `   ${type.padEnd(8)} 브랜드 ${String(stat.brands).padStart(3)}` +
        ` · 재고상품 ${stat.products.toLocaleString().padStart(6)}` +
        (stat.needsDetection > 0 ? `  ⚠️ cateNo 재탐지 필요 ${stat.needsDetection}개` : ""),
    )
  }
  console.log("\n상위 15:")
  for (const change of changes.slice(0, 15)) {
    console.log(
      `   ${change.platform_key.padEnd(20)} unknown→${change.to.padEnd(8)}` +
        ` 재고 ${String(change.inStockProducts).padStart(4)}` +
        (change.needsCategoryDetection ? "  ⚠️ categories 없음" : ""),
    )
  }
  if (plan.skipped.length > 0) {
    console.log(`\n보류 사유: ${plan.skipped.slice(0, 10).map((s) => `${s.platform_key}(${s.reason})`).join(", ")}`)
  }

  if (!apply) {
    console.log("\n(dry-run — DB 쓰기 없음. 적용은 --apply)")
    console.log("적용 후 `tsx tools/generate-platform-configs.ts` 를 돌려야 config 가 생긴다.")
    return
  }

  let updated = 0
  for (const change of changes) {
    const {error} = await db
      .from("product_crawl_status")
      .update({platform_type: change.to})
      .eq("brand_node_id", change.brand_node_id)
      .eq("platform_type", "unknown") // 그 사이 값이 바뀌었으면 건드리지 않는다
    if (error) {
      console.error(`   ❌ ${change.platform_key}: ${error.message}`)
      continue
    }
    updated += 1
  }
  console.log(`\n적용 ${updated}/${changes.length}건`)
  console.log("다음: `tsx tools/generate-platform-configs.ts` → 생성된 config 검증 크롤")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
