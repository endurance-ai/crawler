#!/usr/bin/env npx tsx
/**
 * 이미 적재된 products.color 의 raw 노이즈를 canonical 값으로 교정한다.
 *
 * 배경: normalizeColorField 가 없던 시절 적재된 legacy 행 + COLOR_RULES 에 아직
 * 없는 색상명의 title-case passthrough 가 22,000여개의 distinct raw 값을 만들었다.
 * QC 게이트는 이 스크립트와 같은 시점부터 존재했으므로, 이후 크롤은 자동으로
 * canonical 값을 적재한다 — 이 스크립트는 **그 이전에 이미 적재된 행**의 일회성
 * 백필이다.
 *
 * products.color 는 NOT NULL 제약이라 **절대 null 로 쓰지 않는다** — 근거 없는
 * 행(unresolved_kept)은 원래 값을 그대로 둔다. gender/subcategory repair 와
 * 동일하게 이 스크립트도 **UPDATE 만** 한다 (DELETE 권한 없음 + CASCADE 로 인한
 * 영구 소실 방지).
 *
 * 사용법:
 *   pnpm repair:product-color --plan=./data/repair/color-2026-07-27.json
 *   pnpm repair:product-color --apply=./data/repair/color-2026-07-27.json [--platform=x]
 *
 * 플래그:
 *   --plan=<path>   읽기 전용. 분류 + 분포 출력 + 계획 파일 생성 (= dry run)
 *   --apply=<path>  계획 파일 재검증 후 쓰기
 *   --platform=     특정 플랫폼만 (단계적 적용)
 *   --limit=        최대 처리 행 수
 *   --sleep-ms=     배치 간 대기
 *   --force         기존 계획 파일 덮어쓰기
 */

import * as fs from "node:fs"
import * as path from "node:path"

import {
  classifyColorRepair,
  summarizeColorRepair,
  type ColorRepairBucket,
  type ColorRepairDecision,
  type ColorRepairSummary,
  type ProductColorRow,
} from "./lib/color-repair"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"

const PAGE_SIZE = 1000
const WRITE_BATCH = 100

const COLUMNS = "id,color,name,description,subcategory,tags,product_url,platform,brand,brand_node_id"

