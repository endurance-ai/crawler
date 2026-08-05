#!/usr/bin/env npx tsx
/**
 * 다중값 성별 잔여분 처리 (1회성, 2026-08-05).
 *
 * `repair:product-gender --scope=multi-gender` 가 16,468행 중 12,672행을 단일값으로
 * 확정하고 남긴 3,796행을 정리한다. 분류기가 이 행들을 못 푼 이유는 두 가지이고,
 * 성격이 달라 처리도 다르다:
 *
 *   A. name/category/subcategory/tags/url 에 men·women 토큰이 **모두** 있는 행.
 *      편집샵이 같은 상품을 Men·Women 부서 양쪽에 등록한 것이다 — browns 의
 *      스노부츠 tags=["Boots","Men","Rain Boots","Shoes","Women"] 처럼.
 *      inferGenderFromText 는 이걸 "모호"로 보고 null 을 내지만, 실제로는
 *      **양쪽에서 판다는 적극적 근거**다. gender-defaults.ts 헤더가 정한 기준
 *      ("unisex 는 사이트가 명시적으로 남녀공용을 표방할 때만")을 만족한다.
 *      → gender=['unisex'], gender_source='repair_text'
 *
 *   B. 성별 토큰이 아예 없는 행. slam-jam/union-la 의 스니커즈처럼 태그가
 *      브랜드·색·컬렉션뿐이다. 재크롤해도 같은 태그가 나오므로 영원히 미확인이다.
 *      kids 가드에 걸린 행도 여기 포함된다(성인 성별을 주지 않는 것이 의도된 동작).
 *      → 삭제
 *
 * **재크롤은 이 3,796행을 하나도 못 고친다.** 현재 shopify 엔진도
 * inferGenderFromText(tags) 를 쓰므로 A 는 null, B 는 null 이 나오고, 해당 21개
 * 플랫폼에 defaultGender 가 없어 import 가 스킵한다 — 기존 행은 그대로 남는다.
 * 그래서 재크롤이 아니라 이 스크립트가 필요하다.
 *
 * 사용법:
 *   npx dotenv -e .env.local -- npx tsx tools/resolve-multi-gender-residual.ts
 *   npx dotenv -e .env.local -- npx tsx tools/resolve-multi-gender-residual.ts --apply
 *
 * 매니페스트(삭제 행 전체 정보 포함)를
 * data/repair/gender-multi-residual-2026-08-05.json 에 남긴다. products 삭제는
 * product_embeddings / product_features 로 CASCADE 되므로 복구하려면 재크롤 +
 * 재임베딩이 필요하다 — 매니페스트가 유일한 복구 근거다.
 */
import * as fs from "node:fs"

import {createClient} from "@supabase/supabase-js"

const db = createClient(process.env.DB_URL!, process.env.DB_TOKEN!)
const APPLY = process.argv.includes("--apply")
const MANIFEST = "data/repair/gender-multi-residual-2026-08-05.json"

/** 다중값 조합 3가지 = 정규값이 3개뿐이라 이게 전부다 (repair-product-gender.ts 와 동일). */
const MULTI = "gender.cs.{men,women},gender.cs.{men,unisex},gender.cs.{women,unisex}"

const MEN = /\b(men|mens|men's|man|male|homme|uomo|herren)\b/i
const WOM = /\b(women|womens|women's|woman|female|femme|donna|damen|ladies)\b/i

const COLS =
  "id,name,category,subcategory,tags,product_url,platform,brand,brand_node_id,gender,gender_source,in_stock,last_seen_at,image_url"

async function main(): Promise<void> {
  // 계획 파일이 아니라 **현재 DB 상태**를 기준으로 다시 읽는다.
  const rows: Record<string, unknown>[] = []
  for (let off = 0; ; off += 1000) {
    const {data, error} = await db.from("products").select(COLS).or(MULTI).order("id").range(off, off + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as Record<string, unknown>[]))
    if (data.length < 1000) break
  }
  console.log(`다중값 현재 ${rows.length}행`)

  const dual: Record<string, unknown>[] = []
  const drop: Record<string, unknown>[] = []
  for (const r of rows) {
    const parts = [r.name, r.category, r.subcategory, ...((r.tags as string[]) ?? [])]
    const blob = `${parts.filter(Boolean).join(" ")} ${r.product_url ?? ""}`
    if (MEN.test(blob) && WOM.test(blob)) dual.push(r)
    else drop.push(r)
  }
  console.log(`  A 양쪽 부서 등록 → unisex: ${dual.length}`)
  console.log(`  B 근거 없음 → 삭제:      ${drop.length}`)

  fs.mkdirSync("data/repair", {recursive: true})
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        rule: "A = name/category/subcategory/tags/url 에 men·women 토큰이 모두 존재. B = 그 외.",
        dual_to_unisex: dual,
        deleted: drop,
      },
      null,
      2,
    ),
  )
  console.log(`매니페스트: ${MANIFEST}`)

  if (!APPLY) {
    console.log("\n--apply 없음 — DB 쓰기 없이 종료. 표본:")
    for (const r of dual.slice(0, 3)) console.log(`  A ${JSON.stringify(r.gender)} ${r.platform} ${String(r.name).slice(0, 42)} ${JSON.stringify(r.tags).slice(0, 60)}`)
    for (const r of drop.slice(0, 3)) console.log(`  B ${JSON.stringify(r.gender)} ${r.platform} ${String(r.name).slice(0, 42)} ${JSON.stringify(r.tags).slice(0, 60)}`)
    return
  }

  let updated = 0
  for (let i = 0; i < dual.length; i += 100) {
    const batch = dual.slice(i, i + 100)
    const {data, error} = await db
      .from("products")
      .update({gender: ["unisex"], gender_source: "repair_text", updated_at: new Date().toISOString()})
      .in("id", batch.map((r) => r.id as number))
      .select("id")
    if (error) throw new Error(`update failed: ${error.message}`)
    updated += data?.length ?? 0
    process.stdout.write(`\r   unisex 확정 ${updated}/${dual.length}`)
  }
  console.log("")

  let deleted = 0
  for (let i = 0; i < drop.length; i += 100) {
    const batch = drop.slice(i, i + 100)
    const {data, error} = await db.from("products").delete().in("id", batch.map((r) => r.id as number)).select("id")
    if (error) throw new Error(`delete failed: ${error.message}`)
    deleted += data?.length ?? 0
    process.stdout.write(`\r   삭제 ${deleted}/${drop.length}`)
  }
  console.log("")
  console.log(`✅ unisex 확정 ${updated} · 삭제 ${deleted}`)
}

main()
