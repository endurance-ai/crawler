import {CATEGORIES, type Category} from "../enums/product-enums"
import {emit} from "../core/observability"

export type ProductQcAction = "keep" | "auto_fix" | "review" | "reject"

export interface ProductQcFieldChange {
  field: "category"
  before: unknown
  after: unknown
  reason: string
  confidence: number
}

export interface ProductQcInput {
  name: string
  category?: string | null
  description?: string | null
  subcategory?: string | null
  tags?: string[] | null
  productUrl?: string | null
  productCode?: string | null
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
    patterns: [/\b(t[-\s]?shirt|tee|shirt|blouse|polo|hoodie|sweatshirt|tank[-\s]?top|crop[-\s]?top|henley|camisole)\b/i],
    contains: ["\uc0c1\uc758", "\ud2f0\uc154\uce20", "\uc154\uce20", "\ube14\ub77c\uc6b0\uc2a4", "\ud6c4\ub4dc", "\ub9e8\ud22c\ub9e8", "\ub098\uc2dc", "\ud0f1\ud06c\ud0d1"],
  },
  {
    category: "bottoms",
    patterns: [/\b(pants?|trousers?|jeans|denim|shorts?|skirt|joggers?|leggings|chinos?|culottes|sweatpants|cargo)\b/i],
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
    patterns: [/\b(scarf|belt|watch|tie|gloves|socks|wallet|muffler)\b/i],
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

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
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

function matchesAny(text: string, patterns: RegExp[], contains?: string[]): boolean {
  const stripped = normalizeForMatch(text)
  if (patterns.some((re) => re.test(text) || re.test(stripped))) return true
  return (contains ?? []).some((needle) => text.includes(needle))
}

function currentCategoryCompat(raw: string): Category | null {
  const normalized = normalizeForMatch(raw)
  if ((CATEGORIES as readonly string[]).includes(raw)) return raw as Category
  return CATEGORY_COMPAT[normalized] ?? null
}

function inferCategoryFromText(text: string): Category | null {
  if (!text.trim()) return null
  const matches = CATEGORY_ALIASES.filter((entry) => matchesAny(text, entry.patterns, entry.contains)).map((entry) => entry.category)
  const unique = [...new Set(matches)]
  return unique.length === 1 ? unique[0] : null
}

function normalizeCategoryField(product: ProductQcInput): {
  value: string | null
  reason: string | null
  confidence: number
  needsReview: boolean
} {
  const raw = typeof product.category === "string" ? product.category.trim() : ""
  const inferred = inferCategoryFromText(product.name)

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
    if (inferred && current !== inferred) {
      return {value: inferred, reason: "category_text_conflict", confidence: 0.5, needsReview: true}
    }
    return {value: current, reason: current === raw ? null : "category_canonicalized", confidence: 0.9, needsReview: false}
  }

  if (inferred) return {value: inferred, reason: "category_noise_text_fallback", confidence: 0.8, needsReview: false}
  return {value: null, reason: "category_noncanonical_dropped", confidence: 0, needsReview: true}
}




export function normalizeProductTextFields<T extends ProductQcInput>(product: T): ProductQcResult<T> {
  const next = {...product} as T
  const changes: ProductQcFieldChange[] = []
  const reasons: string[] = []
  const confidences: number[] = []
  let needsReview = false

  const category = normalizeCategoryField(product)
  confidences.push(category.confidence)
  if (category.needsReview) needsReview = true
  if (category.reason) reasons.push(category.reason)
  if (category.value && category.value !== product.category) {
    changes.push({field: "category", before: product.category, after: category.value, reason: category.reason ?? "category_normalized", confidence: category.confidence})
    next.category = category.value
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

export function applyProductQcGate<T extends ProductQcInput>(products: T[], site: string): T[] {
  if (!isQcEnabled()) return products

  const accepted: T[] = []
  for (const product of products) {
    const result = normalizeProductTextFields(product)
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
