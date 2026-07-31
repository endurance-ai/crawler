#!/usr/bin/env npx tsx
/**
 * 이미 products 에 있는 URL 을 가진 신규상품 후보를 imported 로 정리한다.
 *
 * 왜 생겼나 (실측 2026-07-31):
 *   `refresh-listing.fetchExistingRows` 가 `ORDER BY` 없이 `LIMIT/OFFSET` 페이징을
 *   했다. 순서가 보장되지 않아 페이지 간 행 누락이 생기고, 누락된 행의 URL 이
 *   크롤 결과와 대조될 때 "DB 에 없는 신규 상품" 으로 오인돼 후보 큐에 들어갔다.
 *
 *   상관관계가 명확하다 — 중복 3,996건 중 3,892건이 상품 1,000행을 넘는
 *   platform(=페이지네이션이 실제로 도는 경우)에서 나왔다:
 *     sculpstore 3,622행 → 2,527건 · drakes 1,608행 → 666건
 *     fr8ight 2,324행 → 328건 · concepts 1,027행 → 266건
 *
 *   근본 원인은 `.order("product_url")` 로 고쳤고, 워커도 LLM 호출 전에 중복을
 *   거르도록 바꿨다. 이 스크립트는 **이미 큐에 쌓인 존량**을 한 번 정리한다.
 *
 * 왜 삭제가 아니라 imported 인가:
 *   후보의 `identity_key` 는 UNIQUE 이고 `enqueueRefreshCandidates` 가
 *   `ignoreDuplicates: true` 로 upsert 한다. 삭제하면 다음 크롤에서 같은 행이
 *   다시 만들어진다. `imported` 로 두면 재적재되지 않고, 무엇이 왜 처리됐는지도 남는다.
 *
 * 사용:
 *   npx tsx tools/resolve-duplicate-candidates.ts           # dry-run (기본)
 *   npx tsx tools/resolve-duplicate-candidates.ts --apply
 */

import {createProductCollectionClient, type ProductCollectionClient} from "../src/lib/product-collection"

const APPLY = process.argv.includes("--apply")
const PAGE = 1000

interface CandidateRow {
  id: number
  platform_key: string
  product_url: string
}

async function loadOpenCandidates(db: ProductCollectionClient): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const {data, error} = await db
      .from("product_refresh_candidates")
      .select("id,platform_key,product_url")
      .in("status", ["discovered", "failed"])
      .order("id", {ascending: true})
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`candidate load failed: ${error.message}`)
    const page = (data ?? []) as CandidateRow[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

/**
 * products 를 한 번 전량 페이징해 `product_url → id` 맵을 만든다.
 *
 * 후보 URL 을 청크로 되묻지 않는 이유: 79k 건을 60개씩 나눠도 1,300 요청이고,
 * PostgREST 는 필터를 쿼리스트링에 싣기 때문에 긴 URL 이 섞이면 nginx 가 502 로
 * 끊는다(실측). 전량 페이징은 154k 행 ≈ 154 요청이면 끝난다 —
 * `tools/repair-product-platforms.ts` 도 같은 방식이다.
 */
async function loadProductIdsByUrl(db: ProductCollectionClient): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  for (let offset = 0; ; offset += PAGE) {
    const {data, error} = await db
      .from("products")
      .select("id,product_url")
      // ORDER BY 없는 OFFSET 페이징은 행을 누락시킨다 — 이 스크립트가 치우는 버그가
      // 정확히 그것이었다. 같은 실수를 반복하지 않는다.
      .order("id", {ascending: true})
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`product load failed: ${error.message}`)
    const page = (data ?? []) as Array<{id: number; product_url: string}>
    for (const row of page) found.set(row.product_url, Number(row.id))
    if (page.length < PAGE) break
    if (offset % (PAGE * 20) === 0) process.stdout.write(`\r  products 조회 ${found.size}`)
  }
  process.stdout.write("\r")
  return found
}

async function main(): Promise<void> {
  const db = createProductCollectionClient()
  const candidates = await loadOpenCandidates(db)
  console.log(`미처리 후보 ${candidates.length.toLocaleString()}건 조회`)

  const existing = await loadProductIdsByUrl(db)
  console.log(`products ${existing.size.toLocaleString()}행 조회`)
  const dupes = candidates.filter((c) => existing.has(c.product_url))

  const byPlatform = new Map<string, number>()
  for (const c of dupes) byPlatform.set(c.platform_key, (byPlatform.get(c.platform_key) ?? 0) + 1)

  console.log(
    `\n이미 products 에 있는 URL 을 가진 후보: ${dupes.length.toLocaleString()}건` +
      ` / ${byPlatform.size}개 platform`,
  )
  for (const [pk, n] of [...byPlatform.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${pk.padEnd(24)} ${String(n).padStart(6)}`)
  }

  if (!APPLY) {
    console.log("\n[dry-run] 실제 정리하려면 --apply 를 붙여 재실행하세요.")
    return
  }

  let done = 0
  let failed = 0
  for (const c of dupes) {
    const {error} = await db
      .from("product_refresh_candidates")
      .update({
        status: "imported",
        imported_product_id: existing.get(c.product_url)!,
        last_error: "resolved: product_url already present in products (stale candidate)",
        next_attempt_at: null,
      })
      .eq("id", c.id)
    if (error) {
      failed += 1
      if (failed <= 3) console.error(`  ❌ #${c.id}: ${error.message}`)
    } else {
      done += 1
    }
    if (done % 200 === 0) process.stdout.write(`\r  정리 ${done}/${dupes.length}`)
  }
  console.log(`\n완료 — 정리 ${done}건 · 실패 ${failed}건`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
