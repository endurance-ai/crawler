/**
 * 신규 `brand_nodes` 자동 생성을 어떤 출처까지 신뢰할지 판정한다 (순수 로직).
 *
 * 배경: import 는 미등록 브랜드를 만나면 `brand_nodes` 를 자동 INSERT 해왔다.
 * 그런데 멀티브랜드 편집샵은 상품마다 브랜드가 달라, 크롤러가 DOM 에서 브랜드를
 * 잘못 주워오면(플랫폼명·상품명·채움문자 등) 그 쓰레기가 그대로 신규 브랜드로
 * 만들어진다. 실측된 오염 사례:
 *   - 플랫폼명이 브랜드로 적재됨 (8division 등) → `tools/cleanup-platform-as-brand.ts`
 *   - `glowny` 1,345건 전부 brand = "ㅤ" (U+3164 한글 채움문자)
 *   - `etce` 1,604건 brand = "판매가 : X, 상품명 : Y" 같은 DOM 텍스트
 *
 * 그래서 **단일브랜드 자사몰만** 신뢰한다. 하우스 브랜드가 config 에 큐레이션돼
 * 있어 상품별 브랜드 추출에 의존하지 않기 때문이다. 편집샵의 실제 상품별 브랜드는
 * 온보딩 LLM 추출 → 기존 brand_nodes 매칭(`--no-new-brands`) 경로로만 적재된다.
 */

export interface BrandSourceTrust {
  /** import 의 SELF_BRANDED 맵에 등재된 자사몰인가. */
  selfBranded: boolean
  /** config.brand — 하우스 브랜드. 있으면 상품별 추출에 의존하지 않는다. */
  configBrand?: string | null
  /** config.multiBrand — 상품마다 브랜드가 다른 편집샵. */
  multiBrand?: boolean
}

/**
 * `multiBrand` 를 함께 보는 이유: 현재 config 중 `brand` 와 `multiBrand` 를 동시에
 * 가진 것은 0개지만(2026-07-30 실측), 나중에 편집샵에 하우스 브랜드를 적어 넣으면
 * "brand 가 있으니 신뢰" 로 오판한다. `refresh-source.resolveCandidateBrand` 도
 * 같은 기준(`house && !multiBrand`)을 쓴다 — 두 경로의 판정을 어긋나게 두지 않는다.
 */
export function isTrustedBrandSource(trust: BrandSourceTrust): boolean {
  if (trust.multiBrand) return false
  if (trust.selfBranded) return true
  return !!trust.configBrand?.trim()
}

export interface UnknownBrandEntry {
  /** 이 브랜드를 처음 내보낸 플랫폼 (리포트·resolve 입력용). */
  platform: string
  trusted: boolean
}

/**
 * 미등록 브랜드를 누적한다.
 *
 * 같은 브랜드 문자열이 여러 소스에서 나올 수 있다. 한 곳이라도 신뢰 출처면
 * trusted 로 승격한다 — first-seen 이 우연히 편집샵이라 영구 격리되는 것을 막는다.
 * 승격 시 platform 도 신뢰 출처로 바꿔 resolve 입력이 일관되게 한다.
 */
export function recordUnknownBrand(
  map: Map<string, UnknownBrandEntry>,
  brand: string,
  platform: string,
  trusted: boolean,
): void {
  const existing = map.get(brand)
  if (!existing) {
    map.set(brand, {platform, trusted})
    return
  }
  if (trusted && !existing.trusted) map.set(brand, {platform, trusted: true})
}

export function partitionUnknownBrands(map: Map<string, UnknownBrandEntry>): {
  insertable: Array<{raw: string; platform: string}>
  blocked: string[]
} {
  const insertable: Array<{raw: string; platform: string}> = []
  const blocked: string[] = []
  for (const [raw, entry] of map) {
    if (entry.trusted) insertable.push({raw, platform: entry.platform})
    else blocked.push(raw)
  }
  return {insertable, blocked}
}
