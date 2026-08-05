#!/usr/bin/env npx tsx
/**
 * GENDER_RULES 변경의 A/B 하네스.
 *
 * 현재 체크아웃의 resolver 로 products 전 행을 재판정해 `{id: gender}` 를 덤프한다.
 * 규칙을 바꾸기 전/후로 각각 돌려 diff 하면 **획득 / 상실 / 뒤집힘**이 나온다.
 *
 *   npx dotenv -e .env.local -- npx tsx tools/ab-gender-rules.ts /tmp/new.json
 *   git stash push src/lib/product-gender.ts
 *   npx dotenv -e .env.local -- npx tsx tools/ab-gender-rules.ts /tmp/old.json
 *   git stash pop
 *
 * 어휘를 추측으로 늘리지 않기 위한 도구다 (CLAUDE.md §18). 실측 없이 넣으면
 * `lady`(전부 고유명사) 나 `menswear`(여성복 관용어) 처럼 오탐이 들어온다.
 *
 * 반드시 **같은 resolver** 로 양쪽을 재야 한다. 비교용으로 판정 로직을 따로
 * 짜면 URL/텍스트 분리와 충돌 처리가 달라져 규칙과 무관한 차이가 잡힌다
 * (2026-08-05 실측: 그 방식으로 103행이 거짓 차이로 나왔다).
 */
import * as fs from "node:fs"

import {createClient} from "@supabase/supabase-js"

import {resolveProductGenderWithSource} from "../src/lib/product-gender"

const out = process.argv[2]
const db = createClient(process.env.DB_URL!, process.env.DB_TOKEN!)

async function main(): Promise<void> {
  const result: Record<string, string> = {}
  let n = 0
  for (let o = 0; ; o += 1000) {
    const {data, error} = await db
      .from("products")
      .select("id,name,category,subcategory,tags,product_url")
      .order("id")
      .range(o, o + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data as Record<string, unknown>[]) {
      n++
      const res = resolveProductGenderWithSource([], {
        name: r.name as string,
        category: r.category as string,
        subcategory: r.subcategory as string,
        tags: r.tags as string[],
        productUrl: r.product_url as string,
      })
      result[String(r.id)] = res.gender[0] ?? "-"
    }
    if (data.length < 1000) break
  }
  fs.writeFileSync(out, JSON.stringify(result))
  console.log(`${n}행 → ${out}`)
}
main()
