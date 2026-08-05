#!/usr/bin/env npx tsx
/**
 * daily-onboard 파이프라인 마지막 단계 — 방금 크롤+적재한 플랫폼들의 products 행을
 * 대상으로 오늘 하루 종일 실측으로 잡아낸 이상 패턴을 재사용 가능한 형태로 검사한다.
 *
 * "이상치를 코드로 고치는" 판단(근본 원인 추론)은 자동화하지 않는다 — 여기서는
 * 명확한 리포트만 만들고, 실제 수정은 사람이 그 리포트를 보고 별도 세션에서
 * 진행한다 (2026-07-22, brand/price 정합성 세션에서 확정).
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx tools/check-onboard-anomalies.ts --platforms=etce,bittercells
 */
import {createProductCollectionClient} from "../src/lib/product-collection"
import {cleanGenderScope} from "../src/lib/product-gender"

function flag(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.slice(name.length + 3) : undefined
}

interface ProductRow {
  id: number
  platform: string
  name: string
  brand: string
  price: number | null
  source_currency: string | null
  in_stock: boolean
  gender: string[] | null
  gender_source: string | null
}

const SPEC_LABEL_PATTERN = /(?:판매가|상품명|제조사|소비자가|적립금|브랜드|원산지|모델명|재질)\s*[:：]/

// 성별 임계값. write 시점 게이트(QC needsReview + 두 INSERT 경로의 단일값 가드)가
// "빈 값·다중값"은 이미 막으므로, 여기서 잡으려는 것은 **값은 있는데 근거가 약한**
// 쏠림이다. 판정 자체를 자동으로 고치지 않고 사람이 볼 리포트만 만든다.
const GENDER_MIN_ROWS = 20 // 표본이 작으면 비율이 의미 없다
const UNISEX_SHARE_WARN = 0.6
const CONFIG_DEFAULT_SHARE_WARN = 0.8

function topSources(rows: ProductRow[]): string {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = r.gender_source ?? "(null)"
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, n]) => `${source} ${n}`)
    .join(" / ")
}

