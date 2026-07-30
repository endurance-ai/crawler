#!/usr/bin/env npx tsx
// origin_country 커버리지 audit (읽기전용).
//
// brand_nodes.wiki->>'origin_country' 채움율 / 국가 분포 + origin_country 가 NULL 인
// 브랜드에 매달린 products 수를 리포트한다. 게이트가 아니라 현황 진단용 —
// 해외 브랜드 누수는 코드 가드(직접 크롤 multiBrand 제외 + import provenance 가드,
// 신규 브랜드는 KR-스코프 온보딩으로만 생성)로 구조적으로 막고, origin_country 는
// 이 스크립트로 커버리지만 파악한다. 커버리지가 충분해지면 나중에 해외 온보딩 필터를
// 열 때 판단 근거로 쓴다.
//
// 실행: npx dotenv -e .env.local -- npx tsx tools/audit-origin-country.ts
import {createProductCollectionClient} from "../src/lib/product-collection"

async function main() {
  const db = createProductCollectionClient()

  // 1) brand_nodes 전량 로드 (id + wiki) — 페이지네이션으로 origin_country 집계
  const PAGE = 1000
  let total = 0
  let withOrigin = 0
  const byCountry = new Map<string, number>()
  const nullOriginIds: number[] = []
  for (let from = 0; ; from += PAGE) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id, wiki")
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data as Array<{id: number; wiki: {origin_country?: string} | null}>) {
      total++
      const oc = row.wiki?.origin_country?.trim() || null
      if (oc) {
        withOrigin++
        byCountry.set(oc, (byCountry.get(oc) ?? 0) + 1)
      } else {
        nullOriginIds.push(row.id)
      }
    }
    if (data.length < PAGE) break
  }

  // 2) origin_country NULL 브랜드에 매달린 products 수 (batched count)
  let productsOnNullOrigin = 0
  const IDB = 200
  for (let i = 0; i < nullOriginIds.length; i += IDB) {
    const batch = nullOriginIds.slice(i, i + IDB)
    const {count, error} = await db
      .from("products")
      .select("id", {count: "exact", head: true})
      .in("brand_node_id", batch)
    if (error) throw error
    productsOnNullOrigin += count ?? 0
  }

  // 3) 전체 products 수
  const {count: totalProducts, error: tpErr} = await db
    .from("products")
    .select("id", {count: "exact", head: true})
  if (tpErr) throw tpErr

  // ── 리포트 ────────────────────────────────────────────────
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0)
  console.log("=== brand_nodes origin_country 커버리지 ===")
  console.log(
    `brand_nodes 총 ${total}개 · origin_country 채움 ${withOrigin} (${pct(withOrigin, total)}%) · NULL ${total - withOrigin} (${pct(total - withOrigin, total)}%)`,
  )
  console.log("\n국가별 분포 (상위 20):")
  ;[...byCountry.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([c, n]) => console.log(`  ${c.padEnd(4)} ${n}`))
  console.log("\n=== products 영향 ===")
  console.log(
    `products 총 ${totalProducts ?? 0}개 · origin_country NULL 브랜드에 매달린 상품 ${productsOnNullOrigin} (${pct(productsOnNullOrigin, totalProducts ?? 0)}%)`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
