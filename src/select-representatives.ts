#!/usr/bin/env npx tsx
/**
 * Brand representative product 선정 CLI.
 *
 * SPEC-BRAND-NODE-001 PR-Y: brand-VLM 의 5장 입력 source 가
 * products.is_brand_representative=true 컬럼. 본 CLI 는 brand 별로
 * 다양성 휴리스틱으로 최대 10 product 에 is_brand_representative=true flag (기본 target=10)
 * cache 동기화.
 *
 * SPEC 의 random.sample(5) 방식은 폐기 — diversity-aware 선택이 brand 정체성
 * 신호로 더 적합 (한 카테고리에 쏠리면 brand mood 좌우편향).
 *
 * 휴리스틱 (이번 PR):
 *   1) brand_node_id 매핑된 product 만 대상.
 *   2) image_url 보유 + image_url 이 icon/logo/badge 류 아님.
 *   3) category 분산 우선 (round-robin: top/bottom/outer/dress/acc/...).
 *   4) 같은 category 내 in_stock=true 우선, 그 다음 created_at DESC (신상).
 *   5) 부족하면 in_stock=false fallback.
 *
 * 사용법:
 *   npx tsx src/select-representatives.ts --all                    # 모든 brand
 *   npx tsx src/select-representatives.ts --brand "AURALEE"        # 특정 brand
 *   npx tsx src/select-representatives.ts --brand-id 42            # 특정 brand id
 *   npx tsx src/select-representatives.ts --all --target 7         # 목표 개수
 *   npx tsx src/select-representatives.ts --all --dry-run
 *   npx tsx src/select-representatives.ts --all --only-empty       # rep 0개인 brand만
 *
 * 다음 단계 (PR-Z 머지 후):
 *   select-representatives wet-run 완료 → unclassified brand 자동
 *   POST /api/internal/classify-brand 호출 (별도 CLI / 후속 PR).
 */

import {createClient} from "@supabase/supabase-js"

const DB_URL = process.env.DB_URL
const DB_TOKEN = process.env.DB_TOKEN

if (!DB_URL || !DB_TOKEN) {
  console.error("❌ DB_URL / DB_TOKEN 환경변수 필요")
  process.exit(1)
}

const db = createClient(DB_URL, DB_TOKEN)

// ─── CLI 인자 ────────────────────────────────────────

interface Flags {
  all: boolean
  brand?: string
  brandId?: number
  target: number
  dryRun: boolean
  onlyEmpty: boolean
  limit?: number
}

function parseArgs(): Flags {
  const args = process.argv.slice(2)
  const f: Flags = {all: false, target: 10, dryRun: false, onlyEmpty: false}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--all") f.all = true
    else if (a === "--dry-run") f.dryRun = true
    else if (a === "--only-empty") f.onlyEmpty = true
    else if (a === "--brand") f.brand = args[++i]
    else if (a.startsWith("--brand=")) f.brand = a.slice("--brand=".length)
    else if (a === "--brand-id") f.brandId = parseInt(args[++i], 10)
    else if (a.startsWith("--brand-id=")) f.brandId = parseInt(a.slice("--brand-id=".length), 10)
    else if (a === "--target") f.target = parseInt(args[++i], 10)
    else if (a.startsWith("--target=")) f.target = parseInt(a.slice("--target=".length), 10)
    else if (a === "--limit") f.limit = parseInt(args[++i], 10)
    else if (a.startsWith("--limit=")) f.limit = parseInt(a.slice("--limit=".length), 10)
  }
  if (!f.all && !f.brand && !f.brandId) {
    console.error("❌ --all / --brand <name> / --brand-id <id> 중 하나 필요")
    process.exit(1)
  }
  if (f.target < 1 || f.target > 20) {
    console.error("❌ --target 은 1~20 범위")
    process.exit(1)
  }
  return f
}

// ─── 타입 ────────────────────────────────────────────

interface ProductRow {
  id: string
  category: string | null
  image_url: string | null
  in_stock: boolean | null
  created_at: string | null
  is_brand_representative: boolean
}

interface BrandRow {
  id: number
  brand_name: string
}

// ─── 이미지 URL 유효성 ───────────────────────────────

// OpenAI / LiteLLM 이 외부 fetch 시도 시 403 반환하는 CDN 도메인 블랙리스트.
// brand-VLM 호출 시 5장 묶음 중 1장만 invalid 해도 전체 400 fail 되므로
// rep 후보 단계에서 미리 제외. 추가 차단 도메인 발견 시 본 배열에 append.
const BLOCKED_IMAGE_DOMAINS = [
  "farfetch-contents.com",   // Farfetch CDN — 403 (referer/origin check)
]

