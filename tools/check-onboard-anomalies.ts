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
  color: string | null
  gender: string[] | null
  in_stock: boolean
}

const SPEC_LABEL_PATTERN = /(?:판매가|상품명|제조사|소비자가|적립금|브랜드|원산지|모델명|재질)\s*[:：]/

async function checkPlatform(db: ReturnType<typeof createProductCollectionClient>, platform: string): Promise<string[]> {
  const findings: string[] = []
  const {data, error} = await db
    .from("products")
    .select("id,platform,name,brand,price,source_currency,color,gender,in_stock")
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

  // 3. 색상: null 비율
  const colorNull = rows.filter((r) => !r.color).length
  if (colorNull / rows.length > 0.3) {
    findings.push(`  ⚠️  color 없음: ${colorNull}/${rows.length} (${((colorNull / rows.length) * 100).toFixed(1)}%)`)
  }

  // 4. 성별: 빈 배열
  const genderEmpty = rows.filter((r) => !r.gender || r.gender.length === 0).length
  if (genderEmpty > 0) {
    findings.push(`  ⚠️  gender 빈 배열: ${genderEmpty}건`)
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
