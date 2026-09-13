#!/usr/bin/env npx tsx
/**
 * 재수집으로 대표 이미지가 바뀐 행을 DB의 조건부 임베딩 무효화 RPC에 넘긴다.
 *
 *   # 1) 크롤 전 스냅샷 (재수집 드라이버의 스테이지 1)
 *   pnpm invalidate:embeddings -- --platform=kith --snapshot=data/recollect/run-1/kith/images-before.jsonl
 *
 *   # 2) import 후 비교 (기본 dry-run)
 *   pnpm invalidate:embeddings -- --platform=kith --before=data/recollect/run-1/kith/images-before.jsonl
 *   #    확인 후 실제 무효화
 *   pnpm invalidate:embeddings -- --platform=kith --before=... --apply
 *
 * 스냅샷은 반드시 **크롤 전**에 떠야 한다. products 의 upsert 는 행을 제자리에서
 * 덮어쓰므로 import 후에는 옛 이미지 URL 을 알 방법이 없다. 크롤 산출 JSON 으로
 * 대신 비교해서도 안 된다 — DB 에 실제로 앉는 값은 QC 게이트/검증 게이트와
 * import 의 product_url dedup 머지를 거친 결과라 JSON 과 다를 수 있다.
 *
 * 무효화 후에는 kiko.ai-app/scripts/aws/embed_products.py 를 돌리면 된다.
 * 그쪽 pending 판정이 "product_embeddings 행 없음" 안티조인이라, 지운 행이
 * 자동으로 재임베딩 대상이 된다.
 *
 * 종료 코드: 0 = 정상, 3 = 변경 비율이 경보 임계 초과(적용 보류), 1 = 오류.
 */

import * as fs from "node:fs"
import * as path from "node:path"

import {createClient, type SupabaseClient} from "@supabase/supabase-js"

import {
  CHANGE_RATIO_ALERT,
  changeRatio,
  diffImageSnapshots,
  type ImageSnapshotRow,
} from "../src/lib/embedding-invalidation"
import {invalidateStaleProductEmbeddings} from "../src/lib/embedding-invalidation-rpc"

const PAGE_SIZE = 1000
const INVALIDATION_BATCH = 500

interface Flags {
  platform: string
  snapshot: string
  before: string
  out: string
  apply: boolean
  force: boolean
}

function parseFlags(): Flags {
  const raw: Record<string, string | boolean> = {}
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue
    const [key, value] = arg.slice(2).split("=")
    raw[key!] = value ?? true
  }
  const str = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string) : "")
  const flags = {
    platform: str("platform"),
    snapshot: str("snapshot"),
    before: str("before"),
    out: str("out"),
    apply: raw.apply === true,
    force: raw.force === true,
  }
  if (!flags.platform || (!flags.snapshot && !flags.before)) {
    console.error(
      "usage: invalidate-changed-embeddings --platform=<key> (--snapshot=<out.jsonl> | --before=<in.jsonl> [--apply])",
    )
    process.exit(1)
  }
  return flags
}

function db(): SupabaseClient {
  if (!process.env.DB_URL || !process.env.DB_TOKEN) {
    console.error("❌ DB_URL / DB_TOKEN 이 필요합니다")
    process.exit(1)
  }
  return createClient(process.env.DB_URL, process.env.DB_TOKEN)
}

/** keyset 페이징 — 크롤 직후에도 돌기 때문에 offset 기반은 쓰지 않는다. */
async function fetchImageRows(client: SupabaseClient, platform: string): Promise<ImageSnapshotRow[]> {
  const rows: ImageSnapshotRow[] = []
  let cursor = 0
  for (;;) {
    const {data, error} = await client
      .from("products")
      .select("id,images,image_url")
      .eq("platform", platform)
      .gt("id", cursor)
      .order("id", {ascending: true})
      .limit(PAGE_SIZE)
    if (error) throw new Error(`products 조회 실패: ${error.message}`)
    const page = (data ?? []) as ImageSnapshotRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    cursor = page[page.length - 1]!.id
  }
  return rows
}

