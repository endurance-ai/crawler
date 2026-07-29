#!/usr/bin/env npx tsx
/**
 * 재수집 캠페인 품질 지표 CLI.
 *
 *   # import 전 차단 게이트 (크롤+보강 산출 파일을 기존 DB 상태와 비교)
 *   pnpm recollect:metrics -- --file=data/kith-products.json --site=kith \
 *     --before=data/recollect/run-1/kith/before.json --out=/tmp/gate.json
 *
 *   # DB 스냅샷 (배치 전/후)
 *   pnpm recollect:metrics -- --platform=kith --out=data/recollect/run-1/kith/before.json
 *
 * --file 모드는 **import 전에** 돌려야 의미가 있다. products 의 upsert 는
 * product_url 충돌 시 행 전체를 덮어쓰므로 되돌릴 수 없고, 되돌릴 수 없는 쓰기
 * 앞이 유일하게 중단할 수 있는 지점이다.
 *
 * 종료 코드: 0 = 통과, 3 = 게이트 실패 (드라이버가 캠페인을 멈추는 신호), 1 = 오류.
 */

import * as fs from "node:fs"
import * as path from "node:path"

import {createClient, type SupabaseClient} from "@supabase/supabase-js"

import {readProductsFile} from "../src/lib/enrich-file"
import {
  computeRecollectMetrics,
  evaluateGate,
  type MetricsRow,
  type RecollectMetrics,
} from "../src/lib/recollect-metrics"
import type {Product} from "../src/lib/types"

const PAGE_SIZE = 1000

// ─── CLI ────────────────────────────────────────────

interface Flags {
  file: string
  platform: string
  site: string
  before: string
  out: string
  untouchedSince: string
}

function parseFlags(): Flags {
  const raw: Record<string, string | boolean> = {}
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue
    const [key, value] = arg.slice(2).split("=")
    raw[key!] = value ?? true
  }
  const str = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string) : "")
  return {
    file: str("file"),
    platform: str("platform"),
    site: str("site"),
    before: str("before"),
    out: str("out"),
    untouchedSince: str("untouched-since"),
  }
}

// ─── 입력 어댑터 ──────────────────────────────────────

/**
 * 크롤 산출 Product 를 지표 입력으로 변환한다.
 *
 * id 는 배열 인덱스를 쓴다 — 분류기(classifySubcategoryRepair 등)가 결정에
 * id 를 실어 보낼 뿐 판정에 쓰지는 않으므로 파일 모드에서는 임의값이면 충분하다.
 */
function productToMetricsRow(product: Product, index: number): MetricsRow {
  return {
    id: index,
    product_url: product.productUrl,
    platform: product.platform ?? null,
    brand: product.brand ?? null,
    brand_node_id: null,
    name: product.name ?? null,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    tags: product.tags ?? null,
    images: product.images ?? null,
    image_url: product.imageUrl ?? null,
    in_stock: product.inStock ?? null,
    updated_at: null,
  }
}

const SELECT_COLUMNS =
  "id,product_url,platform,brand,brand_node_id,name,category,subcategory,tags,images,image_url,in_stock,updated_at"

/**
 * keyset 페이징. offset 기반 .range() 는 페이지 사이에 행이 바뀌면 누락/중복이
 * 생기는데, 이 도구는 크롤 직후에도 돌기 때문에 id 커서를 쓴다.
 */
async function fetchPlatformRows(db: SupabaseClient, platform: string): Promise<MetricsRow[]> {
  const rows: MetricsRow[] = []
  let cursor = 0
  for (;;) {
    const {data, error} = await db
      .from("products")
      .select(SELECT_COLUMNS)
      .eq("platform", platform)
      .gt("id", cursor)
      .order("id", {ascending: true})
      .limit(PAGE_SIZE)
    if (error) throw new Error(`products 조회 실패: ${error.message}`)
    const page = (data ?? []) as MetricsRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    cursor = page[page.length - 1]!.id
  }
  return rows
}

// ─── 출력 ────────────────────────────────────────────

const pct = (numerator: number, denominator: number): string =>
  denominator === 0 ? "0.0%" : `${((numerator / denominator) * 100).toFixed(1)}%`

function printMetrics(label: string, m: RecollectMetrics): void {
  console.log(`\n── ${label} ──`)
  console.log(`  행수                ${m.rows} (재고 ${m.inStock} / 품절 ${m.outOfStock})`)
  console.log(`  subcategory 없음    ${m.subcategoryMissing} (${pct(m.subcategoryMissing, m.rows)})`)
  console.log(`  비canonical subcat  ${m.subcategoryNonCanonical} (${pct(m.subcategoryNonCanonical, m.rows)})`)
  console.log(`  taxonomy 밖 category ${m.categoryInvalid} (${pct(m.categoryInvalid, m.rows)})`)
  console.log(`  대표이미지 없음     ${m.imageMissing} · images 빈배열 ${m.imagesEmpty} (${pct(m.imagesEmpty, m.rows)})`)
  console.log(`  distinct brand      ${m.distinctBrands}`)
}

