import {matchesAny, normalizeForMatch} from "./text-match"

export const PRODUCT_GENDER_VALUES = ["men", "women", "unisex"] as const

const PRODUCT_GENDER_SET = new Set<string>(PRODUCT_GENDER_VALUES)

export type ProductGender = (typeof PRODUCT_GENDER_VALUES)[number]

export function cleanGenderScope(value: unknown): ProductGender[] {
  if (!Array.isArray(value)) return []

  const out: ProductGender[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const gender = item.trim().toLowerCase()
    if (!PRODUCT_GENDER_SET.has(gender)) continue
    if (!out.includes(gender as ProductGender)) out.push(gender as ProductGender)
  }
  return out
}

// ─── provenance ──────────────────────────────────────────────────────────
//
// `unisex` 는 "남녀 공용임이 확인됨" 이어야 하고 "모르겠음" 이어서는 안 된다.
// 검색 RPC(search_products_v6)가 `p.gender && ARRAY[p_gender,'unisex']` 로
// unisex 상품을 남성·여성 양쪽 결과에 항상 노출시키기 때문에, 미확인을 unisex
// 로 적재하면 여성 상품이 남성 검색 결과로 새어 나간다. gender 가 어디서
// 왔는지를 products.gender_source 에 남겨 이 구분을 사후에도 검증 가능하게 한다.

export const GENDER_SOURCE_VALUES = [
  // write-path
  "engine",
  "url",
  "text",
  "config_default",
  "brand_scope",
  // 093 이전 행 / 교정 스크립트
  "legacy_backfill",
  "repair_url",
  "repair_text",
  "repair_brand_scope",
  "unverified_legacy",
] as const

export type GenderSource = (typeof GENDER_SOURCE_VALUES)[number]

export interface GenderEvidence {
  name?: string | null
  category?: string | null
  subcategory?: string | null
  description?: string | null
  tags?: string[] | null
  productUrl?: string | null
  /**
   * description 을 텍스트 추론에 포함할지. write-path 는 true(재크롤로 재검증
   * 가능), 교정 스크립트는 false — products.description 은 마케팅/사이즈표
   * 2000자 slice 라 "여성 사이즈 참고" 같은 문구가 일회성 mass UPDATE 를
   * 대량 오판시킨다.
   */
  useDescription?: boolean
}

export interface GenderResolution {
  /** 빈 배열 = 미확인. 호출자는 적재에서 제외한다. */
  gender: ProductGender[]
  /** 미확인이면 null. */
  source: GenderSource | null
  /** URL 신호와 텍스트 신호가 어긋난 경우 — 추측하지 않고 미확인으로 떨어뜨린다. */
  conflict?: {url: ProductGender; text: ProductGender}
}

// ─── 규칙 ────────────────────────────────────────────────────────────────
//
// 한글 대안은 반드시 `\b()` 그룹 **밖**에 둔다 — \b 는 한글에 적용되지 않아
// /\b(men|남성)\b/ 는 "남성코트" 를 놓친다 (crawler/CLAUDE.md 색상 정규화 항목의
// 동일 규칙). matchesAny 가 raw 문자열에도 contains 를 시도하므로 조합형 한글이
// NFKD 로 자모 분해되는 문제도 함께 피한다.