async function checkPlatform(db: ReturnType<typeof createProductCollectionClient>, platform: string): Promise<string[]> {
  const findings: string[] = []
  const {data, error} = await db
    .from("products")
    .select("id,platform,name,brand,price,source_currency,in_stock,gender,gender_source")
    .eq("platform", platform)
    .limit(5000)
  if (error) {
    findings.push(`  ❌ 조회 실패: ${error.message}`)
    return findings
  }
  const rows = (data ?? []) as ProductRow[]
  if (rows.length === 0) {
    findings.push("  ⚠️  적재된 행이 0건")
    return findings
  }

  // 1. 가격: null, 그리고 KRW인데 1000원 미만(비KRW는 소액이 정상일 수 있어 제외)
  const priceNull = rows.filter((r) => r.price === null).length
  const priceSuspiciousLow = rows.filter(
    (r) => r.price !== null && r.price < 1000 && (r.source_currency ?? "KRW") === "KRW",
  ).length
  if (priceNull / rows.length > 0.1) {
    findings.push(`  ⚠️  가격 null: ${priceNull}/${rows.length} (${((priceNull / rows.length) * 100).toFixed(1)}%)`)
  }
  if (priceSuspiciousLow > 0) {
    findings.push(`  ⚠️  KRW인데 1000원 미만: ${priceSuspiciousLow}건 — 예약금/통화오탐/파싱실패 의심 (2026-07 실측 패턴)`)
  }

  // 2. 브랜드: 빈 문자열, name과 완전 동일, spec 라벨 누출
  const brandEmpty = rows.filter((r) => !r.brand || r.brand.trim() === "").length
  const brandEqualsName = rows.filter(
    (r) => r.brand && r.name && r.brand.trim().toLowerCase() === r.name.trim().toLowerCase(),
  ).length
  const brandLabelLeak = rows.filter((r) => r.brand && SPEC_LABEL_PATTERN.test(r.brand)).length
  if (brandEmpty > 0) findings.push(`  ⚠️  brand 빈 문자열: ${brandEmpty}건`)
  if (brandEqualsName > 0) findings.push(`  ⚠️  brand === name (DOM 오인식 의심): ${brandEqualsName}건`)
  if (brandLabelLeak > 0) findings.push(`  ⚠️  brand에 spec 라벨 텍스트 누출: ${brandLabelLeak}건`)

  // 3. 성별 (2026-08-05 복원 — 2026-07-29 VLM 이관 때 빠져 있었다).
  //    어휘는 cleanGenderScope 하나만 쓴다. 여기에 성별 정규식을 새로 쓰지 말 것
  //    (§18: GENDER_RULES 가 유일 출처).
  const genderNotSingle = rows.filter((r) => cleanGenderScope(r.gender).length !== 1)
  if (genderNotSingle.length > 0) {
    // migration 105 의 chk_products_gender_required(cardinality=1) 가 걸린 DB 라면
    // 여기 걸리는 것 자체가 불가능하다. 0이 아니라면 CHECK 미적용 환경이거나
    // 가드 없는 적재 경로가 새로 생겼다는 뜻이다.
    findings.push(
      `  ⚠️  gender 단일값 계약 위반: ${genderNotSingle.length}건 — migration 105 미적용이거나 가드 없는 적재 경로 의심`,
    )
  }

  const genderSourceNull = rows.filter((r) => !r.gender_source).length
  if (genderSourceNull > 0) {
    findings.push(`  ⚠️  gender_source 미기록: ${genderSourceNull}건 — write-path 는 항상 채운다 (093 이전 행이 아니면 버그)`)
  }

  if (rows.length >= GENDER_MIN_ROWS) {
    const single = rows.filter((r) => cleanGenderScope(r.gender).length === 1)
    const unisex = single.filter((r) => cleanGenderScope(r.gender)[0] === "unisex")
    const unisexShare = unisex.length / single.length
    if (single.length > 0 && unisexShare >= UNISEX_SHARE_WARN) {
      // unisex 는 검색 RPC 가 남녀 양쪽에 노출시키므로(p.gender && ARRAY[p_gender,
      // 'unisex']) 세탁되면 여성 상품이 남성 검색으로 샌다. 근거 분포를 함께
      // 찍어 "확인된 unisex"(engine/text 태그 근거)와 "사이트 기본값 일괄"을
      // 사람이 구분할 수 있게 한다.
      findings.push(
        `  ⚠️  unisex 쏠림: ${unisex.length}/${single.length} (${(unisexShare * 100).toFixed(1)}%) — 근거 분포: ${topSources(unisex)}`,
      )
    }

    const configDefault = rows.filter((r) => r.gender_source === "config_default").length
    const configDefaultShare = configDefault / rows.length
    if (configDefaultShare >= CONFIG_DEFAULT_SHARE_WARN) {
      // 상품 단위 근거(engine/url/text)가 거의 없이 사이트 전역 기본값 하나로
      // 전량이 찍힌 상태. 브랜드가 실제 단일 성별이면 정상이지만, 남녀 모두 파는
      // 브랜드에서는 상품 단위로 틀린다 (§18 jadedldn 1,275행 사례).
      findings.push(
        `  ⚠️  gender 근거가 사이트 기본값 일변도: config_default ${configDefault}/${rows.length} (${(configDefaultShare * 100).toFixed(1)}%) — 단일 성별 브랜드가 맞는지 확인 필요`,
      )
    }
  }

  if (findings.length === 0) {
    findings.push(`  ✅ 이상 없음 (${rows.length}건 검사)`)
  }
  return findings
}

async function main() {
  const platformsArg = flag("platforms")
  if (!platformsArg) throw new Error("--platforms=key1,key2 is required")
  const platforms = platformsArg.split(",").filter(Boolean)

  const db = createProductCollectionClient()
  let anyIssue = false
  for (const platform of platforms) {
    console.log(`\n[${platform}]`)
    const findings = await checkPlatform(db, platform)
    for (const line of findings) console.log(line)
    if (findings.some((f) => f.includes("⚠️") || f.includes("❌"))) anyIssue = true
  }

  console.log(
    anyIssue
      ? "\n⚠️  이상치가 발견된 플랫폼이 있습니다 — 위 리포트를 Claude 세션에 붙여넣고 원인 조사를 요청하세요."
      : "\n✅ 전체 정상.",
  )
  if (anyIssue) process.exitCode = 2
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
