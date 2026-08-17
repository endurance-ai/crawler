#!/usr/bin/env npx tsx
/**
 * 이미 적재된 products.gender 를 DB 텍스트만으로 재판정한다.
 *
 * 주 용도(2026-08): 성별 출처가 VLM(product_features) 으로 이관돼 있던
 * 2026-07-30 ~ 2026-08-03 구간에 적재된 행은 products.gender 가 NULL 이다.
 * VLM gender 성능 미달로 크롤러에 회귀했으므로, 재크롤 없이 name/product_url/
 * category/tags 로 되채운다 (`--scope=null-gender`, 기본값).
 *
 * 주 용도(2026-08-05): `--scope=multi-gender`. products.gender 가 `['men','women']`
 * 처럼 다중값인 행 — 구 shopify 태그 union(`"womens".includes("men")`) 잔재다.
 * 검색 RPC 가 `p.gender && ARRAY[p_gender,'unisex']` 로 매칭하므로 unisex 와
 * 똑같이 남녀 양쪽에 노출되는데, 실제로는 "남녀공용"이 아니라 "판정 실패"다.
 * 실측: 16,468행 중 12,672행이 DB 텍스트 재판정만으로 단일값 확정된다.
 *
 * 부차 용도: migration 091 이 brand_nodes.gender_scope 에서 일괄 백필한
 * 13,942행 중 `['unisex']` 세탁분 교정 (`--scope=unisex`). 검색 RPC 는 unisex 를
 * 남녀 양쪽에 노출하므로 그 상품들이 남성 결과에 여성복으로 떠 있다.
 *
 * 브랜드 스코프는 근거로 쓰지 않는다 — 2026-08 회귀에서 폴백을 복원하지 않았다
 * (src/lib/product-gender.ts 헤더). 근거를 못 찾으면 unverified 로 남긴다.
 *
 * 이 스크립트는 **UPDATE 만** 한다. DELETE 는 하지 않는다 — products 는
 * product_embeddings / product_features / product_reviews 가 ON DELETE CASCADE 로
 * 물려 있어, 삭제하면 임베딩(halfvec 768)과 리뷰가 영구 소실되고 복구에 재크롤 +
 * 재임베딩이 든다. 그래서 삭제는 매니페스트를 남기고 관리자가 검토하는 런북에서만
 * 한다 (sql/runbooks/).
 *
 * 정정 (2026-08-05): 이 헤더는 원래 "크롤러 DB role 에 DELETE/TRUNCATE 권한이
 * 없다" 고 적고 있었다. **틀렸다** — 권한은 있다(잔여 2,733행 삭제에 실제로
 * 썼다). 삭제를 런북으로 미루는 이유는 권한이 아니라 위 CASCADE 다. 권한이
 * 없다고 믿으면 "스크립트가 못 하니 안전하다" 는 잘못된 안심을 하게 된다.
 *
 * 사용법:
 *   pnpm repair:product-gender --plan=./data/repair/gender-2026-07-27.json
 *   pnpm repair:product-gender --apply=./data/repair/gender-2026-07-27.json [--platform=x]
 *
 * 플래그:
 *   --plan=<path>     읽기 전용. 분류 + 분포 출력 + 계획 파일 생성 (= dry run)
 *   --apply=<path>    계획 파일 재검증 후 쓰기
 *   --scope=          null-gender(기본) | multi-gender | unisex | unverified-legacy | all | source-null
 *   --platform=       특정 플랫폼만 (단계적 적용)
 *   --brand-node=     특정 brand_node_id 만
 *   --limit=          최대 처리 행 수
 *   --use-description description 을 텍스트 추론에 포함 (기본 제외 — 오탐 방지)
 *   --stamp-unverified  unverified/kids 행에도 gender_source 를 기록
 *   --sleep-ms=       배치 간 대기
 *   --force           기존 계획 파일 덮어쓰기
 */

import * as fs from "node:fs"
import * as path from "node:path"

import {getSiteConfig} from "./configs/platforms"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {cleanGenderScope, type ProductGender} from "./lib/product-gender"
import {
  classifyGenderRepair,
  summarizeGenderRepair,
  type GenderRepairBucket,
  type GenderRepairDecision,
  type GenderRepairSummary,
  type ProductGenderRow,
} from "./lib/gender-repair"

const PAGE_SIZE = 1000
const WRITE_BATCH = 100

const BASE_COLUMNS =
  "id,gender,name,category,subcategory,description,product_url,tags,platform,brand,brand_node_id,last_seen_at"

