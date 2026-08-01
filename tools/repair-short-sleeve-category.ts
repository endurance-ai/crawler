#!/usr/bin/env npx tsx
/**
 * QC 의 `shorts?` 오탐으로 bottoms/shorts 로 잘못 들어간 반팔 상의를 정정한다.
 *
 * 무엇이 있었나 (실측 2026-08-01):
 *   `CATEGORY_ALIASES` 의 bottoms 패턴이 `/\b(...|shorts?|...)\b/i` 였다. `s?` 때문에
 *   홑단어 `Short` 가 매치되어 "Short Sleeve"(반팔)가 bottoms 로 추론됐고,
 *   `normalizeCategoryField` 의 `category_text_conflict` 가 원본 category 를 그 값으로
 *   갈아치웠다. category 가 bottoms 로 바뀌면 subcategory 도 그 family 로 재해석되어
 *   t-shirt → shorts 가 됐다(연쇄).
 *
 *   `s?` 자체는 의도적이다 — "Logo Biker Short" 처럼 홑단어 Short 를 명사로 쓰는
 *   상품명이 더 많다(1,170 vs 304). 그래서 규칙은 `short sleeve` 한 갈래만 예외로
 *   뺐고, 이 스크립트는 **이미 DB 에 남은 존량**을 치운다.
 *
 * 대상 판정:
 *   name ~* '\yshort[- ]?sleeve' AND category='bottoms'
 *   실측 304건 전부 subcategory='shorts' 이고, 이름에 'shorts' 가 든 것은 0건이다.
 *   즉 "반팔"이라고 적힌 상의만 걸린다 — bottoms 가 틀렸다는 것은 확실하다.
 *
 * 무엇으로 고치나 — 일괄 tops 로 밀지 않는다:
 *   고친 QC 로 이름에서 다시 추론한다. `normalizeProductTextFields` 에 category 를
 *   빈 문자열로 넣으면 `category_missing_text_fallback` 경로를 타서 순수 이름 추론
 *   결과가 나온다(별도 export 불필요). 거기서 family 가 나오면 그것을 쓰고,
 *   안 나오면 tops 로 떨어뜨린다 — "소매가 있다"는 것은 상의라는 뜻이고, 적어도
 *   bottoms 보다는 확실히 낫다. subcategory 는 확정된 family 기준으로 다시 푼다.
 *
 * 사용:
 *   npx tsx tools/repair-short-sleeve-category.ts           # dry-run (기본)
 *   npx tsx tools/repair-short-sleeve-category.ts --apply
 */

import {normalizeProductTextFields} from "../src/lib/product-qc/normalization"
import {createProductCollectionClient, type ProductCollectionClient} from "../src/lib/product-collection"

const APPLY = process.argv.includes("--apply")
const PAGE = 1000
const FALLBACK_CATEGORY = "tops"

interface Row {
  id: number
  name: string
  category: string | null
  subcategory: string | null
}

/** 이름에 "short sleeve" 가 있고 bottoms 로 분류된 행. */
function isTarget(row: Row): boolean {
  return row.category === "bottoms" && /\bshort[- ]?sleeve/i.test(row.name)
}

/**
 * 이름만으로 다시 분류한다. category 를 빈 값으로 넣어 QC 의 순수 이름 추론
 * 경로를 태운다 — 지금 DB 에 있는 bottoms 는 버그의 산물이라 입력으로 쓰면 안 된다.
 */
function reclassify(row: Row): {category: string; subcategory: string | null} {
  const inferred = normalizeProductTextFields({
    name: row.name,
    category: "",
    subcategory: null,
  })
  const category =
    typeof inferred.product.category === "string" && inferred.product.category
      ? inferred.product.category
      : FALLBACK_CATEGORY

  // subcategory 는 확정된 family 기준으로 다시 푼다. 남아 있는 'shorts' 는
  // bottoms 어휘라 새 family 에서 유효할 리 없다.
  const resolved = normalizeProductTextFields({name: row.name, category, subcategory: null})
  const subcategory =
    typeof resolved.product.subcategory === "string" ? resolved.product.subcategory : null
  return {category, subcategory}
}

async function loadRows(db: ProductCollectionClient): Promise<Row[]> {
  const rows: Row[] = []
  for (let offset = 0; ; offset += PAGE) {
    const {data, error} = await db
      .from("products")
      .select("id,name,category,subcategory")
      .eq("category", "bottoms")
      // ORDER BY 없는 OFFSET 페이징은 행을 누락시킨다 (실측 2026-07-31,
      // tools/resolve-duplicate-candidates.ts 헤더 참조).
      .order("id", {ascending: true})
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`product load failed: ${error.message}`)
    const page = (data ?? []) as Row[]
    rows.push(...page.filter(isTarget))
    if (page.length < PAGE) break
  }
  return rows
}

async function main(): Promise<void> {
  const db = createProductCollectionClient()
  const targets = await loadRows(db)
  console.log(`대상 ${targets.length.toLocaleString()}건 (category=bottoms + 이름에 "short sleeve")`)

  const plan = targets.map((row) => ({row, next: reclassify(row)}))

  const byResult = new Map<string, number>()
  for (const {next} of plan) {
    const key = `${next.category}/${next.subcategory ?? "(null)"}`
    byResult.set(key, (byResult.get(key) ?? 0) + 1)
  }
  console.log("\n정정 후 분포:")
  for (const [key, n] of [...byResult.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(28)} ${String(n).padStart(5)}`)
  }

  console.log("\n샘플 8:")
  for (const {row, next} of plan.slice(0, 8)) {
    console.log(
      `  ${row.category}/${row.subcategory} → ${next.category}/${next.subcategory}  ${row.name.slice(0, 56)}`,
    )
  }

  if (!APPLY) {
    console.log("\n[dry-run] 실제 정정하려면 --apply 를 붙여 재실행하세요.")
    return
  }

  let done = 0
  let failed = 0
  for (const {row, next} of plan) {
    const {error} = await db
      .from("products")
      .update({category: next.category, subcategory: next.subcategory})
      .eq("id", row.id)
    if (error) {
      failed += 1
      if (failed <= 3) console.error(`  ❌ #${row.id}: ${error.message}`)
    } else {
      done += 1
    }
    if (done % 50 === 0) process.stdout.write(`\r  정정 ${done}/${plan.length}`)
  }
  console.log(`\n완료 — 정정 ${done}건 · 실패 ${failed}건`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