/** JSONL — 6만 행을 한 덩어리 JSON 으로 들고 있을 이유가 없고, 부분 손상에도 강하다. */
function writeSnapshot(file: string, rows: readonly ImageSnapshotRow[]): void {
  const absolute = path.resolve(file)
  fs.mkdirSync(path.dirname(absolute), {recursive: true})
  const tmp = `${absolute}.tmp`
  fs.writeFileSync(tmp, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf-8")
  fs.renameSync(tmp, absolute)
}

function readSnapshot(file: string): ImageSnapshotRow[] {
  const absolute = path.resolve(file)
  return fs
    .readFileSync(absolute, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ImageSnapshotRow)
}

async function main(): Promise<void> {
  const flags = parseFlags()
  const client = db()

  if (flags.snapshot) {
    const rows = await fetchImageRows(client, flags.platform)
    writeSnapshot(flags.snapshot, rows)
    console.log(`📸 스냅샷 ${rows.length}행 → ${path.resolve(flags.snapshot)}`)
    return
  }

  const before = readSnapshot(flags.before)
  const after = await fetchImageRows(client, flags.platform)
  const summary = diffImageSnapshots(before, after)
  const ratio = changeRatio(summary)

  console.log(`\n── ${flags.platform} 대표 이미지 변화 (before ${before.length} → after ${after.length}) ──`)
  for (const [bucket, count] of Object.entries(summary.byBucket)) {
    console.log(`  ${bucket.padEnd(18)} ${count}`)
  }
  console.log(`  무효화 대상        ${summary.invalidateIds.length} (${(ratio * 100).toFixed(1)}%)`)

  if (summary.samples.length > 0) {
    console.log(`\n  변경 샘플 (최대 ${summary.samples.length}):`)
    for (const sample of summary.samples) {
      console.log(`   #${sample.id}`)
      console.log(`      - ${sample.before}`)
      console.log(`      + ${sample.after}`)
    }
  }

  if (flags.out) {
    const absolute = path.resolve(flags.out)
    fs.mkdirSync(path.dirname(absolute), {recursive: true})
    fs.writeFileSync(
      absolute,
      JSON.stringify(
        {platform: flags.platform, capturedAt: new Date().toISOString(), byBucket: summary.byBucket, ratio, ids: summary.invalidateIds},
        null,
        2,
      ),
      "utf-8",
    )
    console.log(`\n💾 ${absolute}`)
  }

  if (ratio > CHANGE_RATIO_ALERT && !flags.force) {
    console.log(
      `\n🛑 변경 비율 ${(ratio * 100).toFixed(1)}% > 경보 임계 ${(CHANGE_RATIO_ALERT * 100).toFixed(0)}% — 적용 보류.` +
        `\n   상품 사진이 한꺼번에 이만큼 바뀌는 일은 없다. 위 샘플을 보고 정규화가` +
        `\n   놓친 CDN 패턴이 있는지 먼저 확인할 것 (src/lib/embedding-invalidation.ts).` +
        `\n   확인 후에도 진짜 변경이면 --force 로 진행.`,
    )
    process.exit(3)
  }

  if (!flags.apply) {
    console.log(`\n💤 dry-run — 실제 삭제는 --apply`)
    return
  }

  const outcomes = {invalidated: 0, current: 0, missing: 0}
  for (let i = 0; i < summary.invalidateIds.length; i += INVALIDATION_BATCH) {
    const batch = summary.invalidateIds.slice(i, i + INVALIDATION_BATCH)
    const results = await invalidateStaleProductEmbeddings(client, batch)
    for (const result of results) outcomes[result.outcome] += 1
    const accounted = outcomes.invalidated + outcomes.current + outcomes.missing
    console.log(`   ♻️  ${accounted}/${summary.invalidateIds.length}`)
  }
  console.log(
    `\n✅ 임베딩 확인 완료 — invalidated=${outcomes.invalidated} current=${outcomes.current} missing=${outcomes.missing}` +
      ` — kiko.ai-app/scripts/aws/embed_products.py 를 돌리면 재임베딩된다`,
  )
}

main().catch((error) => {
  console.error(`💥 invalidate-changed-embeddings 오류: ${error instanceof Error ? error.stack : error}`)
  process.exit(1)
})