/**
 * gender_source 는 마이그레이션 093 에서 추가된다. 아직 적용 전이어도 **분포
 * 측정(--plan)은 가능해야** 한다 — 스키마를 바꾸기 전에 오염 규모를 먼저 보는
 * 것이 이 작업의 순서이기 때문. 컬럼이 없으면 select 에서 빼고 null 로 다룬다.
 */
let hasGenderSourceColumn = false

async function detectGenderSourceColumn(db: ProductCollectionClient): Promise<boolean> {
  const {error} = await db.from("products").select("gender_source").limit(1)
  if (!error) return true
  if (/gender_source.*does not exist/i.test(error.message)) return false
  throw new Error(`gender_source 컬럼 확인 실패: ${error.message}`)
}

function selectColumns(): string {
  return hasGenderSourceColumn ? `${BASE_COLUMNS},gender_source` : BASE_COLUMNS
}

interface RepairPlanFile {
  version: 1
  generated_at: string
  scope: string
  use_description: boolean
  filters: {platform: string | null; brand_node_id: number | null; limit: number | null}
  scanned: number
  writable: number
  by_bucket: GenderRepairSummary["byBucket"]
  decisions: GenderRepairDecision[]
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
 * 이후 페이지가 밀려 행이 조용히 누락된다.
 */
/**
 * `--scope=multi-gender` 의 행 필터.
 *
 * PostgREST 로는 `cardinality(gender) > 1` 을 직접 걸 수 없다. 정규값이
 * men/women/unisex 3개뿐이라 2개 이상 조합은 아래 3가지가 전부이고, 실측
 * (2026-08-05) 로 이 술어가 다중값 16,468행 전량과 일치함을 확인했다.
 *
 * plan 과 apply 가 **같은 문자열**을 써야 apply 의 재검증 가드가 성립한다.
 */
const MULTI_GENDER_FILTER = "gender.cs.{men,women},gender.cs.{men,unisex},gender.cs.{women,unisex}"

/** `--scope` 허용값. `all` 은 필터 없이 전수 스캔이다. */
const SCOPES = ["null-gender", "multi-gender", "unisex", "unverified-legacy", "source-null", "all"]

/** 플랫폼 키 → 사람이 검증한 사이트 전역 기본 성별 (getSiteConfig 가 gender-defaults.ts 를 병합해 준다). */
function siteDefaultFor(platform: string | null): {
  siteDefaultGender: string[]
  verifiedUnisexDefault: boolean
  kidsGenderNoisePatterns?: RegExp[]
  genderTextPatterns?: {men?: RegExp[]; women?: RegExp[]; unisex?: RegExp[]}
  genderDepartmentTagPrefixes?: {men: string[]; women: string[]; unisex?: string[]}
} {
  if (!platform) return {siteDefaultGender: [], verifiedUnisexDefault: false}
  const config = getSiteConfig(platform)
  return {
    siteDefaultGender: config?.defaultGender ?? [],
    verifiedUnisexDefault: config?.verifiedUnisexDefault === true,
    kidsGenderNoisePatterns: config?.kidsGenderNoisePatterns,
    genderTextPatterns: config?.genderTextPatterns,
    genderDepartmentTagPrefixes: config?.genderDepartmentTagPrefixes,
  }
}

async function* streamProducts(
  db: ProductCollectionClient,
  opts: {scope: string; platform: string | null; brandNodeId: number | null; limit: number | null},
): AsyncGenerator<ProductGenderRow[]> {
  let cursor = 0
  let yielded = 0
  for (;;) {
    let q = db
      .from("products")
      .select(selectColumns())
      .gt("id", cursor)
      .order("id", {ascending: true})
      .limit(PAGE_SIZE)

    if (opts.scope === "null-gender") q = q.is("gender", null)
    else if (opts.scope === "unisex") q = q.contains("gender", ["unisex"])
    else if (opts.scope === "multi-gender") q = q.or(MULTI_GENDER_FILTER)
    else if (opts.scope === "unverified-legacy") q = q.eq("gender_source", "unverified_legacy")
    else if (opts.scope === "source-null") q = q.is("gender_source", null)
    if (opts.platform) q = q.eq("platform", opts.platform)
    if (opts.brandNodeId !== null) q = q.eq("brand_node_id", opts.brandNodeId)

    const {data, error} = await q
    if (error) throw new Error(`products load failed: ${error.message}`)
    const page = (data ?? []) as unknown as ProductGenderRow[]
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

const BUCKET_ORDER: GenderRepairBucket[] = [
  "confirmed_men",
  "confirmed_women",
  "confirmed_unisex",
  "unchanged",
  "kids",
  "unverified",
]

function printSummary(s: GenderRepairSummary): void {
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

  console.log("\n── 브랜드별 상위 20 ──────────────────────")
  for (const b of s.byBrandNode.slice(0, 20)) {
    const detail = BUCKET_ORDER.filter((k) => b.counts[k] > 0).map((k) => `${k}=${b.counts[k]}`).join(" ")
    console.log(`  ${b.brand.slice(0, 24).padEnd(24)} ${String(b.total).padStart(6)}  ${detail}`)
  }

  console.log("\n── 샘플 (버킷당 10건) ────────────────────")
  for (const bucket of BUCKET_ORDER) {
    const rows = s.samples[bucket]
    if (!rows || rows.length === 0) continue
    console.log(`\n  [${bucket}]`)
    for (const d of rows) {
      const after = d.after ? JSON.stringify(d.after) : "(변경없음)"
      console.log(`    id=${d.id} ${JSON.stringify(d.before)}→${after} src=${d.gender_source}`)
      console.log(`      근거: ${d.evidence}`)
      console.log(`      ${d.product_url}`)
    }
  }

  if (s.conflicts.length > 0) {
    console.log(`\n── URL/텍스트 충돌 (${s.conflicts.length}건, 최대 50) ──`)
    for (const d of s.conflicts) {
      console.log(`    id=${d.id} url=${d.conflict?.url} text=${d.conflict?.text}  ${d.product_url}`)
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

  const scope = flag("scope") ?? "null-gender"
  // 오타난 스코프는 streamProducts 에서 필터 없이 전수(15만행) 스캔으로 떨어진다.
  // 조용히 전체를 대상으로 삼는 대신 여기서 거부한다.
  if (!SCOPES.includes(scope)) {
    throw new Error(`알 수 없는 --scope=${scope} (가능: ${SCOPES.join(" | ")})`)
  }
  const useDescription = has("use-description")
  const platform = flag("platform")
  const brandNodeId = flag("brand-node") !== null ? Number(flag("brand-node")) : null
  const limit = flag("limit") !== null ? Number(flag("limit")) : null

  const db = createProductCollectionClient()
  hasGenderSourceColumn = await detectGenderSourceColumn(db)
  if (!hasGenderSourceColumn) {
    if (scope === "source-null") throw new Error("--scope=source-null 은 마이그레이션 093 적용 후에만 쓸 수 있다")
    console.log("ℹ️  products.gender_source 없음 (마이그레이션 093 미적용) — 분류/집계는 그대로 가능하나 --apply 는 093 적용 후에 하라")
  }

  const decisions: GenderRepairDecision[] = []
  for await (const page of streamProducts(db, {scope, platform, brandNodeId, limit})) {
    for (const row of page) decisions.push(classifyGenderRepair(row, {useDescription, ...siteDefaultFor(row.platform)}))
    process.stdout.write(`\r   🔍 ${decisions.length}행 분류`)
  }
  console.log("")

  // 스코프가 0행이면 빈 계획 파일을 조용히 남기지 않는다. `--scope=null-gender`
  // 는 2026-08-05 기준 0행인데도 기본값이라, 스코프를 지정하지 않은 실행이
  // "아무 문제 없음"처럼 보이는 빈 계획을 만들어 왔다.
  if (decisions.length === 0) {
    throw new Error(
      `--scope=${scope} 대상이 0행이다 (계획 파일을 만들지 않는다). ` +
        "스코프를 확인하라 — 다중값은 --scope=multi-gender, 미확인 unisex 는 --scope=unisex.",
    )
  }

  const summary = summarizeGenderRepair(decisions)
  printSummary(summary)

  const plan: RepairPlanFile = {
    version: 1,
    generated_at: new Date().toISOString(),
    scope,
    use_description: useDescription,
    filters: {platform, brand_node_id: brandNodeId, limit},
    scanned: summary.total,
    writable: summary.writable,
    by_bucket: summary.byBucket,
    decisions,
  }
  fs.writeFileSync(absolute, `${JSON.stringify(plan, null, 2)}\n`, {flag: "w"})
  console.log(`\n📋 계획 저장: ${absolute}`)
  console.log(`   적용: pnpm repair:product-gender --apply=${outputPath}`)
  console.log("   ⚠️  적용 전 confirmed_* 샘플 URL 을 실제 사이트에서 육안 확인할 것.")
}

// ─── apply ───────────────────────────────────────────────────────────────

function validatePlan(raw: unknown): RepairPlanFile {
  if (!raw || typeof raw !== "object") throw new Error("invalid plan")
  const plan = raw as Partial<RepairPlanFile>
  if (plan.version !== 1 || !Array.isArray(plan.decisions)) throw new Error("unsupported repair plan")
  for (const d of plan.decisions) {
    if (
      !Number.isInteger(d.id) ||
      typeof d.product_url !== "string" ||
      !Array.isArray(d.before) ||
      (d.after !== null && !Array.isArray(d.after))
    ) {
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
  hasGenderSourceColumn = await detectGenderSourceColumn(db)
  if (!hasGenderSourceColumn) {
    throw new Error("products.gender_source 가 없다 — 마이그레이션 093 을 먼저 적용하라 (출처 없이 쓰면 감사 불가)")
  }

  const platformFilter = flag("platform")
  const brandFilter = flag("brand-node") !== null ? Number(flag("brand-node")) : null
  const stampUnverified = has("stamp-unverified")
  const applied = loadProgress(absolute)
  if (applied.size > 0) console.log(`   ⏩ 이전 실행에서 ${applied.size}행 적용됨 — 건너뜀`)

  // 계획 생성 이후 분류기나 brand_nodes 가 바뀌었을 수 있다. 계획에 담긴 행을
  // 현재 DB 상태로 다시 읽어 재판정하고, 판정이 달라졌으면 중단한다.
  //
  // 재검증 대상은 **이번 호출 범위**(--platform/--brand-node 필터 + 아직 미적용)
  // 로 한정한다 — 계획 전체를 검증하면, 앞선 --platform 호출로 이미 적용된 행이
  // (더 이상 값이 안 바뀌므로 "drift"로 잡혀) 전혀 무관한 이후 --platform 호출까지
  // 막아버린다.
  const targetIds = plan.decisions
    .filter((d) => d.after !== null || (stampUnverified && d.bucket === "unchanged"))
    .filter((d) => !applied.has(d.id))
    .filter((d) => !platformFilter || d.platform === platformFilter)
    .filter((d) => brandFilter === null || d.brand_node_id === brandFilter)
    .map((d) => d.id)

  console.log(`🔁 계획 재검증: ${targetIds.length}행${platformFilter ? ` (platform=${platformFilter})` : ""}`)
  const expected = new Map(plan.decisions.map((d) => [d.id, JSON.stringify({
    after: d.after,
    gender_source: d.gender_source,
  })]))
  const rowsById = new Map<number, ProductGenderRow>()
  for (let i = 0; i < targetIds.length; i += PAGE_SIZE) {
    const chunk = targetIds.slice(i, i + PAGE_SIZE)
    const {data, error} = await db
      .from("products")
      .select(selectColumns())
      .in("id", chunk)
    if (error) throw new Error(`re-verify load failed: ${error.message}`)
    for (const row of (data ?? []) as unknown as ProductGenderRow[]) rowsById.set(row.id, row)
  }

  let drifted = 0
  for (const id of targetIds) {
    const row = rowsById.get(id)
    // 이미 다른 경로(재임포트 등)로 갱신되어 스코프에서 빠진 행 — 아래 .contains
    // 가드가 어차피 걸러내므로 drift 로 세지 않는다.
    if (!row) continue
    const now = classifyGenderRepair(row, {useDescription: plan.use_description, ...siteDefaultFor(row.platform)})
    if (JSON.stringify({after: now.after, gender_source: now.gender_source}) !== expected.get(id)) drifted += 1
  }
  if (drifted > 0) {
    throw new Error(
      `계획 생성 이후 판정이 바뀐 행 ${drifted}건 — 계획을 다시 생성하라 (--plan). ` +
        "분류기 변경이 원인이다.",
    )
  }
  console.log("   ✅ drift 없음")

  const sleepMs = flag("sleep-ms") !== null ? Number(flag("sleep-ms")) : 0

  // (after, gender_source) 가 같은 결정을 묶어 배치당 payload 하나로 만든다.
  const groups = new Map<string, GenderRepairDecision[]>()
  for (const d of plan.decisions) {
    if (applied.has(d.id)) continue
    if (platformFilter && d.platform !== platformFilter) continue
    if (brandFilter !== null && d.brand_node_id !== brandFilter) continue
    const writesGender = d.after !== null
    // after===null 인 결정은 gender 를 바꾸지 않고 gender_source 만 쓴다.
    // "unchanged"(진짜 unisex — 값은 같지만 gender_source 는 repair_text 등으로
    // 확정됨) 와 "kids"/"unverified"(gender_source="unverified_legacy") 를
    // 모두 포함한다 — 전자만 걸러내면 "확인된 unisex" 269건이 --stamp-unverified
    // 를 켜도 영원히 stamp 되지 않는다.
    if (!writesGender && !stampUnverified) continue
    const key = `${JSON.stringify(d.after)}\u0000${d.gender_source}`
    const list = groups.get(key) ?? []
    list.push(d)
    groups.set(key, list)
  }

  let updated = 0
  let stale = 0
  for (const [key, rows] of groups) {
    const [afterRaw, source] = key.split("\u0000")
    const after = JSON.parse(afterRaw) as string[] | null
    // multi-gender 는 batch 를 before 값으로 한 번 더 쪼갠다. stale 가드가 before
    // 를 술어로 쓰는데 다중값 조합이 3가지라, 한 배치에 섞여 있으면 술어를 하나로
    // 정할 수 없다. 나머지 스코프는 before 를 술어로 쓰지 않으므로 단일 그룹이다.
    const partitions =
      plan.scope === "multi-gender"
        ? [...rows.reduce((m, r) => m.set(JSON.stringify(r.before), [...(m.get(JSON.stringify(r.before)) ?? []), r]), new Map<string, GenderRepairDecision[]>())]
        : [["", rows] as [string, GenderRepairDecision[]]]

    for (const [beforeRaw, partition] of partitions) {
    for (let i = 0; i < partition.length; i += WRITE_BATCH) {
      const batch = partition.slice(i, i + WRITE_BATCH)
      const payload: Record<string, unknown> = {gender_source: source, updated_at: new Date().toISOString()}
      if (after !== null) payload.gender = after

      // stale 가드: 이미 다른 경로(재임포트 등)로 갱신된 행은 술어에 매치되지
      // 않아 건너뛴다 → 재실행 멱등 + 동시 import 와의 경쟁에서 안전.
      //
      // multi-gender 는 `.contains("gender", before)` 를 쓴다. PostgREST 는
      // UPDATE 에 `or=()` 를 받지 않는다 ("column products.gender does not
      // exist") — SELECT 에서는 통하므로 plan 단계에서는 문제가 없다. before 를
      // 술어로 쓰는 편이 어차피 더 정확하다: 그 행이 **여전히 그 다중값 그대로**
      // 일 때만 쓴다.
      let q = db.from("products").update(payload).in("id", batch.map((r) => r.id))
      if (plan.scope === "unisex") q = q.contains("gender", ["unisex"])
      if (plan.scope === "multi-gender") q = q.contains("gender", JSON.parse(beforeRaw) as string[])
      if (plan.scope === "unverified-legacy") q = q.eq("gender_source", "unverified_legacy")
      const {data, error} = await q.select("id")
      if (error) throw new Error(`apply failed (${afterRaw}/${source}): ${error.message}`)

      const wrote = data?.length ?? 0
      updated += wrote
      stale += batch.length - wrote
      for (const r of batch) applied.add(r.id)
      saveProgress(absolute, applied)
      process.stdout.write(`\r   💾 updated=${updated} stale=${stale}`)
      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
    }
    }
  }
  console.log(`\n✅ applied=${updated} stale_or_already_changed=${stale} plan=${absolute}`)

  // 이번 호출에서 실제로 쓴 행만 감사 기록 대상이다. plan.decisions 전체를 쓰면
  // --platform/--brand-node/--limit 로 걸러진 이번 실행과 무관한 브랜드까지
  // product_crawl_runs 에 잡음으로 기록된다.
  const touched = [...groups.values()].flat()
  await recordRuns(db, touched, plan.scope, updated, stale)
}

/**
 * 감사 추적: 이번 apply 호출에서 실제로 쓴 행의 brand_node 별로
 * product_crawl_runs 에 기록한다 (CLAUDE.md §18 패턴).
 * product_crawl_status.status 는 건드리지 않는다 — 크롤 상태 전이가 아니고,
 * 092 가 status CHECK 를 8개 값으로 제한한다.
 */
async function recordRuns(
  db: ProductCollectionClient,
  touched: GenderRepairDecision[],
  scope: string,
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
    metrics: {actor: "repair-product-gender", scope, rows: n, updated, stale, by_bucket: bucketCounts},
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
