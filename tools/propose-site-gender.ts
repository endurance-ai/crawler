#!/usr/bin/env npx tsx
/**
 * 사이트별 defaultGender 후보 제안 (read-only).
 *
 *   npx dotenv -e .env.local -- npx tsx tools/propose-site-gender.ts
 *   npx dotenv -e .env.local -- npx tsx tools/propose-site-gender.ts --platform=aru
 *   npx dotenv -e .env.local -- npx tsx tools/propose-site-gender.ts --out=data/gender-defaults-proposal.json
 *
 * 배경: 2026-08 성별 추출 크롤러 회귀에서, URL·상품명에 성별 신호가 전혀 없는
 * cafe24 자사몰(대부분 `discovery: "auto"`)은 텍스트/URL 추론만으로 상품이
 * 전량 드랍된다. 이때 `SiteConfig.defaultGender` 가 유일한 구제 수단인데,
 * 그 기본값을 brand_nodes.gender_scope 에서 가져오면 안 된다 — 그 데이터는
 * 감사 도구도 수정 UI 도 없고, 단일값이면서 틀린 행이 상품으로 조용히
 * 전파되는 유일한 경로였다 (src/lib/product-gender.ts 헤더 참조).
 *
 * 대신 **이 사이트가 과거에 실제로 어떤 성별의 상품을 팔았는지**를 근거로 쓴다.
 * 2026-07-30(크롤러 gender 제거) 이전에 적재된 products 행의 gender 분포가 그
 * 실측이다. platforms.ts 의 noah-ny 주석이 인용한 "기존 DB 634행 실측:
 * men=634, women=3" 과 정확히 같은 근거다.
 *
 * 제안 조건 (둘 다 만족해야 제안):
 *   - 표본 >= MIN_ROWS (50행)
 *   - 최빈 성별 점유율 >= DOMINANCE (95%)
 *
 * 둘 중 하나라도 못 채우면 제안하지 않고 review 목록으로 보낸다. 근거 없이
 * unisex 를 기본값으로 박는 것은 "모름"을 "남녀공용"으로 세탁하는 것이고,
 * 검색 RPC 가 unisex 를 남녀 양쪽에 노출시키므로 정확히 이 회귀가 고치려는
 * 문제를 재생산한다. 근거가 없으면 그 사이트 상품은 드랍되는 것이 맞다.
 *
 * 출력은 제안일 뿐이다. 사람이 검토한 뒤 src/configs/gender-defaults.ts 에
 * 옮겨 적는다. 이 스크립트는 어떤 파일도 쓰지 않는다(--out 제외).
 */

import * as fs from "node:fs"

import {createClient} from "@supabase/supabase-js"

import {getSiteConfig} from "../src/configs/platforms"
import {PRODUCT_GENDER_VALUES, type ProductGender} from "../src/lib/product-gender"

/** 크롤러가 gender 생산을 멈춘 날. 이후 행은 NULL 이라 근거가 못 된다. */
const CUTOFF_ISO = "2026-07-30T00:00:00Z"
const MIN_ROWS = 50
const DOMINANCE = 0.95
const PAGE_SIZE = 1000

/**
 * 상품 단위 근거로 인정하는 gender_source 값.
 *
 * 이 화이트리스트가 이 도구의 핵심이다. 제외되는 것들:
 *
 *  - `legacy_backfill` / `brand_scope` / `repair_brand_scope`: 전부
 *    brand_nodes.gender_scope 에서 온 값이다. migration 091 이 13,942행을
 *    `UPDATE products SET gender = bn.gender_scope` 로 일괄 backfill 했다.
 *    이걸 근거로 쓰면 결정 #1(brand_scope 폴백 배제)이 뒷문으로 무효화되고,
 *    특히 `gender_scope=['unisex']` 브랜드가 100% unisex 로 보여 "확인된
 *    남녀공용"으로 둔갑한다 — 정확히 이 회귀가 고치려는 세탁이다.
 *  - `config_default`: 사이트 기본값에서 온 값. 지금 유도하려는 그 기본값이
 *    출처이므로 순환 근거다.
 *  - `unverified_legacy`: 이름 그대로 검증되지 않은 093 이전 행.
 *
 * 남는 것은 엔진 카테고리·URL 경로·상품명 텍스트에서 상품 하나하나를 보고
 * 뽑은 값뿐이다.
 */
const TRUSTED_SOURCES = ["engine", "url", "text", "repair_url", "repair_text", "llm"] as const

interface PlatformStats {
  platform: string
  counts: Record<string, number>
  total: number
}