function isUsableImage(url: string | null): boolean {
  if (!url) return false
  if (!url.startsWith("http")) return false
  // analyze-products.ts 와 동일한 필터 — icon/logo/badge 류 배제
  if (/\/(icon|logo|badge)_/.test(url)) return false
  // CDN 외부 fetch 차단 도메인 배제 (brand-VLM 5장 묶음 fail 회피)
  for (const blocked of BLOCKED_IMAGE_DOMAINS) {
    if (url.includes(blocked)) return false
  }
  return true
}

// ─── 다양성 휴리스틱 ────────────────────────────────

function selectDiverse(products: ProductRow[], target: number): ProductRow[] {
  // 1) 사용 가능 product 만
  const usable = products.filter((p) => isUsableImage(p.image_url))
  if (usable.length === 0) return []

  // 2) category bucket — null 은 "_uncategorized" 로 묶음
  const buckets = new Map<string, ProductRow[]>()
  for (const p of usable) {
    const cat = p.category ?? "_uncategorized"
    if (!buckets.has(cat)) buckets.set(cat, [])
    buckets.get(cat)!.push(p)
  }

  // 3) 각 bucket 내 정렬 — in_stock=true 먼저, 그 다음 created_at DESC
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const aStock = a.in_stock ? 1 : 0
      const bStock = b.in_stock ? 1 : 0
      if (aStock !== bStock) return bStock - aStock
      const aTime = a.created_at ? Date.parse(a.created_at) : 0
      const bTime = b.created_at ? Date.parse(b.created_at) : 0
      return bTime - aTime
    })
  }

  // 4) Round-robin pick — bucket 순서는 size 큰 것 먼저 (안정적 분산)
  const selected: ProductRow[] = []
  const catOrder = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat]) => cat)

  while (selected.length < target) {
    let progress = false
    for (const cat of catOrder) {
      if (selected.length >= target) break
      const list = buckets.get(cat)!
      const next = list.shift()
      if (next) {
        selected.push(next)
        progress = true
      }
    }
    if (!progress) break // 모든 bucket 비었음
  }

  return selected
}

// ─── Brand 처리 ─────────────────────────────────────

async function processBrand(
  brand: BrandRow,
  target: number,
  dryRun: boolean,
): Promise<{
  selected: number
  cleared: number
  imageUrls: string[]
  skipReason?: string
}> {
  // 1) 해당 brand 의 product 전부 fetch
  const allProducts: ProductRow[] = []
  const PAGE = 1000
  let offset = 0
  for (;;) {
    const {data, error} = await db
      .from("products")
      .select("id, category, image_url, in_stock, created_at, is_brand_representative")
      .eq("brand_node_id", brand.id)
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.warn(`   ⚠️ products fetch 실패 brand=${brand.id}: ${error.message}`)
      return {selected: 0, cleared: 0, imageUrls: [], skipReason: "fetch_failed"}
    }
    if (!data?.length) break
    allProducts.push(...(data as ProductRow[]))
    if (data.length < PAGE) break
    offset += PAGE
  }

  if (allProducts.length === 0) {
    return {selected: 0, cleared: 0, imageUrls: [], skipReason: "no_products"}
  }

  // 2) 다양성 선정
  const newReps = selectDiverse(allProducts, target)
  if (newReps.length === 0) {
    return {selected: 0, cleared: 0, imageUrls: [], skipReason: "no_usable_image"}
  }

  const newRepIds = new Set(newReps.map((p) => p.id))
  const currentRepIds = new Set(
    allProducts.filter((p) => p.is_brand_representative).map((p) => p.id),
  )

  // 3) Diff — clear old (true → false), set new (false → true)
  const toClear: string[] = []
  for (const id of currentRepIds) if (!newRepIds.has(id)) toClear.push(id)
  const toSet: string[] = []
  for (const id of newRepIds) if (!currentRepIds.has(id)) toSet.push(id)

  const imageUrls = newReps.map((p) => p.image_url!).filter(Boolean)

  if (dryRun) {
    return {selected: newReps.length, cleared: toClear.length, imageUrls}
  }

  // 4) Apply
  if (toClear.length > 0) {
    const {error} = await db
      .from("products")
      .update({is_brand_representative: false})
      .in("id", toClear)
    if (error) {
      console.warn(`   ⚠️ clear 실패 brand=${brand.id}: ${error.message}`)
    }
  }
  if (toSet.length > 0) {
    const {error} = await db
      .from("products")
      .update({is_brand_representative: true})
      .in("id", toSet)
    if (error) {
      console.warn(`   ⚠️ set 실패 brand=${brand.id}: ${error.message}`)
    }
  }

  // brand_nodes.representative_image_urls 캐시는 SPEC-ARCH-CRAWLER-001 마이그에서
  // 컬럼 제거됨 → 동기화 불필요. 대표 선정은 products.is_brand_representative 가 단일 소스.

  return {selected: newReps.length, cleared: toClear.length, imageUrls}
}