interface RepairPlanFile {
  version: 1
  generated_at: string
  filters: {platform: string | null; limit: number | null}
  scanned: number
  writable: number
  by_bucket: ColorRepairSummary["byBucket"]
  decisions: ColorRepairDecision[]
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

// ─── 로드 ────────────────────────────────────────────────────────────────

/**
 * products 를 id keyset 으로 페이징한다.
 *
 * offset 페이징(.range)을 쓰면 안 된다 — apply 가 스캔 대상 행을 변경하므로
 * 이후 페이지가 밀려 행이 조용히 누락된다 (repair-product-gender.ts 와 동일 근거).
 */
async function* streamProducts(
  db: ProductCollectionClient,
  opts: {platform: string | null; limit: number | null},
): AsyncGenerator<ProductColorRow[]> {
  let cursor = 0
  let yielded = 0
  for (;;) {
    let q = db.from("products").select(COLUMNS).gt("id", cursor).order("id", {ascending: true}).limit(PAGE_SIZE)
    if (opts.platform) q = q.eq("platform", opts.platform)

    const {data, error} = await q
    if (error) throw new Error(`products load failed: ${error.message}`)
    const page = (data ?? []) as unknown as ProductColorRow[]
    if (page.length === 0) return

    cursor = page[page.length - 1].id
    const capped = opts.limit !== null ? page.slice(0, opts.limit - yielded) : page
    yielded += capped.length
    yield capped
    if (page.length < PAGE_SIZE) return
    if (opts.limit !== null && yielded >= opts.limit) return
  }
}

// ─── 출력 ────────────────────────────────────────────────────────────────

const BUCKET_ORDER: ColorRepairBucket[] = ["canonicalized", "text_fallback", "recased", "unresolved_kept", "unchanged"]

function printSummary(s: ColorRepairSummary): void {
  console.log(`\n스캔 ${s.total}행, 쓰기 대상 ${s.writable}행\n`)
  console.log("── 버킷 분포 ─────────────────────────────")
  for (const bucket of BUCKET_ORDER) {
    const n = s.byBucket[bucket]
    if (n === 0) continue
    const pct = s.total > 0 ? ((n / s.total) * 100).toFixed(1) : "0.0"
    console.log(`  ${bucket.padEnd(22)} ${String(n).padStart(7)}  (${pct}%)`)
  }

  console.log("\n── 플랫폼별 상위 20 ──────────────────────")
  for (const p of s.byPlatform.slice(0, 20)) {
    const detail = BUCKET_ORDER.filter((b) => p.counts[b] > 0).map((b) => `${b}=${p.counts[b]}`).join(" ")
    console.log(`  ${(p.platform || "(none)").padEnd(24)} ${String(p.total).padStart(6)}  ${detail}`)
  }

  console.log("\n── 샘플 (버킷당 10건) ────────────────────")
  for (const bucket of BUCKET_ORDER) {
    const rows = s.samples[bucket]
    if (!rows || rows.length === 0) continue
    console.log(`\n  [${bucket}]`)
    for (const d of rows) {
      const afterLabel = bucket === "unchanged" || bucket === "unresolved_kept" ? "(변경없음)" : `"${d.after}"`
      console.log(`    id=${d.id} "${d.before}" -> ${afterLabel}${d.reason ? ` (${d.reason})` : ""}`)
      console.log(`      ${d.product_url}`)
    }
  }
}

// ─── plan ────────────────────────────────────────────────────────────────

async function writePlan(outputPath: string): Promise<void> {
  const absolute = path.resolve(outputPath)
  if (fs.existsSync(absolute) && !has("force")) {
    throw new Error(`plan exists: ${absolute} (--force 로 덮어쓰기)`)
  }
  fs.mkdirSync(path.dirname(absolute), {recursive: true})

  const platform = flag("platform")
  const limit = flag("limit") !== null ? Number(flag("limit")) : null

  const db = createProductCollectionClient()

  const decisions: ColorRepairDecision[] = []
  for await (const page of streamProducts(db, {platform, limit})) {
    for (const row of page) decisions.push(classifyColorRepair(row))
    process.stdout.write(`\r   🔍 ${decisions.length}행 분류`)
  }
  console.log("")

  const summary = summarizeColorRepair(decisions)
  printSummary(summary)

  const plan: RepairPlanFile = {
    version: 1,
    generated_at: new Date().toISOString(),
    filters: {platform, limit},
    scanned: summary.total,
    writable: summary.writable,
    by_bucket: summary.byBucket,
    decisions: decisions.filter((d) => d.after !== null),
  }
  fs.writeFileSync(absolute, `${JSON.stringify(plan, null, 2)}\n`, {flag: "w"})
  console.log(`\n📋 계획 저장: ${absolute}`)
  console.log(`   적용: pnpm repair:product-color --apply=${outputPath}`)
  console.log("   ⚠️  적용 전 recased 샘플을 육안 확인할 것 (title-case passthrough 오탐 가능성).")
}

// ─── apply ───────────────────────────────────────────────────────────────

function validatePlan(raw: unknown): RepairPlanFile {
  if (!raw || typeof raw !== "object") throw new Error("invalid plan")
  const plan = raw as Partial<RepairPlanFile>
  if (plan.version !== 1 || !Array.isArray(plan.decisions)) throw new Error("unsupported repair plan")
  for (const d of plan.decisions) {
    if (!Number.isInteger(d.id) || typeof d.product_url !== "string" || typeof d.after !== "string") {
      throw new Error(`invalid repair plan row: id=${(d as {id?: unknown}).id}`)
    }
  }
  return plan as RepairPlanFile
}

function progressPath(planPath: string): string {
  return `${planPath}.progress.json`
}

function loadProgress(planPath: string): Set<number> {
  const p = progressPath(planPath)
  if (!fs.existsSync(p)) return new Set()
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {applied: number[]}
  return new Set(raw.applied ?? [])
}

function saveProgress(planPath: string, applied: Set<number>): void {
  fs.writeFileSync(progressPath(planPath), `${JSON.stringify({applied: [...applied]}, null, 0)}\n`, {flag: "w"})
}

async function applyPlan(planPath: string): Promise<void> {
  const absolute = path.resolve(planPath)
  const plan = validatePlan(JSON.parse(fs.readFileSync(absolute, "utf8")))

  const db = createProductCollectionClient()
  const platformFilter = flag("platform")
  const applied = loadProgress(absolute)
  if (applied.size > 0) console.log(`   ⏩ 이전 실행에서 ${applied.size}행 적용됨 — 건너뜀`)

  const targetIds = plan.decisions
    .filter((d) => !applied.has(d.id))
    .filter((d) => !platformFilter || d.platform === platformFilter)
    .map((d) => d.id)

  console.log(`🔁 계획 재검증: ${targetIds.length}행${platformFilter ? ` (platform=${platformFilter})` : ""}`)
  const expected = new Map(plan.decisions.map((d) => [d.id, d.after]))
  const rowsById = new Map<number, ProductColorRow>()
  for (let i = 0; i < targetIds.length; i += PAGE_SIZE) {
    const chunk = targetIds.slice(i, i + PAGE_SIZE)
    const {data, error} = await db.from("products").select(COLUMNS).in("id", chunk)
    if (error) throw new Error(`re-verify load failed: ${error.message}`)
    for (const row of (data ?? []) as unknown as ProductColorRow[]) rowsById.set(row.id, row)
  }

  let drifted = 0
  for (const id of targetIds) {
    const row = rowsById.get(id)
    if (!row) continue
    const now = classifyColorRepair(row)
    if (now.after !== expected.get(id)) drifted += 1
  }
  if (drifted > 0) {
    throw new Error(
      `계획 생성 이후 판정이 바뀐 행 ${drifted}건 — 계획을 다시 생성하라 (--plan). ` +
        "분류기 변경 또는 다른 경로의 재적재가 원인이다.",
    )
  }
  console.log("   ✅ drift 없음")

  const sleepMs = flag("sleep-ms") !== null ? Number(flag("sleep-ms")) : 0

  let updated = 0
  let stale = 0
  for (const d of plan.decisions) {
    if (applied.has(d.id)) continue
    if (platformFilter && d.platform !== platformFilter) continue

    const row = rowsById.get(d.id)
    if (!row) {
      stale += 1
      applied.add(d.id)
      continue
    }

    // 가드: 계획 생성 시점의 before 값과 현재 DB 값이 같을 때만 쓴다 — 재실행
    // 멱등 + 동시 import 와의 경쟁에서 안전.
    const {data, error} = await db
      .from("products")
      .update({color: d.after, updated_at: new Date().toISOString()})
      .eq("id", d.id)
      .eq("color", d.before)
      .select("id")
    if (error) throw new Error(`apply failed (id=${d.id}): ${error.message}`)

    const wrote = (data?.length ?? 0) > 0
    if (wrote) updated += 1
    else stale += 1
    applied.add(d.id)
    saveProgress(absolute, applied)
    process.stdout.write(`\r   💾 updated=${updated} stale=${stale}`)
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
  }
  console.log(`\n✅ applied=${updated} stale_or_already_changed=${stale} plan=${absolute}`)

  const touched = plan.decisions.filter((d) => !platformFilter || d.platform === platformFilter)
  await recordRuns(db, touched, updated, stale)
}

/**
 * 감사 추적: 이번 apply 호출에서 실제로 쓴 행의 brand_node 별로
 * product_crawl_runs 에 기록한다 (CLAUDE.md §18 패턴).
 */
async function recordRuns(
  db: ProductCollectionClient,
  touched: ColorRepairDecision[],
  updated: number,
  stale: number,
): Promise<void> {
  const byBrand = new Map<number, number>()
  for (const d of touched) {
    if (d.brand_node_id === null) continue
    byBrand.set(d.brand_node_id, (byBrand.get(d.brand_node_id) ?? 0) + 1)
  }
  if (byBrand.size === 0) return

  const bucketCounts: Record<string, number> = {}
  for (const d of touched) bucketCounts[d.bucket] = (bucketCounts[d.bucket] ?? 0) + 1

  const rows = [...byBrand.entries()].map(([brand_node_id, n]) => ({
    brand_node_id,
    stage: "manual",
    status: "success",
    metrics: {actor: "repair-product-color", rows: n, updated, stale, by_bucket: bucketCounts},
    created_at: new Date().toISOString(),
  }))
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const {error} = await db.from("product_crawl_runs").insert(rows.slice(i, i + WRITE_BATCH))
    if (error) {
      console.warn(`⚠️ product_crawl_runs 기록 실패: ${error.message}`)
      return
    }
  }
  console.log(`   📝 product_crawl_runs ${rows.length}건 기록`)
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const planOutput = flag("plan")
  const applyInput = flag("apply")
  if ((planOutput ? 1 : 0) + (applyInput ? 1 : 0) !== 1) {
    throw new Error("--plan=<path> (읽기 전용) 또는 --apply=<path> 중 하나만 지정하라")
  }
  if (planOutput) await writePlan(planOutput)
  else await applyPlan(applyInput!)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
