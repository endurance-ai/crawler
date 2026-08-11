import {CATEGORIES, isValidCategory, type Category} from "../enums/product-enums"
import {emit} from "../core/observability"
import {resolveSubcategory} from "../subcategory-classifier"
import {matchesAny, normalizeForMatch} from "../text-match"
import {normalizeGenderToken, resolveProductGenderWithSource, type GenderSource} from "../product-gender"

export type ProductQcAction = "keep" | "auto_fix" | "review" | "reject"

export interface ProductQcFieldChange {
  field: "category" | "subcategory" | "gender"
  before: unknown
  after: unknown
  reason: string
  confidence: number
}

export interface ProductQcInput {
  name: string
  category?: string | null
  subcategory?: string | null
  gender?: string[] | null
  /**
   * gender 의 출처. QC 가 gender 를 바꾸면 이 값도 함께 갱신해야 한다 —
   * 갱신하지 않으면 provenance 가 거짓이 되고, import 결의가 그 라벨을 보고
   * 다른 분기를 타 실제와 어긋난 판정을 낸다 (실측: jadedldn 18건).
   */
  genderSource?: string | null
  tags?: string[] | null
  productUrl?: string | null
  productCode?: string | null
}

/**
 * QC 는 성격이 다른 두 가지를 한다:
 *
 *   ① 계약 강제 — 출력을 canonical 어휘(CATEGORIES/SUBCATEGORIES)로 제한한다.
 *      출처가 무엇이든 필요하다. category 는 NOT NULL 이고 검색 필터가 이 값을 쓴다.
 *   ② 이름 기반 추론·번복 — 상품명 정규식으로 추론해 입력 category 를 갈아치운다.
 *      **DOM 스크래핑 원본을 상대하라고 만든 구제 수단이다.** 원본 category 에는
 *      "SALE"/"NEW"/"하의"/할인율 배너 같은 내비 텍스트가 들어오므로, 그럴 때
 *      상품명 추론이 명백한 개선이었다.
 *
 * QC 게이트(2026-07-07)가 LLM 보강(2026-07-26)보다 3주 먼저 생겼다. 후보 워커가
 * 그 앞에 LLM 을 붙이면서 ②가 **페이지 전체를 본 판단을 정규식 한 줄로 뒤집는**
 * 구조가 됐다 — 실측 사고: "Archive Short Sleeves"(반팔티)를 LLM 이 tops 로
 * 냈는데 ②가 bottoms 로 번복해 후보가 탈락했다.
 *
 * `trustedCategory` 는 그 경우 ②만 끈다. ①은 그대로 돈다 — LLM 이 z.enum 으로
 * 강제돼도 subcategory 는 freeform 이고, canonical 계약은 여전히 지켜야 한다.
 */
export interface ProductQcOptions {
  /** 입력 category 가 신뢰 가능한 출처(LLM 보강)에서 왔는가. 기본 false. */
  trustedCategory?: boolean
  /** kids 가드에서만 제거할 사이트별 캠페인명/색상명 노이즈. */
  kidsGenderNoisePatterns?: RegExp[]
  /** 공식 사이트에서 검증된 경우에만 config_default unisex를 허용한다. */
  verifiedUnisexDefault?: boolean
}

export interface ProductQcResult<T extends ProductQcInput = ProductQcInput> {
  action: ProductQcAction
  product: T
  changes: ProductQcFieldChange[]
  reasons: string[]
  confidence: number
}

export interface ProductQcStats {
  total: number
  kept: number
  autoFixed: number
  review: number
  rejected: number
  byReason: Record<string, number>
  samples: Record<string, string[]>
}

const qcReport = new Map<string, ProductQcStats>()