// ─── Main ────────────────────────────────────────────

async function main() {
  const flags = parseArgs()

  console.log(`\n🎯 brand representative 선정`)
  console.log(`   target: ${flags.target} | dry-run: ${flags.dryRun} | only-empty: ${flags.onlyEmpty}`)

  // 대상 brand 조회
  let brands: BrandRow[] = []
  if (flags.brandId) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id, brand_name")
      .eq("id", flags.brandId)
      .single()
    if (error || !data) {
      console.error(`❌ brand_id=${flags.brandId} 조회 실패: ${error?.message}`)
      process.exit(1)
    }
    brands = [data as BrandRow]
  } else if (flags.brand) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id, brand_name")
      .or(`brand_name.ilike.${flags.brand},brand_name_normalized.ilike.${flags.brand}`)
    if (error) {
      console.error(`❌ brand="${flags.brand}" 조회 실패: ${error.message}`)
      process.exit(1)
    }
    brands = (data ?? []) as BrandRow[]
    if (brands.length === 0) {
      console.error(`❌ brand="${flags.brand}" 매칭 안 됨`)
      process.exit(1)
    }
  } else {
    // --all
    const PAGE = 1000
    let offset = 0
    for (;;) {
      const {data, error} = await db
        .from("brand_nodes")
        .select("id, brand_name")
        .order("id", {ascending: true})
        .range(offset, offset + PAGE - 1)
      if (error) {
        console.error(`❌ brand_nodes fetch 실패: ${error.message}`)
        process.exit(1)
      }
      if (!data?.length) break
      brands.push(...(data as BrandRow[]))
      if (data.length < PAGE) break
      offset += PAGE
    }
  }

  // --limit 적용 (DB fetch 후 메모리에서 자름)
  if (flags.limit && brands.length > flags.limit) {
    brands = brands.slice(0, flags.limit)
    console.log(`   --limit ${flags.limit} 적용 후: ${brands.length}개`)
  }

  // --only-empty: 현재 representative 가 0개인 brand 로 좁힘
  if (flags.onlyEmpty) {
    const filtered: BrandRow[] = []
    for (const b of brands) {
      const {count, error} = await db
        .from("products")
        .select("id", {count: "exact", head: true})
        .eq("brand_node_id", b.id)
        .eq("is_brand_representative", true)
      if (error) {
        console.warn(`⚠️ rep count 조회 실패 brand=${b.id}: ${error.message}`)
        continue
      }
      if ((count ?? 0) === 0) filtered.push(b)
    }
    brands = filtered
    console.log(`   only-empty 필터 후: ${brands.length}개 brand`)
  }

  console.log(`   대상 brand: ${brands.length}개\n`)

  let totalSelected = 0
  let totalSkipped = 0
  const skipReasons = new Map<string, number>()

  for (let i = 0; i < brands.length; i++) {
    const b = brands[i]
    process.stdout.write(`\r[${i + 1}/${brands.length}] ${b.brand_name.slice(0, 30)}`)
    const result = await processBrand(b, flags.target, flags.dryRun)
    if (result.skipReason) {
      totalSkipped++
      skipReasons.set(result.skipReason, (skipReasons.get(result.skipReason) ?? 0) + 1)
    } else {
      totalSelected += result.selected
    }
  }

  console.log(`\n\n${"═".repeat(50)}`)
  console.log(`🏁 완료 — ${brands.length}개 brand 처리`)
  console.log(`   ✅ 선정: ${totalSelected}개 product`)
  console.log(`   ⏭️  skip: ${totalSkipped}개 brand`)
  if (skipReasons.size > 0) {
    for (const [r, n] of skipReasons) console.log(`      ${r}: ${n}`)
  }
  if (flags.dryRun) console.log(`   🔍 DRY RUN — DB 변경 없음`)
  console.log(`${"═".repeat(50)}\n`)

  console.log(`📌 다음 단계 (PR-Z 머지 후):`)
  console.log(`   POST /api/internal/classify-brand 으로 unclassified brand 자동 분류`)
  console.log(`   (별도 CLI 또는 본 CLI 의 --classify 옵션으로 통합 예정)\n`)
}

main().catch((err) => {
  console.error("❌ Fatal:", err)
  process.exit(1)
})
