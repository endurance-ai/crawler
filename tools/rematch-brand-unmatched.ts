#!/usr/bin/env npx tsx
/**
 * brand_unmatched 후보 재매칭 백필.
 *
 * 왜 필요한가 (2026-07-29):
 *   `matchExistingBrand` 가 `brand_nodes.brand_name_normalized`(공백·구두점 제거형)에
 *   공백을 collapse 만 하는 약한 정규화를 적용해 비교하고 있었다 →
 *   `"032c readytowear"` vs `"032creadytowear"` 로 영원히 불일치. 공백이나 구두점이
 *   들어간 브랜드명은 전부 매칭에 실패해 brand_unmatched 로 파킹됐다.
 *
 *   코드는 고쳤지만(brandMatchKey) `enqueueRefreshCandidates` 가
 *   `ignoreDuplicates: true` 로 upsert 하므로 **이미 파킹된 행은 재크롤해도 상태가
 *   바뀌지 않는다.** 이 스크립트가 그 존량을 한 번 훑어 승격시킨다.
 *
 * 안전장치:
 *   - 기본 dry-run. 실제 쓰기는 `--apply` 를 명시해야 한다.
 *   - `status='brand_unmatched'` 행만 읽고, 단일 매칭된 것만 `discovered` 로 승격한다.
 *     모호(2건 이상)하거나 매칭 없는 행은 손대지 않는다 — 퍼지 매칭 금지 정책 유지.
 *   - `detected_brand` 가 비어 있으면 `config.brand`(하우스 브랜드)로 폴백한다.
 *     buildRefreshCandidateInputs 가 원래 쓰는 것과 동일한 폴백인데, 그 config.brand
 *     가 채워지기 **전에** enqueue 된 행들은 빈 detected_brand 로 굳어 있다
 *     (실측: havati/citta/illigo/millowomen 등). 여기서 한 번 재적용한다.
 *   - 승격 시 `matched_brand_node_id` 를 함께 채워 refresh-candidates 워커가
 *     그대로 집어갈 수 있게 한다.
 *
 * 사용:
 *   npx tsx tools/rematch-brand-unmatched.ts            # dry-run (기본)
 *   npx tsx tools/rematch-brand-unmatched.ts --apply    # 실제 승격
 *   npx tsx tools/rematch-brand-unmatched.ts --limit=500 --apply
 */

import {getSiteConfig} from "../src/configs/platforms"
import {createProductCollectionClient} from "../src/lib/product-collection"
import {loadExistingBrands} from "../src/lib/product-refresh"
import {matchExistingBrand, resolveCandidateBrand} from "../src/lib/refresh-source"

interface CandidateRow {
  id: number
  platform_key: string
  detected_brand: string | null
}

function intFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const APPLY = process.argv.includes("--apply")
const LIMIT = intFlag("limit", 0) // 0 = 전체
const UPDATE_BATCH = 200

async function main(): Promise<void> {
  const db = createProductCollectionClient()
  const brands = await loadExistingBrands(db)
  console.log(`brand_nodes ${brands.length}건 로드`)

  // brand_unmatched 전량 페이지네이션 (id 안정 정렬)
  const rows: CandidateRow[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("product_refresh_candidates")
      .select("id,platform_key,detected_brand")
      .eq("status", "brand_unmatched")
      .order("id", {ascending: true})
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`candidate load failed: ${error.message}`)
    const page = (data ?? []) as CandidateRow[]
    rows.push(...page)
    if (page.length < pageSize) break
    if (LIMIT && rows.length >= LIMIT) break
  }
  const scoped = LIMIT ? rows.slice(0, LIMIT) : rows
  console.log(`brand_unmatched ${scoped.length}건 검사`)

  const promote: Array<{id: number; brandNodeId: number; brand: string}> = []
  let noBrand = 0
  let stillUnmatched = 0
  const byBrand = new Map<string, number>()

  for (const row of scoped) {
    // buildRefreshCandidateInputs 와 동일한 우선순위 (resolveCandidateBrand):
    // 자사몰이면 config.brand 가 이기고, 멀티브랜드 편집샵이면 상품 brand 가 이긴다.
    const cfg = getSiteConfig(row.platform_key)
    const brand = cfg
      ? resolveCandidateBrand(row.detected_brand, cfg)
      : (row.detected_brand?.trim() ?? "")
    if (!brand) {
      noBrand += 1
      continue
    }
    const matched = matchExistingBrand(brand, brands)
    if (!matched) {
      stillUnmatched += 1
      continue
    }
    promote.push({id: row.id, brandNodeId: matched.id, brand})
    byBrand.set(brand, (byBrand.get(brand) ?? 0) + 1)
  }

  console.log(
    `\n승격 대상 ${promote.length}건 · 브랜드 미추출 ${noBrand}건 · 여전히 미매칭 ${stillUnmatched}건`,
  )
  const top = [...byBrand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  if (top.length > 0) {
    console.log("\n승격 상위 브랜드:")
    for (const [brand, n] of top) console.log(`  ${brand.slice(0, 40).padEnd(42)} ${n}`)
  }

  if (!APPLY) {
    console.log("\n[dry-run] 실제 승격하려면 --apply 를 붙여 재실행하세요.")
    return
  }

  let ok = 0
  let failed = 0
  for (let i = 0; i < promote.length; i += UPDATE_BATCH) {
    const batch = promote.slice(i, i + UPDATE_BATCH)
    // brand_node_id 가 행마다 다르므로 그룹으로 묶어 in() 업데이트한다.
    const byNode = new Map<number, number[]>()
    for (const {id, brandNodeId} of batch) {
      const list = byNode.get(brandNodeId) ?? []
      list.push(id)
      byNode.set(brandNodeId, list)
    }
    for (const [brandNodeId, ids] of byNode) {
      const {error} = await db
        .from("product_refresh_candidates")
        .update({
          status: "discovered",
          matched_brand_node_id: brandNodeId,
          last_error: null,
        })
        .in("id", ids)
      if (error) {
        failed += ids.length
        if (failed <= 3) console.error(`  ❌ 승격 실패 (node ${brandNodeId}): ${error.message}`)
      } else {
        ok += ids.length
      }
    }
    process.stdout.write(`\r  승격 ${Math.min(i + UPDATE_BATCH, promote.length)}/${promote.length}`)
  }
  console.log(`\n\n완료 — 승격 ${ok}건 · 실패 ${failed}건`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