const CATEGORY_ALIASES: Array<{category: Category; patterns: RegExp[]; contains?: string[]}> = [
  {
    category: "outerwear",
    patterns: [/\b(coat|jacket|blazer|parka|anorak|windbreaker|bomber|trench|overcoat|outerwear)\b/i],
    contains: ["\uc544\uc6b0\ud130", "\ucf54\ud2b8", "\uc7ac\ud0b7", "\uc790\ucf13", "\ube14\ub808\uc774\uc800", "\ud30c\uce74", "\uc810\ud37c", "\uc57c\uc0c1"],
  },
  {
    category: "knitwear",
    patterns: [/\b(knit|knitwear|sweater|cardigan|pullover|turtleneck)\b/i],
    contains: ["\ub2c8\ud2b8", "\uc2a4\uc6e8\ud130", "\uac00\ub514\uac74", "\uce74\ub514\uac74", "\ud130\ud2c0\ub125", "\ub2c8\ud2b8\uc6e8\uc5b4"],
  },
  {
    category: "tops",
    patterns: [/\b(t[-\s]?shirts?|tee|shirt|blouse|polo|hoodie|sweatshirt|tanks?|tank[-\s]?top|crop[-\s]?top|henley|camisole)\b/i],
    contains: ["\uc0c1\uc758", "\ud2f0\uc154\uce20", "\uc154\uce20", "\ube14\ub77c\uc6b0\uc2a4", "\ud6c4\ub4dc", "\ub9e8\ud22c\ub9e8", "\ub098\uc2dc", "\ud0f1\ud06c\ud0d1"],
  },
  {
    category: "bottoms",
    // `shorts?` 의 `s?` 는 의도적이다 — "Logo Biker Short" / "DOUBLE KNEE SHORT"
    // 처럼 홑단어 Short 를 명사로 쓰는 상품명이 실제로 더 많다(실측: 1,170 vs 304).
    // 다만 그 때문에 "Short Sleeve"(반팔=tops)가 bottoms 로 잡히는 오탐이 생겼다.
    // 부정 전방탐색으로 그 한 갈래만 뺀다 — "Short Sleeve Shorts" 는 뒤쪽
    // "Shorts" 에서 여전히 매치된다.
    patterns: [/\b(pants?|trousers?|jeans|denim|shorts?(?![ -]?sleeve)|skirt|joggers?|leggings|chinos?|culottes|sweatpants|cargo)\b/i],
    contains: ["\ud558\uc758", "\ud32c\uce20", "\ubc14\uc9c0", "\ub370\ub2d8", "\uc9c4", "\uc1fc\uce20", "\uc2a4\ucee4\ud2b8", "\uce58\ub9c8", "\uc2ac\ub799\uc2a4", "\uc870\uac70"],
  },
  {
    category: "dresses",
    patterns: [/\b(dress|robe|vestido|abito|one[-\s]?piece|jumpsuit|romper)\b/i],
    contains: ["\ub4dc\ub808\uc2a4", "\uc6d0\ud53c\uc2a4", "\uc810\ud504\uc218\ud2b8"],
  },
  {
    category: "shoes",
    patterns: [/\b(shoes?|sneakers?|boots?|loafers?|sandals?|mules?|heels?|flats?|slides?|derby|oxford|footwear)\b/i],
    contains: ["\uc2e0\ubc1c", "\uc2a4\ub2c8\ucee4\uc988", "\ubd80\uce20", "\ub85c\ud37c", "\uc0cc\ub4e4", "\uad6c\ub450", "\ud790", "\uc288\uc988"],
  },
  {
    category: "bags",
    patterns: [/\b(bag|tote|backpack|crossbody|clutch|shoulder\s*bag|messenger|bucket\s*bag)\b/i],
    contains: ["\uac00\ubc29", "\ud1a0\ud2b8", "\ubc31\ud329", "\ud074\ub7ec\uce58", "\uc204\ub354\ubc31", "\ud06c\ub85c\uc2a4\ubc31", "\uc5d0\ucf54\ubc31"],
  },
  {
    category: "eyewear",
    patterns: [/\b(sunglasses|glasses|eyewear|goggles)\b/i],
    contains: ["\uc120\uae00\ub77c\uc2a4", "\uc548\uacbd", "\uc544\uc774\uc6e8\uc5b4", "\uace0\uae00"],
  },
  {
    category: "jewelry",
    patterns: [/\b(necklace|bracelet|ring|earrings?|jewelry|jewellery|pendant|anklet)\b/i],
    contains: ["\ubaa9\uac78\uc774", "\ud314\ucc0c", "\ubc18\uc9c0", "\uadc0\uac78\uc774", "\uc8fc\uc5bc\ub9ac", "\uc96c\uc5bc\ub9ac", "\ud39c\ub358\ud2b8"],
  },
  {
    category: "headwear",
    patterns: [/\b(hat|cap|beanie|beret|bucket\s*hat)\b/i],
    contains: ["\ubaa8\uc790", "\ube44\ub2c8", "\ubca0\ub808", "\ubc84\ud0b7\ud587"],
  },
  {
    category: "accessories",
    patterns: [/\b(scarf|belt|watch|tie(?![-\s]?dye)|gloves|socks|wallet|muffler)\b/i],
    contains: ["\uc2a4\uce74\ud504", "\ubca8\ud2b8", "\uc2dc\uacc4", "\ub125\ud0c0\uc774", "\uc7a5\uac11", "\uc591\ub9d0", "\uc9c0\uac11", "\uba38\ud50c\ub7ec"],
  },
  {
    category: "underwear",
    patterns: [/\b(underwear|briefs|boxers?|bra|lingerie|panties)\b/i],
    contains: ["\uc18d\uc637", "\ube0c\ub77c", "\ud32c\ud2f0", "\uc5b8\ub354\uc6e8\uc5b4", "\ub780\uc81c\ub9ac"],
  },
  {
    category: "swimwear",
    patterns: [/\b(swimsuit|bikini|swimwear|trunks|rashguard)\b/i],
    contains: ["\uc218\uc601\ubcf5", "\ube44\ud0a4\ub2c8", "\ub798\uc2dc\uac00\ub4dc", "\uc2a4\uc714"],
  },
  {
    category: "activewear",
    patterns: [/\b(activewear|tracksuit|sportswear|sports[-\s]?bra|athletic|yoga)\b/i],
    contains: ["\ud2b8\ub808\uc774\ub2dd", "\uc6b4\ub3d9\ubcf5", "\uc694\uac00", "\uc561\ud2f0\ube0c\uc6e8\uc5b4", "\uc2a4\ud3ec\uce20"],
  },
]