export const GENDER_RULES: Array<{gender: ProductGender; patterns: RegExp[]; contains?: string[]}> = [
  {
    gender: "men",
    patterns: [/\b(men|mens|men's|man|male|hombre|homme|uomo|herren)\b/i],
    contains: ["남성", "남자", "남자용", "멘즈"],
  },
  {
    gender: "women",
    patterns: [/\b(women|womens|women's|woman|female|mujer|femme|donna|damen|ladies)\b/i],
    contains: ["여성", "여자", "여자용", "우먼", "레이디스"],
  },
  {
    gender: "unisex",
    patterns: [/\b(unisex|genderless|gender[-\s]?free)\b/i],
    contains: ["남녀공용", "공용", "유니섹스"],
  },
]

// kids 는 PRODUCT_GENDER_VALUES 에 없어서 cleanGenderScope 가 조용히 버린다
// (zara-engine 은 ["kids"] 를 반환한다). 그대로 두면 빈 배열 → 브랜드 폴백으로
// 흘러 아동복이 성인 성별을 얻는 제2의 세탁 경로가 되므로, 성인 추론보다 먼저
// 걸러 미확인으로 떨어뜨린다.
const KIDS_RULE = {
  patterns: [
    /\b(kids?|kid's|child|children|childrens|boys?|boy's|girls?|girl's|baby|infant|toddler|junior|nino|nina|enfant|bambino)\b/i,
  ],
  contains: ["키즈", "아동", "유아", "주니어", "베이비", "어린이"],
}

export function normalizeGenderToken(raw: string): ProductGender | null {
  for (const rule of GENDER_RULES) {
    if (matchesAny(raw, rule.patterns, rule.contains)) return rule.gender
  }
  return null
}

export function inferGenderFromText(text: string): ProductGender | null {
  const matches = GENDER_RULES.filter((rule) => matchesAny(text, rule.patterns, rule.contains)).map((rule) => rule.gender)
  const unique = [...new Set(matches)]
  if (unique.includes("unisex")) return "unisex"
  return unique.length === 1 ? unique[0] : null
}

export function isKidsText(text: string): boolean {
  return matchesAny(text, KIDS_RULE.patterns, KIDS_RULE.contains)
}

/**
 * URL 경로에서 성별을 읽는다. 크롤러가 실제로 진입한 카테고리 랜딩이 남긴
 * 구조적 신호라 상품명(마케팅 카피)보다 신뢰도가 높다.
 *
 * hostname 은 절대 보지 않는다 — `hommes.kr` 같은 도메인이 전 상품을 남성으로
 * 만들어 버린다. 서로 다른 성별이 2개 이상 잡히면 null (inferGenderFromText 의
 * `unique.length === 1` 규율과 동일).
 */
export function inferGenderFromUrl(url: unknown): ProductGender | null {
  if (typeof url !== "string" || !url.trim()) return null

  let target = url
  try {
    const parsed = new URL(url)
    target = `${parsed.pathname}${parsed.search}`
  } catch {
    // 상대 경로 등 URL 파싱 불가 — raw 문자열을 그대로 쓴다. 이 경우에도
    // 스킴/호스트가 없으므로 hostname 오염 위험은 없다.
  }

  try {
    target = decodeURIComponent(target)
  } catch {
    // malformed percent-encoding (URIError) — 디코딩 전 문자열로 진행.
  }

  const normalized = normalizeForMatch(target)
  const matches = GENDER_RULES.filter((rule) => matchesAny(normalized, rule.patterns, rule.contains)).map((r) => r.gender)
  const unique = [...new Set(matches)]
  return unique.length === 1 ? unique[0] : null
}

/**
 * 브랜드 스코프를 상품 성별로 쓸 수 있는가.
 *
 * `['men']` / `['women']` 은 "이 브랜드는 남성복만 판다" 는 카탈로그 사실이라
 * 개별 상품에 대한 유효한 추론이다. `['unisex']`, `['men','women']` 은 개별
 * 상품에 대해 아무것도 말해주지 않는다 — 브랜드 스코프는 카탈로그 경계이지
 * 상품 속성이 아니다.
 */
export function isSingleGenderScope(scope: ProductGender[]): boolean {
  return scope.length === 1 && scope[0] !== "unisex"
}

function evidenceText(evidence: GenderEvidence): string {
  const parts = [evidence.name, evidence.category, evidence.subcategory, ...(evidence.tags ?? [])]
  if (evidence.useDescription) parts.push(evidence.description)
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ")
}

/**
 * 상품 성별 결의. 우선순위:
 *
 *   1. 엔진이 뽑은 상품 성별 (카테고리 유래 등 상품 단위 근거)
 *   2. kids 가드 (성인 토큰 없이 아동 신호만 있으면 미확인)
 *   3. URL 경로
 *   4. 상품명/카테고리/태그 텍스트
 *   5. 3·4 가 서로 다르면 미확인 (추측하지 않음)
 *   6. 사이트 전역 defaultGender (productGenderSource === "config_default")
 *   7. 브랜드 gender_scope — 단, 단일 성별일 때만
 *   8. 미확인
 */
export function resolveProductGenderWithSource(
  productGender: unknown,
  brandGenderScope: unknown,
  evidence: GenderEvidence = {},
  productGenderSource: GenderSource = "engine",
): GenderResolution {
  const fromProduct = cleanGenderScope(productGender)

  // 사이트 전역 defaultGender 는 상품 단위 근거가 아니라 설정상의 기본값이다.
  // 카테고리가 교차하는 사이트(예: yearsago — 여성 라인 상품이 "상의"에도 함께
  // 걸린다)에서는 같은 상품의 다른 행이 카테고리 유래 성별을 들고 오므로,
  // 전역 기본값은 URL/텍스트 추론보다 **아래**에서만 쓰여야 한다. 그러지 않으면
  // dedup merge 에서 동순위 충돌이 나 ['men','women'] union 이 만들어진다.
  const isConfigDefault = productGenderSource === "config_default"
  if (fromProduct.length > 0 && !isConfigDefault) {
    return {gender: fromProduct, source: productGenderSource}
  }

  const text = evidenceText(evidence)
  const url = typeof evidence.productUrl === "string" ? evidence.productUrl : ""

  const fromText = text ? inferGenderFromText(text) : null
  const fromUrl = inferGenderFromUrl(url)

  if (fromText === null && fromUrl === null && (isKidsText(text) || isKidsText(url))) {
    return {gender: [], source: null}
  }

  if (fromUrl !== null && fromText !== null && fromUrl !== fromText) {
    return {gender: [], source: null, conflict: {url: fromUrl, text: fromText}}
  }
  if (fromUrl !== null) return {gender: [fromUrl], source: "url"}
  if (fromText !== null) return {gender: [fromText], source: "text"}

  // 상품 단위 근거가 없을 때만 사이트 전역 기본값을 쓴다.
  if (fromProduct.length > 0 && isConfigDefault) return {gender: fromProduct, source: "config_default"}

  const scope = cleanGenderScope(brandGenderScope)
  if (isSingleGenderScope(scope)) return {gender: scope, source: "brand_scope"}

  return {gender: [], source: null}
}

/** 기존 호출부 호환 wrapper — 성별 배열만 필요한 경우. */
export function resolveProductGender(
  productGender: unknown,
  brandGenderScope: unknown,
  evidence: GenderEvidence = {},
): ProductGender[] {
  return resolveProductGenderWithSource(productGender, brandGenderScope, evidence).gender
}
