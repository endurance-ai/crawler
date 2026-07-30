#!/usr/bin/env npx tsx
// platform-as-brand 오염 정리 (Supabase REST 환경용 069_cleanup_platform_as_brand.sql 실행판).
//
// 멀티브랜드 편집샵의 브랜드가 플랫폼명으로 잘못 적재돼 생긴 오염 데이터를 격리한다:
//   1) 오염 products 삭제(재크롤로 재생성)
//   2) 잘못 만든 platform-as-brand brand_nodes 행 삭제(RESTRICT 자식 선처리)
//
// 기본 dry-run(감사만). 실제 삭제는 --apply.
// 대상 플랫폼 키/브랜드명은 --platform 로 지정(기본 8division).
//
// 실행:
//   감사:  npx dotenv -e .env.local -- npx tsx tools/cleanup-platform-as-brand.ts
//   적용:  npx dotenv -e .env.local -- npx tsx tools/cleanup-platform-as-brand.ts --apply
import {createProductCollectionClient} from "../src/lib/product-collection"

const APPLY = process.argv.includes("--apply")
const platArg = process.argv.find((a) => a.startsWith("--platform="))
const PLATFORM = platArg ? platArg.split("=")[1] : "8division"
// 이 플랫폼이 브랜드로 오염됐을 때 나타나는 brand_name 후보(키 + 한글 표시명 등).
const BRAND_NAME_CANDIDATES: Record<string, string[]> = {
  "8division": ["8division", "8디비전", "8DIVISION", "8DIVISION RTW"],
  visualaid: ["visualaid", "VISUAL AID"],
}
const names = BRAND_NAME_CANDIDATES[PLATFORM] ?? [PLATFORM]

async function main() {
  const db = createProductCollectionClient()

  console.log(`\n=== platform-as-brand 정리 (${PLATFORM}) — ${APPLY ? "APPLY" : "DRY-RUN(감사만)"} ===\n`)

  // ── 감사 ──────────────────────────────────────────────────
  const {data: bn, error: bnErr} = await db
    .from("brand_nodes")
    .select("id, brand_name, source_platforms")
    .in("brand_name", names)
  if (bnErr) throw bnErr
  const ids = (bn ?? []).map((r: {id: number}) => r.id)
  console.log(`platform-as-brand brand_nodes: ${ids.length}건`)
  for (const r of bn ?? []) console.log(`  id=${(r as any).id} brand_name=${JSON.stringify((r as any).brand_name)} source=${JSON.stringify((r as any).source_platforms)}`)

  const {count: prodByPlatform} = await db
    .from("products").select("id", {count: "exact", head: true}).eq("platform", PLATFORM)
  console.log(`products (platform=${PLATFORM}): ${prodByPlatform ?? 0}건 → 삭제 후 재크롤 대상`)

  let prodByNode = 0
  if (ids.length) {
    const {count} = await db
      .from("products").select("id", {count: "exact", head: true}).in("brand_node_id", ids)
    prodByNode = count ?? 0
  }
  console.log(`products (brand_node_id ∈ 오염노드): ${prodByNode}건`)

  let candCnt = 0
  if (ids.length) {
    const {count, error} = await db
      .from("product_refresh_candidates").select("id", {count: "exact", head: true}).in("matched_brand_node_id", ids)
    if (!error) candCnt = count ?? 0
  }
  console.log(`product_refresh_candidates (matched_brand_node_id ∈ 오염노드, RESTRICT): ${candCnt}건`)

  if (!APPLY) {
    console.log(`\n감사 완료. 실제 삭제하려면 --apply 를 붙여 재실행하세요.\n`)
    return
  }

  // ── 적용 (FK 안전 순서) ───────────────────────────────────
  console.log(`\n--- 삭제 시작 ---`)

  const delCount = async (label: string, run: () => PromiseLike<{data: unknown[] | null; error: {message: string} | null}>) => {
    const {data, error} = await run()
    if (error) { console.error(`  ❌ ${label}: ${error.message}`); throw new Error(`${label} 실패: ${error.message}`) }
    console.log(`  ✅ ${label}: ${data?.length ?? 0}건`)
  }

  // 1) 오염 products 삭제 — 기본은 오염 노드에 매달린 상품만(정상 브랜드 상품 유지).
  //    --all-products 면 platform 전체 삭제.
  const ALL_PRODUCTS = process.argv.includes("--all-products")
  if (ALL_PRODUCTS) {
    await delCount(`products platform=${PLATFORM} 전체 삭제`, () =>
      db.from("products").delete().eq("platform", PLATFORM).select("id"))
  } else if (ids.length) {
    await delCount(`products (brand_node_id ∈ 오염노드) 삭제`, () =>
      db.from("products").delete().in("brand_node_id", ids).select("id"))
  }

  if (ids.length) {
    // 2) RESTRICT 자식: refresh candidates
    await delCount(`product_refresh_candidates 삭제`, () =>
      db.from("product_refresh_candidates").delete().in("matched_brand_node_id", ids).select("id"))

    // 3) 크롤 큐 정리 (runs → status). 테이블/컬럼 없으면 에러 → 무시하고 진행.
    const tryDel = async (label: string, run: () => PromiseLike<{data: unknown[] | null; error: {message: string} | null}>) => {
      const {data, error} = await run()
      if (error) { console.warn(`  ⚠️  ${label}: ${error.message} (건너뜀)`); return }
      console.log(`  ✅ ${label}: ${data?.length ?? 0}건`)
    }
    await tryDel(`product_crawl_runs 삭제`, () =>
      db.from("product_crawl_runs").delete().in("brand_node_id", ids).select("id"))
    await tryDel(`product_crawl_status 삭제`, () =>
      db.from("product_crawl_status").delete().in("brand_node_id", ids).select("brand_node_id"))

    // 4) platform-as-brand 노드 삭제 (similar/proposals/review_queue/embeddings/umap CASCADE)
    await delCount(`brand_nodes 삭제`, () =>
      db.from("brand_nodes").delete().in("id", ids).select("id"))
  }

  console.log(`\n정리 완료. 이제 온보딩 파이프라인으로 ${PLATFORM} 재수집:`)
  console.log(`  npx dotenv -e .env.local -- bash tools/onboard-batch.sh --configs <${PLATFORM} 포함 config.json>\n`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