function parseFlags(argv: string[]) {
  const get = (name: string): string => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : ""
  }
  return {
    platform: get("platform"),
    out: get("out"),
    /**
     * `gender_source IS NULL` 행(093 이전, 출처 미상 97,444행)도 근거로 포함한다.
     *
     * 이 행들은 migration 091 의 brand_scope backfill 일 수도 있고 093 이전
     * 엔진 크롤 값일 수도 있어 구분이 불가능하다. 그래서 이 모드의 출력은
     * **제안이 아니라 수동 검증 후보**다 — 반드시 사람이 실제 사이트를 확인한
     * 뒤 gender-defaults.ts 에 옮겨야 한다.
     *
     * 세탁 위험을 줄이기 위해 이 모드에서는 unisex 후보를 자동 탈락시킨다:
     * 091 의 backfill 이 `gender_scope=['unisex']` 브랜드를 그대로 복사했고,
     * 그게 "모름"이 "남녀공용"으로 둔갑하는 바로 그 경로다.
     */
    allowNullSource: argv.includes("--allow-null-source"),
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))

  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) {
    console.error("❌ DB_URL, DB_TOKEN 환경변수 필요")
    console.error("   npx dotenv -e .env.local -- npx tsx tools/propose-site-gender.ts")
    process.exit(1)
  }
  const db = createClient(dbUrl, dbToken)

  const byPlatform = new Map<string, PlatformStats>()
  let from = 0
  let scanned = 0

  for (;;) {
    let q = db
      .from("products")
      .select("platform, gender, gender_source")
      .lt("crawled_at", CUTOFF_ISO)
      .not("gender", "is", null)
      .range(from, from + PAGE_SIZE - 1)
    if (flags.allowNullSource) {
      // 신뢰 출처 OR 출처 미상. brand_scope/legacy_backfill/config_default 등
      // 명시적으로 신뢰 못 할 출처는 여전히 배제한다.
      q = q.or(`gender_source.in.(${TRUSTED_SOURCES.join(",")}),gender_source.is.null`)
    } else {
      q = q.in("gender_source", TRUSTED_SOURCES as unknown as string[])
    }
    if (flags.platform) q = q.eq("platform", flags.platform)

    const {data, error} = await q
    if (error) {
      console.error(`❌ products 조회 실패: ${error.message}`)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const row of data as Array<{platform: string | null; gender: string[] | null}>) {
      const platform = row.platform ?? ""
      if (!platform) continue
      const gender = Array.isArray(row.gender) ? row.gender : []
      if (gender.length === 0) continue

      let stats = byPlatform.get(platform)
      if (!stats) {
        stats = {platform, counts: {}, total: 0}
        byPlatform.set(platform, stats)
      }
      // 다중값 행(['men','women'])은 어느 쪽도 지지하지 않으므로 표본에서 뺀다 —
      // 기본값은 단일 성별일 때만 의미가 있다.
      if (gender.length !== 1) continue
      const g = gender[0]
      stats.counts[g] = (stats.counts[g] ?? 0) + 1
      stats.total += 1
    }

    scanned += data.length
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  console.log(
    `📊 ${CUTOFF_ISO} 이전 · gender_source ∈ {${TRUSTED_SOURCES.join(", ")}} 행 ${scanned}건 스캔, ${byPlatform.size}개 플랫폼`,
  )
  console.log(`   (brand_scope/legacy_backfill/config_default 유래 행은 근거에서 제외됨)\n`)

  const proposals: Array<{platform: string; defaultGender: ProductGender[]; share: number; total: number}> = []
  const review: Array<{platform: string; reason: string; detail: string}> = []

  for (const stats of [...byPlatform.values()].sort((a, b) => a.platform.localeCompare(b.platform))) {
    const entries = Object.entries(stats.counts).sort((a, b) => b[1] - a[1])
    const detail = entries.map(([g, n]) => `${g}=${n}`).join(" ")

    if (stats.total < MIN_ROWS) {
      review.push({platform: stats.platform, reason: `표본 부족 (${stats.total} < ${MIN_ROWS})`, detail})
      continue
    }
    const [topGender, topCount] = entries[0]
    const share = topCount / stats.total
    if (share < DOMINANCE) {
      review.push({
        platform: stats.platform,
        reason: `우세 성별 없음 (최빈 ${topGender} ${(share * 100).toFixed(1)}% < ${DOMINANCE * 100}%)`,
        detail,
      })
      continue
    }
    if (!(PRODUCT_GENDER_VALUES as readonly string[]).includes(topGender)) {
      review.push({platform: stats.platform, reason: `비정규 성별 값 ${topGender}`, detail})
      continue
    }
    // --allow-null-source 모드의 unisex 는 091 brand_scope backfill 의 세탁
    // 흔적일 가능성이 높다. 자동 제안하지 않고 검토로 보낸다.
    if (flags.allowNullSource && topGender === "unisex") {
      review.push({platform: stats.platform, reason: `출처 미상 unisex — 세탁 의심, 사이트 확인 필요`, detail})
      continue
    }
    proposals.push({
      platform: stats.platform,
      defaultGender: [topGender as ProductGender],
      share,
      total: stats.total,
    })
  }

  const label = flags.allowNullSource ? "수동 검증 후보" : "제안"
  console.log(`✅ ${label} ${proposals.length}개 (표본 >= ${MIN_ROWS}, 점유율 >= ${DOMINANCE * 100}%)`)
  if (flags.allowNullSource) {
    console.log(`   ⚠️ 출처 미상 행 포함 — 아래 URL 을 열어 확인한 뒤에만 gender-defaults.ts 에 옮길 것\n`)
  } else {
    console.log("")
  }
  for (const p of proposals) {
    const url = getSiteConfig(p.platform)?.baseUrl ?? ""
    console.log(
      `   "${p.platform}": ${JSON.stringify(p.defaultGender)},`.padEnd(44) +
        `// ${p.total}행 ${(p.share * 100).toFixed(1)}%  ${url}`,
    )
  }

  console.log(`\n🔍 검토 필요 ${review.length}개 (기본값 없이 두면 해당 상품은 드랍됨)\n`)
  for (const r of review) {
    console.log(`   ${r.platform}: ${r.reason} — ${r.detail}`)
  }

  if (flags.out) {
    fs.writeFileSync(flags.out, JSON.stringify({cutoff: CUTOFF_ISO, proposals, review}, null, 2), "utf-8")
    console.log(`\n💾 ${flags.out}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