function printDelta(before: RecollectMetrics, after: RecollectMetrics): void {
  const line = (label: string, b: number, a: number, lowerIsBetter = true): void => {
    const diff = a - b
    const arrow = diff === 0 ? "=" : diff < 0 ? "▼" : "▲"
    const good = diff === 0 ? " " : (diff < 0) === lowerIsBetter ? "✅" : "⚠️"
    console.log(`  ${good} ${label.padEnd(22)} ${String(b).padStart(7)} → ${String(a).padStart(7)}  ${arrow}${Math.abs(diff)}`)
  }
  console.log(`\n── 변화 ──`)
  line("행수", before.rows, after.rows, false)
  line("subcategory 없음", before.subcategoryMissing, after.subcategoryMissing)
  line("taxonomy 밖 category", before.categoryInvalid, after.categoryInvalid)
  line("images 빈배열", before.imagesEmpty, after.imagesEmpty)
  line("distinct brand", before.distinctBrands, after.distinctBrands, false)
}

function writeOut(out: string, payload: unknown): void {
  const absolute = path.resolve(out)
  fs.mkdirSync(path.dirname(absolute), {recursive: true})
  fs.writeFileSync(absolute, JSON.stringify(payload, null, 2), "utf-8")
  console.log(`\n💾 ${absolute}`)
}

// ─── 메인 ────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags()
  if (!flags.file && !flags.platform) {
    console.error("usage: recollect-metrics --platform=<key> | --file=<products.json> [--before=<before.json>] [--out=<path>]")
    process.exit(1)
  }

  let rows: MetricsRow[]
  let label: string

  if (flags.file) {
    rows = readProductsFile(flags.file).map(productToMetricsRow)
    label = `파일 ${path.basename(flags.file)}`
  } else {
    if (!process.env.DB_URL || !process.env.DB_TOKEN) {
      console.error("❌ DB_URL / DB_TOKEN 이 필요합니다")
      process.exit(1)
    }
    const db = createClient(process.env.DB_URL, process.env.DB_TOKEN)
    rows = await fetchPlatformRows(db, flags.platform)
    label = `DB platform=${flags.platform}`
  }

  const metrics = computeRecollectMetrics(rows)
  printMetrics(label, metrics)

  // 미갱신 행: 배치 시작 이후로 updated_at 이 안 밀린 행 = 재수집이 건드리지
  // 못한 행. 조용한 no-op(옛 파일 재적재, 부분 크롤)을 잡아내는 유일한 지표다.
  let untouched: number | null = null
  if (flags.platform && flags.untouchedSince) {
    const since = new Date(flags.untouchedSince).getTime()
    if (Number.isNaN(since)) {
      console.error(`❌ --untouched-since 파싱 실패: ${flags.untouchedSince}`)
      process.exit(1)
    }
    untouched = rows.filter((row) => {
      if (!row.updated_at) return true
      return new Date(row.updated_at).getTime() < since
    }).length
    console.log(`  미갱신 행           ${untouched} (${pct(untouched, rows.length)}) — ${flags.untouchedSince} 이후 안 밀림`)
  }

  let before: RecollectMetrics | null = null
  if (flags.before) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(flags.before), "utf-8")) as {metrics?: RecollectMetrics}
    before = parsed.metrics ?? (parsed as unknown as RecollectMetrics)
    printMetrics("기준(before)", before)
    printDelta(before, metrics)
  }

  const payload = {
    label,
    platform: flags.platform || flags.site || null,
    file: flags.file || null,
    capturedAt: new Date().toISOString(),
    untouched,
    metrics,
  }
  if (flags.out) writeOut(flags.out, payload)

  // 게이트는 파일 모드(= import 직전)에서만 판정한다. DB 스냅샷은 관측 전용.
  if (flags.file) {
    const gate = evaluateGate(metrics, before)
    if (gate.pass) {
      console.log(`\n✅ 게이트 통과 — import 진행 가능`)
    } else {
      console.log(`\n🛑 게이트 실패 ${gate.failures.length}건 — import 하지 말 것`)
      for (const failure of gate.failures) console.log(`   - [${failure.check}] ${failure.detail}`)
      process.exit(3)
    }
  }
}

main().catch((error) => {
  console.error(`💥 recollect-metrics 오류: ${error instanceof Error ? error.stack : error}`)
  process.exit(1)
})