// Compound product names can match multiple broad aliases (for example,
// "Shirt Jacket" matches both tops and outerwear). Resolve only the phrases
// whose merchandising family is sufficiently explicit before the generic
// single-match gate below.
const CATEGORY_PRIORITY_ALIASES: Array<{category: Category; patterns: RegExp[]}> = [
  {
    category: "swimwear",
    patterns: [/\b(?:swimming|swim)\s+caps?\b/i],
  },
  {
    category: "knitwear",
    patterns: [
      /\b(shrug|cowichan)\b/i,
      /\bknit(?:ted)?\b.*\b(top|sleeveless|hoodie|jacket|vest)\b/i,
      /\b(top|sleeveless|hoodie|jacket|vest)\b.*\bknit(?:ted)?\b/i,
    ],
  },
  {
    category: "dresses",
    patterns: [/\b(top|shirt|hoodie)\s+dress\b/i],
  },
  {
    category: "outerwear",
    patterns: [
      /\b(jackets?|coats?|bombers?|puffers?|vests?)\b/i,
      /\bjersey[-\s]?jacket\b/i,
      /\bshirt[-\s]?jacket\b/i,
      /\bblouson\b/i,
      /\btrucker\b/i,
      /\binsulated\s+vest\b/i,
      /\b(short\s+)?down\s+jacket\b/i,
      /\b(fuzzy|hood(?:ed)?)\s+jumper\b/i,
      /\bbolero\b/i,
    ],
  },
  {
    category: "bags",
    patterns: [
      /\beastpak\s*[x×]\b/i,
      /\b(rucksack|pouch|xpack|pak['’]?r|hobo)\b/i,
      /\b(wallet|belt)\s+bag\b/i,
      /\bpillow\s+handle(?:\s+mini)?\b/i,
      /\b(?:swim\s+)?knit\s+bags?\b/i,
    ],
  },
  {
    category: "bottoms",
    patterns: [/\b(sweatpants?|jeans?|bootcut|tights?)\b/i],
  },
  {
    category: "tops",
    patterns: [
      /\bjersey\b/i,
      /\blong[-\s]?sleeve\b/i,
      /\bhood(?:ed)?\s+zip[-\s]?up\b/i,
      /\b(top|sleeveless)\b/i,
    ],
  },
  {
    category: "shoes",
    patterns: [/\b(short\s+boots?|trainers?|flip[-\s]?flops?|mary\s+jane)\b/i],
  },
  {
    category: "headwear",
    patterns: [
      /\btie[-\s]?down\s+cap\b/i,
      /\b(?:shell\s+)?knit\s+(?:cowboy\s+)?(?:bucket\s+)?(?:hat|cap|beanie)s?\b/i,
    ],
  },
  {
    category: "jewelry",
    patterns: [/\b(necklace|bracelet|rings?|earrings?|earcuffs?|bangles?)\b/i],
  },
  {
    category: "accessories",
    patterns: [
      /\bhair[-\s]?(pin|band)\b/i,
      /\bhood(?:ie|ed)?\s+scarf\b/i,
      /\b(?:arm|leg|mitten)\s+warmers?\b/i,
      /\bkeychains?\b/i,
      /\bkeyrings?\b/i,
      /\bscrunchies?\b/i,
    ],
  },
  {
    category: "underwear",
    patterns: [/\bbralettes?\b/i],
  },
  {
    category: "dresses",
    patterns: [/\b(dotty|hoody)suit\b/i],
  },
]

function inferPriorityCategoryFromText(text: string): Category | null {
  const normalized = normalizeForMatch(text)
  for (const entry of CATEGORY_PRIORITY_ALIASES) {
    if (entry.patterns.some((pattern) => pattern.test(text) || pattern.test(normalized))) return entry.category
  }
  return null
}

// Raw category string \u2192 family. Includes legacy capitalized DB values
// (Outer/Top/\u2026 lowercased by normalizeForMatch) so values passing through QC are
// canonicalized to the new taxonomy. Ambiguous legacy splits default to the most
// common family (Top\u2192tops, Accessories\u2192accessories); name inference above and the
// LLM re-classification pass resolve the finer split.
const CATEGORY_COMPAT: Record<string, Category> = {
  // legacy capitalized DB values
  outer: "outerwear",
  top: "tops",
  bottom: "bottoms",
  bag: "bags",
  dress: "dresses",
  // outerwear synonyms
  outerwear: "outerwear",
  jacket: "outerwear",
  jackets: "outerwear",
  coat: "outerwear",
  coats: "outerwear",
  blazer: "outerwear",
  // knitwear synonyms
  knit: "knitwear",
  knits: "knitwear",
  knitwear: "knitwear",
  sweater: "knitwear",
  cardigan: "knitwear",
  pullover: "knitwear",
  // tops synonyms
  tops: "tops",
  shirt: "tops",
  shirts: "tops",
  tee: "tops",
  tshirt: "tops",
  blouse: "tops",
  hoodie: "tops",
  sweatshirt: "tops",
  // bottoms synonyms
  bottoms: "bottoms",
  pants: "bottoms",
  trousers: "bottoms",
  jeans: "bottoms",
  denim: "bottoms",
  skirt: "bottoms",
  shorts: "bottoms",
  leggings: "bottoms",
  // dresses synonyms
  dresses: "dresses",
  onepiece: "dresses",
  jumpsuit: "dresses",
  // shoes synonyms
  shoes: "shoes",
  shoe: "shoes",
  footwear: "shoes",
  sneakers: "shoes",
  boots: "shoes",
  // bags synonyms
  bags: "bags",
  // accessories & split families
  accessories: "accessories",
  accessory: "accessories",
  eyewear: "eyewear",
  sunglasses: "eyewear",
  glasses: "eyewear",
  jewelry: "jewelry",
  jewellery: "jewelry",
  necklace: "jewelry",
  necklaces: "jewelry",
  bracelet: "jewelry",
  bracelets: "jewelry",
  ring: "jewelry",
  rings: "jewelry",
  earring: "jewelry",
  earrings: "jewelry",
  earcuff: "jewelry",
  earcuffs: "jewelry",
  bangle: "jewelry",
  bangles: "jewelry",
  headwear: "headwear",
  hat: "headwear",
  cap: "headwear",
  beanie: "headwear",
  // intimates & sport
  underwear: "underwear",
  lingerie: "underwear",
  swimwear: "swimwear",
  swimsuit: "swimwear",
  bikini: "swimwear",
  "let's swim": "swimwear",
  "lets swim": "swimwear",
  activewear: "activewear",
  sportswear: "activewear",
  // passthrough
  other: "other",
}

function isQcEnabled(): boolean {
  const v = process.env.CRAWLER_QC_NORMALIZATION_ENABLED
  if (v === undefined || v === "") return true
  return v.toLowerCase() !== "false"
}

function skuOf(product: ProductQcInput): string {
  return product.productUrl || product.productCode || product.name || ""
}

function record(site: string, result: ProductQcResult): void {
  let stat = qcReport.get(site)
  if (!stat) {
    stat = {total: 0, kept: 0, autoFixed: 0, review: 0, rejected: 0, byReason: {}, samples: {}}
    qcReport.set(site, stat)
  }
  stat.total += 1
  if (result.action === "keep") stat.kept += 1
  if (result.action === "auto_fix") stat.autoFixed += 1
  if (result.action === "review") stat.review += 1
  if (result.action === "reject") stat.rejected += 1

  for (const reason of result.reasons) {
    stat.byReason[reason] = (stat.byReason[reason] || 0) + 1
    const bucket = (stat.samples[reason] ??= [])
    const sku = skuOf(result.product)
    if (bucket.length < 3 && sku) bucket.push(sku)
  }
}

function currentCategoryCompat(raw: string): Category | null {
  const normalized = normalizeForMatch(raw)
  if ((CATEGORIES as readonly string[]).includes(raw)) return raw as Category
  return CATEGORY_COMPAT[normalized] ?? null
}

export function inferCategoryFromText(text: string): Category | null {
  if (!text.trim()) return null
  const priority = inferPriorityCategoryFromText(text)
  if (priority) return priority
  const matches = CATEGORY_ALIASES.filter((entry) => matchesAny(text, entry.patterns, entry.contains)).map((entry) => entry.category)
  const unique = [...new Set(matches)]
  return unique.length === 1 ? unique[0] : null
}

function normalizeCategoryField(
  product: ProductQcInput,
  trustedCategory: boolean,
): {
  value: string | null
  reason: string | null
  confidence: number
  needsReview: boolean
} {
  const raw = typeof product.category === "string" ? product.category.trim() : ""
  const inferred = inferCategoryFromText(product.name)
  const priorityInferred = inferPriorityCategoryFromText(product.name)

  if (!raw) {
    if (inferred) return {value: inferred, reason: "category_missing_text_fallback", confidence: 0.84, needsReview: false}
    return {value: null, reason: "category_missing", confidence: 0, needsReview: true}
  }

  // 방침 A 예외 (category canonical-strict): 출력은 canonical(CATEGORIES) 또는 null 만.
  // 원본을 그대로 통과시키지 않는다 — 비-canonical(할인율·세일배너·내비라벨 등)이 새면
  // 검색 필터가 오염되므로, 매핑되지 않는 값은 상품명 추론으로 대체하고 그마저 없으면
  // null(NOT NULL 에 걸려 적재 제외)로 떨어뜨린다.
  const current = currentCategoryCompat(raw)
  if (current) {
    // `other` is a fallback rather than a trusted taxonomy decision. When a
    // later pass finds explicit product-name evidence, promote it directly.
    if (current === "other" && inferred) {
      return {value: inferred, reason: "category_other_text_fallback", confidence: 0.8, needsReview: false}
    }
    // A brief listed in an explicit swim category is a bikini/swim bottom,
    // not underwear. Keep the stronger official taxonomy evidence.
    if (current === "swimwear" && inferred === "underwear") {
      return {value: current, reason: current === raw ? null : "category_canonicalized", confidence: 0.9, needsReview: false}
    }
    if (priorityInferred && current !== priorityInferred && !trustedCategory) {
      return {value: priorityInferred, reason: "category_priority_text_override", confidence: 0.9, needsReview: false}
    }
    // ② 이름 기반 번복. 신뢰 출처에서는 건너뛴다 — 구제할 원본이 아니다.
    // 아래 두 text_fallback 은 남긴다: 값이 **없을 때** 채우는 것이라 번복이 아니다.
    if (inferred && current !== inferred && !trustedCategory) {
      return {value: inferred, reason: "category_text_conflict", confidence: 0.5, needsReview: true}
    }
    return {value: current, reason: current === raw ? null : "category_canonicalized", confidence: 0.9, needsReview: false}
  }

  if (inferred) return {value: inferred, reason: "category_noise_text_fallback", confidence: 0.8, needsReview: false}
  // 상품 적재는 Qwen 가용성에 종속되지 않는다. 결정론적으로 분류할 수 없는
  // 값은 canonical `other` 로 먼저 저장하고 후속 Qwen 정규화가 조건부 PATCH한다.
  return {value: "other", reason: "category_unresolved_other_fallback", confidence: 0.2, needsReview: false}
}

// subcategory is optional (unlike category — no NOT NULL constraint, no
// search-filter dependency), so an unresolved value never triggers review;
// it just drops to null. canonicalCategory must be the QC-resolved category
// (post normalizeCategoryField), not the raw input, so e.g. "Outer"/"sweater"
// aliases still resolve their subcategory correctly.
function normalizeSubcategoryField(
  product: ProductQcInput,
  canonicalCategory: Category | null,
): {value: string | null; reason: string | null; confidence: number} {
  const resolved = resolveSubcategory(product.subcategory, canonicalCategory, product.name)

  switch (resolved.reason) {
    case null:
      return {value: resolved.value, reason: null, confidence: 1}
    case "canonicalized":
      return {value: resolved.value, reason: "subcategory_canonicalized", confidence: 0.92}
    case "text_fallback":
      return {value: resolved.value, reason: "subcategory_missing_text_fallback", confidence: 0.75}
    case "no_category":
      return {value: null, reason: "subcategory_no_category", confidence: 0.5}
    case "noncanonical_dropped":
      return {value: null, reason: "subcategory_noncanonical_dropped", confidence: 0.4}
  }
}

/**
 * 성별 정규화 — 크롤러 write-path 게이트의 백스톱.
 *
 * 추론 규칙 자체는 ../product-gender.ts 에 산다: 그쪽이 write-path(engine/url/
 * text/config_default 순위 결의)와 교정 스크립트의 공통 출처이고, QC 는 그 결과가
 * canonical 어휘를 벗어나지 않는지 확인하는 마지막 관문이다.
 *
 * gender 를 못 뽑으면 needsReview → applyProductQcGate 가 상품을 드랍한다.
 * 미확인을 unisex 로 채우지 않는 것이 핵심 — 검색 RPC 가 unisex 를 남녀 양쪽에
 * 노출시키므로 그건 여성 상품이 남성 검색으로 새는 경로다.
 *
 * [HARD] 추론은 반드시 resolveProductGenderWithSource 를 통한다 — 자체
 * inferGenderFromText 호출로 대체하지 말 것. 예전에는 QC 가 name+category 만
 * 보고 따로 추론했는데, write-path 는 tags+URL 까지 보므로 **두 곳의 판정이
 * 갈렸다**. 실측(sportyandrich): URL `-men` 과 태그 "Unisex" 가 충돌해
 * write-path 는 미확인으로 떨어뜨렸는데, 태그를 안 보는 QC 가 name 의 "Men"
 * 만으로 되살려 충돌 가드를 무력화했다. 같은 결의를 쓰면 갈릴 수 없다.
 *
 * description 은 입력에서 뺐다. 크롤러가 더 이상 수집하지 않고, products.description
 * 은 2000자 마케팅/사이즈표 slice 라 "여성 사이즈 참고" 같은 문구가 오판을 만든다.
 */
function normalizeGenderField(product: ProductQcInput, options: ProductQcOptions): {
  value: string[] | null
  /** value 를 새로 추론했을 때의 출처. 기존 값을 그대로 쓰면 null. */
  source: string | null
  reason: string | null
  confidence: number
  needsReview: boolean
} {
  const raw = Array.isArray(product.gender) ? product.gender : []

  // write-path(import-products.ts)와 **완전히 같은** 호출이어야 한다 —
  // 상품값·근거·출처를 모두 넘긴다. 예전에는 raw 가 canonical 이면 그대로
  // 통과시켰는데, 그러면 엔진이 미리 찍은 config_default 값이 kids 가드를
  // 건너뛰어 아동복이 사이트 기본 성별을 얻었다 (실측: birthdayeve 9건).
  const resolved = resolveProductGenderWithSource(
    raw,
    {
      name: product.name,
      category: product.category,
      subcategory: product.subcategory,
      tags: product.tags,
      productUrl: product.productUrl,
    },
    (product.genderSource as GenderSource | undefined) ?? "engine",
    {
      kidsGenderNoisePatterns: options.kidsGenderNoisePatterns,
      verifiedUnisexDefault: options.verifiedUnisexDefault,
    },
  )

  const normalized = [...new Set(raw.map((g) => normalizeGenderToken(String(g)) ?? normalizeForMatch(String(g))).filter(Boolean))]
    .filter((g): g is "men" | "women" | "unisex" => g === "men" || g === "women" || g === "unisex")

  // 결의 결과가 상품값과 같으면 canonical 정리만 보고한다 (출처 불변).
  if (resolved.gender.length > 0 && JSON.stringify(resolved.gender) === JSON.stringify(normalized)) {
    return {
      value: normalized,
      source: null,
      reason: JSON.stringify(raw) === JSON.stringify(normalized) ? null : "gender_canonicalized",
      confidence: 0.95,
      needsReview: false,
    }
  }
  if (resolved.gender.length > 0) {
    return {
      value: resolved.gender,
      source: resolved.source,
      reason: "gender_missing_text_fallback",
      confidence: 0.82,
      needsReview: false,
    }
  }
  // conflict(men vs women)도 여기로 온다 — 추측하지 않고 드랍한다.
  return {value: null, source: null, reason: "gender_missing", confidence: 0.2, needsReview: true}
}

export function normalizeProductTextFields<T extends ProductQcInput>(
  product: T,
  options: ProductQcOptions = {},
): ProductQcResult<T> {
  const next = {...product} as T
  const changes: ProductQcFieldChange[] = []
  const reasons: string[] = []
  const confidences: number[] = []
  let needsReview = false

  const category = normalizeCategoryField(product, options.trustedCategory === true)
  confidences.push(category.confidence)
  if (category.needsReview) needsReview = true
  if (category.reason) reasons.push(category.reason)
  if (category.value && category.value !== product.category) {
    changes.push({field: "category", before: product.category, after: category.value, reason: category.reason ?? "category_normalized", confidence: category.confidence})
    next.category = category.value
  }

  // Resolve subcategory against the QC-canonicalized category (next.category),
  // not the raw input — an aliased category like "Outer"/"sweater" must still
  // land its subcategory in the right family's vocabulary. next.category can
  // still be a non-canonical raw string here (category normalization leaves it
  // untouched when it needs review — see the truthy guard above), so re-check
  // validity rather than trust the cast; SUBCATEGORIES[bogusKey] would throw.
  const canonicalCategory: Category | null =
    typeof next.category === "string" && isValidCategory(next.category) ? next.category : null
  const subcategory = normalizeSubcategoryField(product, canonicalCategory)
  confidences.push(subcategory.confidence)
  if (subcategory.reason) reasons.push(subcategory.reason)
  if (subcategory.value !== (product.subcategory ?? null)) {
    changes.push({
      field: "subcategory",
      before: product.subcategory,
      after: subcategory.value,
      reason: subcategory.reason ?? "subcategory_normalized",
      confidence: subcategory.confidence,
    })
    next.subcategory = subcategory.value
  }

  const gender = normalizeGenderField(product, options)
  confidences.push(gender.confidence)
  if (gender.needsReview) needsReview = true
  if (gender.reason) reasons.push(gender.reason)
  if (gender.value && JSON.stringify(gender.value) !== JSON.stringify(product.gender ?? null)) {
    changes.push({
      field: "gender",
      before: product.gender,
      after: gender.value,
      reason: gender.reason ?? "gender_normalized",
      confidence: gender.confidence,
    })
    next.gender = gender.value
    // provenance 를 값과 함께 갱신한다. 이걸 빠뜨리면 import 결의가 stale 한
    // config_default 라벨을 보고 isConfigDefault 분기를 타 오판한다.
    if (gender.source !== null) next.genderSource = gender.source
  }

  const confidence = confidences.length > 0 ? Math.min(...confidences) : 1
  const action: ProductQcAction = needsReview ? "review" : changes.length > 0 ? "auto_fix" : "keep"

  return {
    action,
    product: next,
    changes,
    reasons,
    confidence,
  }
}

export function applyProductQcGate<T extends ProductQcInput>(
  products: T[],
  site: string,
  options: ProductQcOptions = {},
): T[] {
  if (!isQcEnabled()) return products

  const accepted: T[] = []
  for (const product of products) {
    const result = normalizeProductTextFields(product, options)
    record(site, result)

    if (result.action === "review" || result.action === "reject") {
      const firstReason = result.reasons[0] ?? "product_qc_uncertain"
      emit({
        kind: "product_qc_review",
        site,
        sku: skuOf(product),
        action: result.action,
        reason: firstReason,
        confidence: result.confidence,
        changes: result.changes,
      })
      continue
    }

    accepted.push(result.product)
  }

  return accepted
}

export function getProductQcReport(): Map<string, ProductQcStats> {
  return qcReport
}

export function resetProductQcReport(): void {
  qcReport.clear()
}
