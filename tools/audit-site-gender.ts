#!/usr/bin/env npx tsx
/**
 * gender-defaults.ts 후보 사이트의 근거를 한 번에 모은다 (read-only).
 *
 * 모으는 근거는 셋 다 **상품 단위**다 — brand_nodes.gender_scope 는 쓰지 않는다
 * (src/configs/gender-defaults.ts 헤더 참조).
 *
 *   1. 여성/남성 배타 의류 어휘  — 공용 품목(티셔츠·후드·팬츠)은 세지 않는다
 *   2. LLM 이 매긴 category      — dresses 는 여성 배타에 가깝다
 *   3. gender_source 가 신뢰 가능한 행의 실제 분포
 *
 * 출력: data/site-gender-audit.json (사람이 검토하는 입력)
 */
import * as fs from "node:fs"
import {createClient} from "@supabase/supabase-js"
import {PLATFORMS} from "../src/configs/platforms"
import {resolveProductGenderWithSource} from "../src/lib/product-gender"

const W = /원피스|드레스|스커트|블라우스|치마|레깅스|뷔스티에|캐미솔|튜브탑|브라탑|슬립드레스|\bdress(es)?\b|\bskirt(s)?\b|blouse|bustier|camisole|halter|bralette|\bwomen|여성|우먼/i
const M = /남성|맨즈|\bmen'?s\b|\bmens\b|넥타이|necktie|정장셔츠/i
const TRUSTED = new Set(["engine","url","text","repair_url","repair_text","llm"])

async function main() {
  const db = createClient(process.env.DB_URL!, process.env.DB_TOKEN!)
  const targets = (PLATFORMS as any[]).filter(
    (p) => p.category?.categories?.length && p.category.categories.every((x: any) => /^Cat\d+$/.test(x.name)),
  )
  const out: any[] = []
  for (const p of targets) {
    const rows: any[] = []
    for (let f = 0; ; f += 1000) {
      const {data} = await db
        .from("products")
        .select("name,category,subcategory,tags,product_url,gender,gender_source")
        .eq("platform", p.key)
        .range(f, f + 999)
      if (!data || data.length === 0) break
      rows.push(...(data as any[]))
      if (data.length < 1000) break
    }
    if (rows.length === 0) continue
    // 핵심 지표: 사이트 기본값 **없이** 상품 단위 근거만으로 풀리는 비율.
    // 이게 높으면 defaultGender 가 아예 필요 없다 (uniformbridge 처럼 상품명에
    // 성별이 박힌 혼성 브랜드가 여기 해당한다).
    let resolved = 0
    const resolvedBy = new Map<string, number>()
    let w = 0, m = 0, dresses = 0
    const trusted = new Map<string, number>()
    const cats = new Map<string, number>()
    for (const r of rows) {
      const res = resolveProductGenderWithSource([], {
        name: r.name, category: r.category, subcategory: r.subcategory,
        tags: r.tags, productUrl: r.product_url,
      })
      if (res.gender.length > 0) {
        resolved++
        const k = `${res.gender.join("+")}/${res.source}`
        resolvedBy.set(k, (resolvedBy.get(k) ?? 0) + 1)
      }
      const t = String(r.name ?? "")
      if (W.test(t)) w++
      if (M.test(t)) m++
      if (r.category === "dresses") dresses++
      cats.set(r.category ?? "-", (cats.get(r.category ?? "-") ?? 0) + 1)
      if (TRUSTED.has(r.gender_source)) {
        const g = (r.gender ?? []).join("+")
        trusted.set(g, (trusted.get(g) ?? 0) + 1)
      }
    }
    out.push({
      key: p.key, name: p.name, baseUrl: p.baseUrl, n: rows.length,
      resolved, unresolvedPct: Math.round(((rows.length - resolved) / rows.length) * 100),
      resolvedBy: [...resolvedBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}=${n}`),
      womenVocab: w, menVocab: m, dresses,
      topCategories: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}=${n}`),
      trustedGender: [...trusted.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}=${n}`),
    })
  }
  out.sort((a, b) => b.n - a.n)
  fs.writeFileSync("data/site-gender-audit.json", JSON.stringify(out, null, 2))
  console.log(`대상 ${targets.length}개 중 상품 보유 ${out.length}개 → data/site-gender-audit.json`)
}
main()
