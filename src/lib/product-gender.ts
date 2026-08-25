/**
 * 상품 성별 추출 / 결의.
 *
 * 2026-08-03 크롤러 회귀. 2026-07-29 에 gender 를 VLM(product_features)으로
 * 이관했으나 성능이 나오지 않아 되돌린다. color 는 VLM 에 그대로 둔다.
 *
 * 회귀하면서 **브랜드 스코프 폴백은 복원하지 않았다** — 삭제 전에도 최하위
 * 근거였고 `['unisex']`·다중값은 이미 거부됐지만, 단일값이면서 틀린
 * brand_nodes.gender_scope(예: id=844 womenswear 인데 unisex) 가 상품으로
 * 조용히 전파되는 유일한 경로였다. 감사 도구도 수정 UI 도 없어 신뢰할 근거가
 * 못 된다. 근거 순위는 engine → url → text → config_default 4단이다.
 */
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
//
// `brand_scope` 는 write-path 에서 더 이상 생산하지 않지만(위 헤더 참조) 값은
// 남겨둔다 — 2026-07 이전 행들이 이 출처를 들고 있어 읽기 측이 파싱해야 한다.
// migration 095(products_gender_source_chk)의 allow-list 와 일치해야 한다.

export const GENDER_SOURCE_VALUES = [
  // write-path
  "engine",
  "url",
  "text",
  "config_default",
  // 읽기 전용 (과거 행)
  "brand_scope",
  "llm",
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
   * description 을 텍스트 추론에 포함할지. write-path 는 description 자체를
   * 더 이상 수집하지 않으므로 무의미하고, 교정 스크립트는 false 로 둬야 한다 —
   * products.description 은 마케팅/사이즈표 2000자 slice 라 "여성 사이즈 참고"
   * 같은 문구가 일회성 mass UPDATE 를 대량 오판시킨다.
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

export interface GenderResolutionOptions {
  /** kids 가드에서만 제거할 사이트별 캠페인명/색상명 노이즈. */
  kidsGenderNoisePatterns?: RegExp[]
  /** 공식 사이트에서 검증된 경우에만 config_default unisex를 허용한다. */
  verifiedUnisexDefault?: boolean
  /** 공식몰에서 검증한 사이트별 상품명/카테고리 성별 표기. */
  genderTextPatterns?: {men?: RegExp[]; women?: RegExp[]; unisex?: RegExp[]}
  /** 공식 Shopify 부서 태그의 사이트별 prefix. */
  genderDepartmentTagPrefixes?: {men: string[]; women: string[]; unisex?: string[]}
}

// ─── 규칙 ────────────────────────────────────────────────────────────────
//
// 한글 대안은 반드시 `\b()` 그룹 **밖**에 둔다 — \b 는 한글에 적용되지 않아
// /\b(men|남성)\b/ 는 "남성코트" 를 놓친다. matchesAny 가 raw 문자열에도
// contains 를 시도하므로 조합형 한글이 NFKD 로 자모 분해되는 문제도 함께 피한다.

// ─── 어휘를 늘릴 때의 규율 (2026-08-05) ──────────────────────────────────
//
// 토큰은 **대상 성별을 단정하는 것만** 넣는다. 스타일 묘사어와 고유명사는
// 넣지 않는다 — 확실한 것만 뽑고 모호하면 버리는 것이 이 모듈의 계약이다.
// 아래는 후보를 전 코퍼스(155,827행)에 돌려 실측한 결과다:
//
//   · `menswear`/`womenswear` — **거부.** 코퍼스에 600 / 1,006행으로 가장 많이
//     나오는 후보였지만 실측에서 탈락했다. 넣으면 jadedldn 6행을 되찾는 대신
//     mohawk-general 의 Tibi "Thomas Menswear Check Detached Shirt" 가
//     `["women"]` → `["men"]` 으로 **뒤집힌다**. 그 상품 태그는
//     `["woman","Women","Womens",…]` 로 명백한 여성복이고 "Thomas Menswear" 는
//     Tibi 의 스타일명이다 — "menswear-inspired" 는 여성복 관용어다.
//     URL 단에서만 쓰는 것도 안 된다: Shopify 의 `/products/<slug>` 는 상품명
//     그 자체라 `inferGenderFromUrl` 의 전제("카테고리 랜딩이 남긴 구조적
//     신호")가 성립하지 않는다. jadedldn 의 `-womenswear` 도 같은 slug 안에
//     있어 부서인지 스타일명인지 구분할 방법이 없다.
//     → 되찾을 6행은 어휘가 아니라 **사이트별 교정**으로 다뤄야 한다
//       (jadedldn 은 URL 규약이 확인된 단일 사이트다).
//   · `lady` 9행 — **거부.** 전부 고유명사였다: "Lady Lunetta" 가방,
//     "Kith **Kids** Lady Liberty Tee", "Lady Luck Tee". 아동복을 여성으로
//     만드는 경로까지 열린다.
//   · `masculine`/`feminine` — **거부.** 스타일 묘사어라 대상 성별이 아니다.
//   · `gentleman`/`hombres`/`hommes`/`uomini`/`femmes`/`donne`/`mujeres`/`맨즈`/
//     `all-gender` 류 — **넣지 않는다.** 코퍼스 0행이라 A/B 가 획득 0·상실 0·
//     뒤집힘 0 이었다. "위험이 없으니 미래 대비로" 는 위 두 항목을 실측으로
//     기각한 것과 같은 기준이 아니다 — 근거가 생기면 그때 A/B 하고 넣는다.
//   · `우먼즈`/`우먼스` 도 불필요하다 — `우먼` 이 contains 라 이미 걸린다.
//
// [HARD] 새 영문 토큰은 반드시 `patterns`(=`\b` 경계) 에 넣고 `contains` 에
//   넣지 말 것. `contains` 는 부분 문자열 판정이라 **"womenswear" 안에
//   "menswear" 가 들어 있다**(wo[menswear]). `"womens".includes("men")` 로
//   여성 상품 41.7% 가 남성 검색에 노출됐던 사고와 같은 계열이다.
//   교대(alternation)는 긴 것부터 적는다 — 백트래킹에 의존하지 않게.

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

/**
 * 텍스트에 특정 성별 토큰이 있는지. 교정 스크립트가 자체 정규식을 새로 쓰지
 * 않도록 공개한다 — GENDER_RULES 가 유일한 어휘 출처여야 한다.
 */
export function hasGenderToken(text: string, gender: ProductGender): boolean {
  const rule = GENDER_RULES.find((r) => r.gender === gender)
  return rule ? matchesAny(text, rule.patterns, rule.contains) : false
}

// kids 는 PRODUCT_GENDER_VALUES 에 없어서 cleanGenderScope 가 조용히 버린다
// (zara-engine 은 ["kids"] 를 반환한다). 그대로 두면 빈 배열 → 사이트 기본값으로
// 흘러 아동복이 성인 성별을 얻는 세탁 경로가 되므로, 성인 추론보다 먼저
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

/**
 * 텍스트에서 성별을 읽는다.
 *
 * 구체 성별(men/women)이 unisex 와 함께 잡히면 **구체 성별이 이긴다**.
 * unisex 는 "둘 다 해당"이라는 약한 주장이고 men/women 은 적극적 단언이라,
 * 둘이 같이 나오면 후자가 상품을 더 잘 설명한다. 실측 근거: sportyandrich 는
 * 전 상품에 사이트 공용 머천다이징 태그 "Unisex" 를 달아 두는데, 이걸
 * 우선하면 상품명이 "... Oxford Shirt Men" 이고 URL 도 `-men` 인 남성 상품이
 * unisex 로 접힌다. unisex 는 검색 RPC 에서 남녀 양쪽에 노출되므로 그 방향의
 * 오판이 정확히 이 프로젝트가 막으려는 세탁이다.
 *
 * men 과 women 이 **둘 다** 잡히면:
 *   - unisex 도 함께 있으면 unisex — "unisex, MALE, Female" 같은 태그는 상충이
 *     아니라 남녀공용을 명시한 것이다. 이건 추측이 아니라 근거다.
 *   - unisex 가 없으면 null(모호) — 근거 없이 양쪽 노출을 만들지 않는다.
 */
export function inferGenderFromText(text: string): ProductGender | null {
  const matches = GENDER_RULES.filter((rule) => matchesAny(text, rule.patterns, rule.contains)).map((rule) => rule.gender)
  const unique = [...new Set(matches)]
  const specific = unique.filter((g) => g !== "unisex")
  const hasUnisex = unique.includes("unisex")
  if (specific.length === 1) return specific[0]
  if (specific.length > 1) return hasUnisex ? "unisex" : null
  return hasUnisex ? "unisex" : null
}

export function isKidsText(text: string): boolean {
  return matchesAny(text, KIDS_RULE.patterns, KIDS_RULE.contains)
}

/**
 * 태그가 **사이트의 부서 분류로** 남녀 양쪽에 등록했는지.
 *
 * 편집샵은 같은 상품을 Men·Women 두 부서에 함께 올린다 — browns 의 스노부츠
 * `["Boots","Men","Rain Boots","Shoes","Women"]`, 032c 의 선글라스
 * `["accessories","men","mykita","women"]` 처럼. 이건 "모르겠음"이 아니라
 * **양쪽에서 판다는 적극적 근거**이고, gender-defaults.ts 헤더가 unisex 에
 * 요구하는 기준("사이트가 명시적으로 남녀공용을 표방할 때")을 만족한다.
 *
 * **태그만 본다.** 상품명·카테고리를 합친 문자열로 같은 판정을 하면 마케팅
 * 카피가 부서 분류로 둔갑한다 — 실측(mohawk-general): Tibi
 * "Thomas Menswear Check Detached Shirt" 는 태그가 여성 전용인데 상품명에
 * 남성 어휘가 들어 있다. 그 행이 unisex 가 되면 여성복이 남성 검색에 샌다.
 * 태그는 사이트가 스스로 붙인 분류 체계라 마케팅 문장과 성격이 다르다.
 *
 * 한쪽 성별만 잡히는 경우는 여기서 처리하지 않는다 — 일반 텍스트 추론이
 * 이미 같은 답을 내므로 중복 규칙을 만들지 않는다.
 */
export function inferDualDepartmentFromTags(tags: unknown): ProductGender | null {
  if (!Array.isArray(tags) || tags.length === 0) return null
  const blob = tags.filter((t): t is string => typeof t === "string" && t.length > 0).join(" ")
  if (!blob) return null
  return hasGenderToken(blob, "men") && hasGenderToken(blob, "women") ? "unisex" : null
}

/** 범용 사전에 넣기 위험한 사이트 고유 성별 표기를 좁게 판정한다. */
export function inferGenderFromSiteTextPatterns(
  text: string,
  patterns: GenderResolutionOptions["genderTextPatterns"],
): ProductGender | null {
  if (!patterns) return null
  const matches = (Object.entries(patterns) as Array<[ProductGender, RegExp[] | undefined]>)
    .filter(([, rules]) => (rules ?? []).some((rule) => {
      rule.lastIndex = 0
      return rule.test(text)
    }))
    .map(([gender]) => gender)
  const unique = [...new Set(matches)]
  if (unique.length === 1) return unique[0]
  return unique.includes("unisex") ? "unisex" : null
}

/** 사이트가 명시한 구조화 부서 태그 prefix로 상품 성별을 결의한다. */
export function inferGenderFromDepartmentTagPrefixes(
  tags: unknown,
  prefixes: {men: string[]; women: string[]; unisex?: string[]} | undefined,
): ProductGender | null {
  if (!Array.isArray(tags) || !prefixes) return null
  const values = tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.toLowerCase())
  const has = (candidates: string[]) => candidates.some((prefix) => {
    const normalized = prefix.toLowerCase()
    return values.some((tag) => tag.startsWith(normalized))
  })
  const men = has(prefixes.men)
  const women = has(prefixes.women)
  const unisex = has(prefixes.unisex ?? [])
  if (unisex || (men && women)) return "unisex"
  if (men) return "men"
  if (women) return "women"
  return null
}

