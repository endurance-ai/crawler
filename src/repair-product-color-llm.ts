#!/usr/bin/env npx tsx
/**
 * regex 로는 복구 불가능한 color 행(unresolved_kept — 텍스트 어디에도 색상
 * 신호가 없는 행, 예: Zara/Uniqlo 내부 숫자 색상코드)을 hybrid LLM
 * (enrichProductWithLlm)으로 실제 상품 페이지를 방문해 재분석하고, **color
 * 필드만** UPDATE 한다.
 *
 * category/subcategory/description/gender 는 이미 QC 게이트를 통과한 상태라
 * 건드리지 않는다 — 이 스크립트가 손대는 건 오직 color 하나다.
 *
 * enrichProductWithLlm 은 라이브 페이지 텍스트(title/breadcrumb/jsonLd/
 * description) + 크롤러가 이미 갖고 있는 tags/기존 raw color(참고용, 신뢰 안 함)
 * 를 입력으로 쓴다 (비전/이미지는 안 봄).
 *
 * refresh-candidates.ts 의 큐 파이프라인을 재사용하지 않는 이유: 그쪽 upsert 는
 * `ignoreDuplicates: true` 라 이미 존재하는 상품 행은 절대 덮어쓰지 않는다
 * (신규 후보 적재 전용 설계) — 우리 대상은 이미 적재된 행이라 그 경로로는
 * color 업데이트가 조용히 무시된다. enrichProductWithLlm 자체는 그대로
 * 재사용하고, DB 쓰기만 plain UPDATE 로 새로 구현한다.
 *
 * 사용법:
 *   pnpm repair:product-color-llm --limit=20              # 시험 실행
 *   pnpm repair:product-color-llm --platform=zara-kr
 *   pnpm repair:product-color-llm --sleep-ms=500
 */

import {chromium} from "playwright"

import {getSiteConfig} from "./configs/platforms"
import {classifyColorRepair, type ProductColorRow} from "./lib/color-repair"
import {enrichProductWithLlm} from "./lib/llm-product-enrichment"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {normalizeColorField} from "./lib/product-qc/normalization"
import type {Product} from "./lib/types"

const PAGE_SIZE = 1000

const COLUMNS =
  "id,color,name,description,subcategory,tags,product_url,platform,brand,brand_node_id," +
  "category,price,original_price,sale_price,image_url,in_stock,gender,crawled_at"

interface FullRow extends ProductColorRow {
  category: string
  price: number | null
  original_price: number | null
  sale_price: number | null
  image_url: string
  in_stock: boolean
  gender: string[] | null
  crawled_at: string
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

/**
 * products 를 id keyset 으로 스캔하며 unresolved_kept 색상 행만 골라낸다.
 * 별도 plan 파일이 없다 — color-repair.ts 의 writePlan 은 after!==null 인
 * 것만 저장해서 unresolved_kept(after 항상 null)는 애초에 plan 파일에 없다.
 */
async function* streamUnresolved(
  db: ProductCollectionClient,
  opts: {platform: string | null; limit: number | null},
): AsyncGenerator<FullRow> {
  let cursor = 0
  let yielded = 0
  for (;;) {
    let q = db.from("products").select(COLUMNS).gt("id", cursor).order("id", {ascending: true}).limit(PAGE_SIZE)
    if (opts.platform) q = q.eq("platform", opts.platform)
    const {data, error} = await q
    if (error) throw new Error(`products load failed: ${error.message}`)
    const page = (data ?? []) as unknown as FullRow[]
    if (page.length === 0) return

    cursor = page[page.length - 1].id
    for (const row of page) {
      if (opts.limit !== null && yielded >= opts.limit) return
      if (classifyColorRepair(row).bucket !== "unresolved_kept") continue
      yielded += 1
      yield row
    }
    if (page.length < PAGE_SIZE) return
  }
}

function toProduct(row: FullRow): Product {
  return {
    brand: row.brand ?? "",
    name: row.name ?? "",
    category: row.category,
    price: row.price,
    originalPrice: row.original_price,
    salePrice: row.sale_price,
    priceFormatted: "",
    imageUrl: row.image_url,
    productUrl: row.product_url,
    inStock: row.in_stock,
    gender: row.gender ?? [],
    platform: row.platform ?? "",
    crawledAt: row.crawled_at,
    description: row.description ?? undefined,
    color: row.color ?? undefined,
    subcategory: row.subcategory ?? undefined,
    tags: row.tags ?? undefined,
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required")

  const platform = flag("platform")
  const limit = flag("limit") !== null ? Number(flag("limit")) : null
  const sleepMs = flag("sleep-ms") !== null ? Number(flag("sleep-ms")) : 0

  const db = createProductCollectionClient()
  const browser = await chromium.launch({headless: true})
  const page = await browser.newPage()

  let scanned = 0
  let updated = 0
  let stillUnresolved = 0
  let failed = 0
  let skippedNoConfig = 0

  try {
    for await (const row of streamUnresolved(db, {platform, limit})) {
      scanned += 1
      const config = getSiteConfig(row.platform ?? "")
      if (!config || config.disabled) {
        skippedNoConfig += 1
        console.log(`  ⏭️  id=${row.id} platform=${row.platform} — no site config, skipping`)
        continue
      }

      try {
        const enrichment = await enrichProductWithLlm(page, toProduct(row), config)
        const resolved = normalizeColorField(enrichment.product)

        if (!resolved.value || resolved.needsReview || resolved.value === row.color) {
          stillUnresolved += 1
          console.log(`  ➖ id=${row.id} "${row.color}" — llm gave no usable color (${enrichment.product.color ?? "null"})`)
          continue
        }

        const {error} = await db
          .from("products")
          .update({color: resolved.value, updated_at: new Date().toISOString()})
          .eq("id", row.id)
          .eq("color", row.color as string)
        if (error) throw new Error(error.message)

        updated += 1
        console.log(`  ✅ id=${row.id} "${row.color}" -> "${resolved.value}"`)
      } catch (err) {
        failed += 1
        console.warn(`  ⚠️  id=${row.id} failed: ${err instanceof Error ? err.message : err}`)
      }

      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
    }
  } finally {
    await browser.close()
  }

  console.log(
    `\nscanned=${scanned} updated=${updated} still_unresolved=${stillUnresolved} ` +
      `failed=${failed} skipped_no_config=${skippedNoConfig}`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