/** 상품 설명의 명시적 모델 라벨만 읽는다. 양쪽 모델 착용은 확인된 unisex다. */
export function inferGenderFromModelDescription(value: unknown): ProductGender | null {
  if (typeof value !== "string" || !value) return null
  const text = value.replace(/<[^>]+>/g, " ")
  if (/\bunisex(?:\s+(?:fit|item|product))?\b/i.test(text) || /유니섹스|남녀\s*(?:공용|모두)/u.test(text)) {
    return "unisex"
  }
  const men = /\b(?:male|man)\s*(?:model\s*)?(?:[:(])/i.test(text)
    || /男性着用モデル|남성\s*모델/u.test(text)
  const women = /\b(?:female|woman)\s*(?:model\s*)?(?:[:(])/i.test(text)
    || /女性着用モデル|여성\s*모델/u.test(text)
  if (men && women) return "unisex"
  if (men) return "men"
  if (women) return "women"
  return null
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

function evidenceText(evidence: GenderEvidence): string {
  const parts = [evidence.name, evidence.category, evidence.subcategory, ...(evidence.tags ?? [])]
  if (evidence.useDescription) parts.push(evidence.description)
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ")
}

/**
 * 상품 단위 근거는 **단일값이어야 한다**. 2개 이상이면 근거로 쓰지 않고 버린다.
 *
 * products.gender 는 men/women/unisex 중 **하나**다 (migration 105 의
 * chk_products_gender_required, `cardinality(gender) = 1`). 검색 RPC 가
 * `p.gender && ARRAY[p_gender,'unisex']` 로 매칭하므로 `['men','women']` 은
 * unisex 와 똑같이 남녀 양쪽에 노출된다 — 실제로는 "남녀공용 확인됨"이 아니라
 * "판정 실패"인데 검색 결과에서는 구별되지 않는다. 실측(2026-08-05): 16,468행이
 * 이 상태였고 그중 8,757행이 browns 한 사이트였다.
 *
 * 버린 뒤에 미확인으로 끝내지 않고 URL → 텍스트 → 사이트 기본값으로 계속
 * 내려간다. 엔진이 모호했다는 사실이 URL 경로 근거까지 무효로 만들지는 않는다.
 */
function singleEvidence(gender: ProductGender[]): ProductGender[] {
  return gender.length === 1 ? gender : []
}

/**
 * 상품 성별 결의. 우선순위:
 *
 *   1. 엔진이 뽑은 상품 성별 men/women (카테고리 유래 등 상품 단위 근거, 단일값만).
 *      엔진 unisex 는 약한 주장이라 3·4 가 men/women 을 명시하면 양보하고,
 *      그런 신호가 없을 때만 확정된다 (6 위, config_default 바로 위).
 *   2. kids 가드 (성인 토큰 없이 아동 신호만 있으면 미확인)
 *   3. URL 경로
 *   4. 상품명/카테고리/태그 텍스트
 *      4b. 4 가 men·women 동시 검출로 모호하면, **태그만** 다시 봐서 사이트가
 *          두 부서에 함께 올린 상품인지 판정한다 → unisex
 *   5. 3·4 가 서로 다르면 미확인 (추측하지 않음)
 *   6. 사이트 전역 defaultGender (productGenderSource === "config_default")
 *   7. 미확인 — 호출자가 적재에서 제외한다
 */
export function resolveProductGenderWithSource(
  productGender: unknown,
  evidence: GenderEvidence = {},
  productGenderSource: GenderSource = "engine",
  options: GenderResolutionOptions = {},
): GenderResolution {
  const fromProduct = singleEvidence(cleanGenderScope(productGender))

  // 사이트 전역 defaultGender 는 상품 단위 근거가 아니라 설정상의 기본값이다.
  // 카테고리가 교차하는 사이트(예: yearsago — 여성 라인 상품이 "상의"에도 함께
  // 걸린다)에서는 같은 상품의 다른 행이 카테고리 유래 성별을 들고 오므로,
  // 전역 기본값은 URL/텍스트 추론보다 **아래**에서만 쓰여야 한다. 그러지 않으면
  // dedup merge 에서 동순위 충돌이 나 ['men','women'] union 이 만들어진다.
  const isConfigDefault = productGenderSource === "config_default"

  // 엔진이 뽑은 men/women 은 상품 단위 단언이므로 그대로 확정한다.
  //
  // unisex 만 예외다 (2026-08-25). 엔진 unisex 의 실제 출처는 대부분
  // `SiteConfig.category.categories[].gender` 인데, 성별 부서가 없는 편집샵을
  // 온보딩할 때 "성별 구분이 없다"를 unisex 로 적어 버린 경우가 섞여 있다.
  // 그건 "남녀공용 확인됨"이 아니라 "모름"이고, 아래 config_default 분기가
  // 전역 `defaultGender: ["unisex"]` 를 바로 그 이유로 버린다 — 같은 값을
  // 카테고리에 적었다고 통과시키면 앞뒤가 맞지 않는다.
  // 그래서 엔진 unisex 는 URL·상품명이 men/women 을 명시하면 양보한다.
  // URL↔텍스트 병합에서 이미 쓰는 "구체가 unisex 를 이긴다" 규율 그대로다.
  // 실측(2026-08-25): etcseoul 이 10개 카테고리를 전부 unisex 로 적어
  // `킨_ MEN'S JASPER [SILVER MINK]` 가 여성 검색에 노출됐다. 전 코퍼스에서
  // 이 규칙이 뒤집는 행은 10개 플랫폼 267행이다.
  const engineGender = !isConfigDefault && fromProduct.length === 1 ? fromProduct[0]! : null
  if (engineGender !== null && engineGender !== "unisex") {
    return {gender: fromProduct, source: productGenderSource}
  }

  const text = evidenceText(evidence)
  const url = typeof evidence.productUrl === "string" ? evidence.productUrl : ""

  const rawFromText = text
    ? inferGenderFromSiteTextPatterns(text, options.genderTextPatterns) ?? inferGenderFromText(text)
    : null
  const fromUrl = inferGenderFromUrl(url)

  // kids 가드는 태그 부서 분류보다 **먼저** 본다. 순서를 뒤집으면
  // `["Kids","Men","Women"]` 같은 태그가 아동복에 성인 성별(unisex)을 주고,
  // unisex 는 검색에서 남녀 양쪽에 노출되므로 정확히 이 모듈이 막으려는 세탁이 된다.
  const stripKidsNoise = (value: string) => options.kidsGenderNoisePatterns?.reduce(
    (cleaned, pattern) => cleaned.replace(pattern, " "),
    value,
  ) ?? value
  //
  // 엔진이 unisex 를 준 행은 이 가드를 타지 않는다 — 아래에서 엔진 값으로
  // 확정되므로 기존 동작이 그대로 보존된다. 엔진 unisex 에 대한 이번 변경은
  // "구체 신호가 있을 때만 양보" 하나로 좁혀 둔다.
  if (
    engineGender === null
    && rawFromText === null
    && fromUrl === null
    && (isKidsText(stripKidsNoise(text)) || isKidsText(stripKidsNoise(url)))
  ) {
    return {gender: [], source: null}
  }

  // 일반 텍스트가 men·women 동시 검출로 모호해졌을 때만 태그 부서 분류를 본다.
  // 편집샵이 두 부서에 함께 올린 상품은 "판정 실패"가 아니라 "확인된 남녀공용"이다
  // (inferDualDepartmentFromTags 헤더 참조). 텍스트가 이미 한쪽으로 확정됐으면
  // 건드리지 않는다 — 구체 성별이 unisex 를 이기는 기존 규율 그대로다.
  const fromText = rawFromText
    ?? inferGenderFromDepartmentTagPrefixes(evidence.tags, options.genderDepartmentTagPrefixes)
    ?? inferDualDepartmentFromTags(evidence.tags)

  // URL 과 텍스트가 어긋나는 경우.
  //
  // 한쪽이 unisex 이면 상충이 아니다 — unisex 는 "둘 다"라는 약한 주장이고
  // men/women 은 적극적 단언이므로 구체 쪽을 택한다 (inferGenderFromText 의
  // 규율과 동일). 실측(jadedldn): URL 이 `.../top-women` 인데 사이트가 전 상품에
  // 붙이는 blanket "unisex" 태그 때문에 텍스트가 unisex 로 나와 충돌 처리됐고,
  // 그 결과 명백한 여성 상품이 미확인으로 떨어졌다.
  //
  // men vs women 만 진짜 상충이다 — 추측하지 않고 미확인으로 남긴다.
  if (fromUrl !== null && fromText !== null && fromUrl !== fromText) {
    if (fromUrl === "unisex") return {gender: [fromText], source: "text"}
    if (fromText === "unisex") return {gender: [fromUrl], source: "url"}
    // 엔진 unisex 가 있어도 상충을 덮지 않는다 — 그 값 자체가 "모름"이라
    // 두 근거 중 어느 쪽을 지지하는 증거가 못 된다.
    if (engineGender !== null) return {gender: [engineGender], source: productGenderSource}
    return {gender: [], source: null, conflict: {url: fromUrl, text: fromText}}
  }
  // 구체 신호(men/women)만 엔진 unisex 를 이긴다. 양쪽 다 unisex 이거나
  // 신호가 없으면 아래에서 엔진 값으로 확정된다.
  if (fromUrl !== null && fromUrl !== "unisex") return {gender: [fromUrl], source: "url"}
  if (fromText !== null && fromText !== "unisex") return {gender: [fromText], source: "text"}
  if (engineGender !== null) return {gender: [engineGender], source: productGenderSource}
  if (fromUrl !== null) return {gender: [fromUrl], source: "url"}
  if (fromText !== null) return {gender: [fromText], source: "text"}

  // 상품 단위 근거가 없을 때만 사이트 전역 기본값을 쓴다. 단, unisex 는
  // "성별을 모름"의 대체값이 아니다. 혼성 브랜드/편집샵의 전역 unisex 기본값을
  // 상품 근거 없이 저장하면 검색에서 남녀 양쪽에 노출되는 세탁 버그가 재발한다.
  // 단일 성별로 검증된 men/women 기본값만 최후 fallback 으로 허용한다.
  if (fromProduct.length > 0 && isConfigDefault) {
    return fromProduct.length === 1 && (
      fromProduct[0] !== "unisex" || options.verifiedUnisexDefault === true
    )
      ? {gender: fromProduct, source: "config_default"}
      : {gender: [], source: null}
  }

  return {gender: [], source: null}
}

/** 기존 호출부 호환 wrapper — 성별 배열만 필요한 경우. */
export function resolveProductGender(productGender: unknown, evidence: GenderEvidence = {}): ProductGender[] {
  return resolveProductGenderWithSource(productGender, evidence).gender
}
