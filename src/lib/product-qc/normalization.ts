import {CATEGORIES, type Category} from "../enums/product-enums"
import {emit} from "../core/observability"

export type ProductQcAction = "keep" | "auto_fix" | "review" | "reject"

export interface ProductQcFieldChange {
  field: "category" | "color" | "gender"
  before: unknown
  after: unknown
  reason: string
  confidence: number
}

export interface ProductQcInput {
  name: string
  category?: string | null
  color?: string | null
  gender?: string[] | null
  price?: number | null
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

const SIZE_TOKEN_RE =
  /^(?:xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|f|free|os|one|one\s*size|size|[0-9]{1,3}(?:\.[0-9])?|us\s*[0-9.]+|eu\s*[0-9.]+)$/i

const SIZE_SUFFIX_RE =
  /(?:[-_\s/]+(?:xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|free|os|one\s*size|[0-9]{1,3}(?:\.[0-9])?))$/i

const NON_COLOR_RE =
  /(?:sold\s*out|out\s*of\s*stock|low\s*in\s*stock|select|choose|option|earrings?|earcuff|pierce|necklace|bracelet|ring|hairpin|choker|keyring|stud|cuff|bangle|pin|pendant|swatch|jewel|parts|환불|교환|반품|불가|주문제작|불량|단순변심|\+|-?\s*(?:krw|usd|eur|gbp|jpy|cny)?\s*[0-9,]+\s*(?:won|원)?)/i

const COLOR_RULES: Array<{canonical: string; patterns: RegExp[]; contains?: string[]}> = [
  {
    canonical: "Black",
    patterns: [/\b(black|noir|noire|negro|negra|nero|nera|schwarz|preto|preta)\b/i],
    contains: ["\uac80\uc815", "\uac80\uc740\uc0c9", "\ube14\ub799"],
  },
  {
    canonical: "White",
    patterns: [/\b(white|blanc|blanche|blanco|blanca|bianco|bianca|weiss|wei\u00df|branco|branca)\b/i],
    contains: ["\ud654\uc774\ud2b8", "\ud558\uc591", "\ud558\uc580\uc0c9", "\ubc31\uc0c9"],
  },
  {
    canonical: "Ivory",
    patterns: [/\b(off[-\s]?white|ivory|ecru|eggshell|ivoire|marfil)\b/i],
    contains: ["\uc544\uc774\ubcf4\ub9ac", "\uc5d0\ud06c\ub8e8"],
  },
  {
    canonical: "Cream",
    patterns: [/\b(cream|creme|cr\u00e8me|crema)\b/i],
    contains: ["\ud06c\ub9bc"],
  },
  {
    canonical: "Grey",
    patterns: [/\b(gr[ae]y|gris|grau|grigio|cinza|ash|slate)\b/i],
    contains: ["\uadf8\ub808\uc774", "\ud68c\uc0c9", "\uc7bf\ube5b"],
  },
  {
    canonical: "Melange",
    patterns: [/\b(melange|m\u00e9lange|mellange)\b/i],
  },
  {
    canonical: "Steel",
    patterns: [/\b(steel)\b/i],
  },
  {
    canonical: "Charcoal",
    patterns: [/\b(charcoal|chacoal|chatrcoal|anthracite|antracita)\b/i],
    contains: ["\ucc28\ucf5c"],
  },
  {
    canonical: "Navy",
    patterns: [/\b(navy|marine|marino|bleu\s+marine|azul\s+marino|midnight)\b/i],
    contains: ["\ub124\uc774\ube44", "\uac10\uc0c9"],
  },
  {
    canonical: "Indigo",
    patterns: [/\b(indigo)\b/i],
    contains: ["\uc778\ub514\uace0"],
  },
  {
    canonical: "Blue",
    patterns: [/\b(blue|bleu|azul|blu|blau|sky\s*blue|cobalt|royal\s*blue)\b/i],
    contains: ["\ube14\ub8e8", "\ud30c\ub791", "\ud30c\ub780\uc0c9", "\ud558\ub298\uc0c9", "\uc18c\ub77c"],
  },
  {
    canonical: "Water",
    patterns: [/\b(water)\b/i],
  },
  {
    canonical: "Ice",
    patterns: [/\b(ice)\b/i],
  },
  {
    canonical: "Mint",
    patterns: [/\b(mint)\b/i],
    contains: ["\ubbfc\ud2b8"],
  },
  {
    canonical: "Teal",
    patterns: [/\b(teal|turquoise|aqua)\b/i],
  },
  {
    canonical: "Beige",
    patterns: [/\b(beige|taupe|greige)\b/i],
    contains: ["\ubca0\uc774\uc9c0"],
  },
  {
    canonical: "Sand",
    patterns: [/\b(sand|oatmeal|oat)\b/i],
    contains: ["\uc0cc\ub4dc"],
  },
  {
    canonical: "Camel",
    patterns: [/\b(camel)\b/i],
    contains: ["\uce74\uba5c"],
  },
  {
    canonical: "Tan",
    patterns: [/\b(tan)\b/i],
    contains: ["\ud0e0"],
  },
  {
    canonical: "Khaki",
    patterns: [/\b(khaki|caqui)\b/i],
    contains: ["\uce74\ud0a4"],
  },
  {
    canonical: "Brown",
    patterns: [/\b(brown|marron|marr\u00f3n|brun|brune|braun|chocolate|espresso)\b/i],
    contains: ["\ube0c\ub77c\uc6b4", "\uac08\uc0c9", "\ucd08\ucf5c\ub9bf"],
  },
  {
    canonical: "Burgundy",
    patterns: [/\b(burgundy|wine|maroon|bordeaux|bordo|crimson|scarlet)\b/i],
    contains: ["\ubc84\uac74\ub514", "\uc640\uc778", "\uc790\uc8fc"],
  },
  {
    canonical: "Red",
    patterns: [/\b(red|rouge|rojo|roja|rosso|rossa|rot|vermelho|vermelha)\b/i],
    contains: ["\ub808\ub4dc", "\ube68\uac15", "\ube68\uac04\uc0c9", "\uc801\uc0c9"],
  },
  {
    canonical: "Magenta",
    patterns: [/\b(magenta)\b/i],
  },
  {
    canonical: "Pink",
    patterns: [/\b(pink|rose|rosa|blush)\b/i],
    contains: ["\ud551\ud06c", "\ubd84\ud64d"],
  },
  {
    canonical: "Peach",
    patterns: [/\b(peach)\b/i],
  },
  {
    canonical: "Purple",
    patterns: [/\b(purple|violet|lavender|lilac|morado|pourpre|viola)\b/i],
    contains: ["\ud37c\ud50c", "\ubcf4\ub77c", "\ub77c\ubca4\ub354"],
  },
  {
    canonical: "Green",
    patterns: [/\b(green|vert|verde|grun|gr\u00fcn|sage|forest|hunter)\b/i],
    contains: ["\uadf8\ub9b0", "\ub179\uc0c9", "\ucd08\ub85d"],
  },
  {
    canonical: "Camo",
    patterns: [/\b(camo|camouflage)\b/i],
  },
  {
    canonical: "Olive",
    patterns: [/\b(olive|oliva)\b/i],
    contains: ["\uc62c\ub9ac\ube0c"],
  },
  {
    canonical: "Yellow",
    patterns: [/\b(yellow|jaune|amarillo|amarilla|giallo|gelb)\b/i],
    contains: ["\uc610\ub85c", "\ub178\ub791", "\ub178\ub780\uc0c9", "\ud669\uc0c9"],
  },
  {
    canonical: "Orange",
    patterns: [/\b(orange|naranja|arancione)\b/i],
    contains: ["\uc624\ub80c\uc9c0", "\uc8fc\ud669"],
  },
  {
    canonical: "Silver",
    patterns: [/\b(silver|argent|plata|silber)\b/i],
    contains: ["\uc2e4\ubc84", "\uc740\uc0c9"],
  },
  {
    canonical: "Gold",
    patterns: [/\b(gold|or|oro|dorado|dourado)\b/i],
    contains: ["\uace8\ub4dc", "\uae08\uc0c9"],
  },
  {
    canonical: "Multi",
    patterns: [/\b(multi(?:color|colour|colore)?|multicolor|multicolour|assorted)\b/i],
    contains: ["\uba40\ud2f0", "\ub2e4\uc0c9"],
  },
]

const CATEGORY_ALIASES: Array<{category: Category; patterns: RegExp[]; contains?: string[]}> = [
  {
    category: "Outer",
    patterns: [/\b(coat|jacket|blazer|parka|anorak|windbreaker|cardigan|vest|outerwear|fleece)\b/i],
    contains: ["\uc544\uc6b0\ud130", "\ucf54\ud2b8", "\uc7ac\ud0b7", "\uc790\ucf13", "\ube14\ub808\uc774\uc800", "\ud30c\uce74", "\uac00\ub514\uac74"],
  },
  {
    category: "Dress",
    patterns: [/\b(dress|robe|vestido|abito|one[-\s]?piece)\b/i],
    contains: ["\ub4dc\ub808\uc2a4", "\uc6d0\ud53c\uc2a4"],
  },
  {
    category: "Shoes",
    patterns: [/\b(shoes?|sneakers?|boots?|loafers?|sandals?|mules?|heels?|flats?|slides?)\b/i],
    contains: ["\uc2e0\ubc1c", "\uc2a4\ub2c8\ucee4\uc988", "\ubd80\uce20", "\ub85c\ud37c", "\uc0cc\ub4e4", "\uad6c\ub450"],
  },
  {
    category: "Bag",
    patterns: [/\b(bag|tote|backpack|crossbody|clutch|shoulder\s*bag|messenger|briefcase)\b/i],
    contains: ["\uac00\ubc29", "\ud1a0\ud2b8", "\ubc31\ud329", "\ud074\ub7ec\uce58", "\uc204\ub354\ubc31"],
  },
  {
    category: "Bottom",
    patterns: [/\b(pants?|trousers?|jeans|denim|shorts?|skirt|joggers?|leggings|culottes)\b/i],
    contains: ["\ud558\uc758", "\ud32c\uce20", "\ubc14\uc9c0", "\ub370\ub2d8", "\uc9c4", "\uc1fc\uce20", "\uc2a4\ucee4\ud2b8"],
  },
  {
    category: "Accessories",
    patterns: [/\b(hat|cap|scarf|belt|sunglasses|watch|necklace|bracelet|ring|earrings|tie|gloves|socks|wallet)\b/i],
    contains: ["\uc561\uc138\uc11c\ub9ac", "\uc545\uc138\uc0ac\ub9ac", "\ubaa8\uc790", "\ucea1", "\uc2a4\uce74\ud504", "\ubca8\ud2b8", "\uc591\ub9d0", "\uc9c0\uac11"],
  },
  {
    category: "Top",
    patterns: [/\b(top|tee|t[-\s]?shirt|shirt|blouse|polo|sweater|knit|tank|camisole|sweatshirt|hoodie)\b/i],
    contains: ["\uc0c1\uc758", "\ud2f0\uc154\uce20", "\uc154\uce20", "\ube14\ub77c\uc6b0\uc2a4", "\ub2c8\ud2b8", "\uc2a4\uc6e8\ud130", "\ud6c4\ub4dc"],
  },
]

const URL_COLOR_SUFFIXES: Array<{canonical: string; suffixes: string[]}> = [
  {canonical: "Charcoal", suffixes: ["charcoal", "chacoal", "chatrcoal"]},
  {canonical: "Melange", suffixes: ["melange", "mellange"]},
  {canonical: "Magenta", suffixes: ["magenta"]},
  {canonical: "Burgundy", suffixes: ["burgundy"]},
  {canonical: "Indigo", suffixes: ["indigo"]},
  {canonical: "Purple", suffixes: ["purple"]},
  {canonical: "Yellow", suffixes: ["yellow"]},
  {canonical: "Orange", suffixes: ["orange"]},
  {canonical: "Silver", suffixes: ["silver"]},
  {canonical: "Ivory", suffixes: ["ivory"]},
  {canonical: "Cream", suffixes: ["cream"]},
  {canonical: "Beige", suffixes: ["beige"]},
  {canonical: "Brown", suffixes: ["brown"]},
  {canonical: "White", suffixes: ["white"]},
  {canonical: "Black", suffixes: ["black"]},
  {canonical: "Green", suffixes: ["green"]},
  {canonical: "Peach", suffixes: ["peach"]},
  {canonical: "Water", suffixes: ["water"]},
  {canonical: "Olive", suffixes: ["olive"]},
  {canonical: "Khaki", suffixes: ["khaki"]},
  {canonical: "Camo", suffixes: ["camouflage", "camo"]},
  {canonical: "Mint", suffixes: ["mint"]},
  {canonical: "Navy", suffixes: ["navy"]},
  {canonical: "Grey", suffixes: ["grey", "gray"]},
  {canonical: "Blue", suffixes: ["skyblue", "blue"]},
  {canonical: "Pink", suffixes: ["pink"]},
  {canonical: "Gold", suffixes: ["gold"]},
  {canonical: "Ice", suffixes: ["ice"]},
]

const CATEGORY_COMPAT: Record<string, Category> = {
  outer: "Outer",
  outerwear: "Outer",
  jacket: "Outer",
  jackets: "Outer",
  coat: "Outer",
  coats: "Outer",
  cardigan: "Outer",
  top: "Top",
  tops: "Top",
  shirt: "Top",
  shirts: "Top",
  knit: "Top",
  knitwear: "Top",
  sweater: "Top",
  sweatshirt: "Top",
  bottom: "Bottom",
  bottoms: "Bottom",
  pants: "Bottom",
  trousers: "Bottom",
  jeans: "Bottom",
  denim: "Bottom",
  skirt: "Bottom",
  shorts: "Bottom",
  shoes: "Shoes",
  shoe: "Shoes",
  footwear: "Shoes",
  bag: "Bag",
  bags: "Bag",
  dress: "Dress",
  dresses: "Dress",
  accessories: "Accessories",
  accessory: "Accessories",
}

const GENDER_RULES: Array<{gender: "men" | "women" | "unisex"; patterns: RegExp[]; contains?: string[]}> = [
  {
    gender: "men",
    patterns: [/\b(men|mens|men's|man|male|hombre|homme|uomo|herren)\b/i],
    contains: ["\ub0a8\uc131", "\ub0a8\uc790", "\ub0a8\uc790\uc6a9", "\uba58\uc988"],
  },
  {
    gender: "women",
    patterns: [/\b(women|womens|women's|woman|female|mujer|femme|donna|damen|ladies)\b/i],
    contains: ["\uc5ec\uc131", "\uc5ec\uc790", "\uc5ec\uc790\uc6a9", "\uc6b0\uba3c", "\ub808\uc774\ub514\uc2a4"],
  },
  {
    gender: "unisex",
    patterns: [/\b(unisex|genderless|gender[-\s]?free)\b/i],
    contains: ["\ub0a8\ub140\uacf5\uc6a9", "\uacf5\uc6a9", "\uc720\ub2c8\uc139\uc2a4"],
  },
]

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

function canonicalColorFromText(text: string): string | null {
  if (!text.trim()) return null
  for (const rule of COLOR_RULES) {
    if (matchesAny(text, rule.patterns, rule.contains)) return rule.canonical
  }
  return null
}

function nonProductReason(product: ProductQcInput): string | null {
  const name = normalizeForMatch(product.name)
  const category = normalizeForMatch(product.category ?? "")
  const likelyAccessoryBucket = /\b(acc|accessor(?:y|ies)|etc|obj)\b/.test(category)
  const magazineTitle = /\b(vogue|elle|the face|magazine)\b/.test(name)
  const magazineIssue = /\b(edition|cover|19\d{2}|20\d{2})\b/.test(name)
  const suspiciousLowPrice = typeof product.price === "number" && product.price > 0 && product.price < 5000

  if (likelyAccessoryBucket && magazineTitle && (magazineIssue || suspiciousLowPrice)) return "non_product_magazine"
  return null
}

function isNonColorToken(token: string): boolean {
  const raw = token.trim()
  const t = normalizeForMatch(token)
  if (!t) return true
  if (canonicalColorFromText(token)) return false
  if (/^(?:xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl)\s*(?:\ub77c\uc9c0|\ubbf8\ub514\uc6c0|\uc2a4\ubab0|\ub300|\uc911|\uc18c)$/i.test(raw)) return true
  if (SIZE_TOKEN_RE.test(t)) return true
  if (/\b[a-z0-9][a-z0-9\s.'-]*\s+x\s+[a-z0-9][a-z0-9\s.'-]*\b/i.test(raw)) return true
  if (NON_COLOR_RE.test(raw) || NON_COLOR_RE.test(t)) return true
  if (/^\*+$/.test(t)) return true
  return false
}

function cafe24SlugSegment(productUrl?: string | null): string | null {
  if (!productUrl) return null
  let pathname = productUrl
  try {
    pathname = new URL(productUrl).pathname
  } catch {
    // Keep the raw value for relative or malformed-but-useful paths.
  }

  const parts = pathname.split("/").filter(Boolean)
  const productIndex = parts.findIndex((part) => part.toLowerCase() === "product")
  if (productIndex === -1) return null
  const slug = parts[productIndex + 1]
  if (!slug || /^detail\.html$/i.test(slug)) return null
  try {
    return decodeURIComponent(slug)
  } catch {
    return slug
  }
}

function canonicalColorFromCafe24Slug(productUrl?: string | null): string | null {
  const slug = cafe24SlugSegment(productUrl)
  if (!slug) return null

  const normalized = normalizeForMatch(slug).replace(/[^a-z0-9]+/g, "")
  if (!normalized) return null

  for (const rule of URL_COLOR_SUFFIXES) {
    for (const suffix of rule.suffixes) {
      if (normalized.endsWith(suffix) && normalized.length >= suffix.length + 4) {
        return rule.canonical
      }
    }
  }

  return null
}

function colorCandidates(raw: string): string[] {
  return raw
    .split(/[,/|;]+/)
    .map((part) => part.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").trim())
    .flatMap((part) => {
      const stripped = part.replace(SIZE_SUFFIX_RE, "").trim()
      return stripped && stripped !== part ? [stripped, part] : [part]
    })
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeColorField(product: ProductQcInput): {
  value: string | null
  reason: string | null
  confidence: number
  needsReview: boolean
} {
  const raw = typeof product.color === "string" ? product.color.trim() : ""
  const textFallback = [
    product.name,
    product.description ?? "",
    product.subcategory ?? "",
    ...(product.tags ?? []),
  ].join(" ")

  if (!raw) {
    const fallback = canonicalColorFromText(textFallback)
    if (fallback) return {value: fallback, reason: "color_missing_text_fallback", confidence: 0.86, needsReview: false}
    const urlFallback = canonicalColorFromCafe24Slug(product.productUrl)
    if (urlFallback) return {value: urlFallback, reason: "color_missing_url_fallback", confidence: 0.82, needsReview: false}
    return {value: null, reason: "color_missing", confidence: 0, needsReview: true}
  }

  const candidates = colorCandidates(raw)
  const nonNoise = candidates.filter((candidate) => !isNonColorToken(candidate))
  const canonical = [...new Set(nonNoise.map(canonicalColorFromText).filter((v): v is string => Boolean(v)))]
  const nameFallback = canonicalColorFromText(product.name)
  const urlFallback = canonicalColorFromCafe24Slug(product.productUrl)

  if (canonical.length > 0) {
    if (canonical.length === 1 && urlFallback && canonical[0] !== urlFallback) {
      return {
        value: urlFallback,
        reason: "color_single_option_url_fallback",
        confidence: 0.88,
        needsReview: false,
      }
    }
    if (canonical.length > 1 && nameFallback && canonical.includes(nameFallback)) {
      return {
        value: nameFallback,
        reason: "color_multi_option_name_fallback",
        confidence: 0.9,
        needsReview: false,
      }
    }
    return {
      value: canonical.slice(0, 5).join(", "),
      reason: "color_canonicalized",
      confidence: 0.94,
      needsReview: false,
    }
  }

  if (nonNoise.length === 0) {
    const fallback = canonicalColorFromText(textFallback)
    if (fallback) return {value: fallback, reason: "color_noise_text_fallback", confidence: 0.88, needsReview: false}
    if (urlFallback) return {value: urlFallback, reason: "color_noise_url_fallback", confidence: 0.84, needsReview: false}
    return {value: null, reason: "color_non_color_unresolved", confidence: 0.1, needsReview: true}
  }

  return {
    value: nonNoise.map(titleCase).slice(0, 5).join(", "),
    reason: null,
    confidence: 0.65,
    needsReview: false,
  }
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

  const current = currentCategoryCompat(raw)
  if (current && inferred && current !== inferred) {
    return {value: raw, reason: "category_text_conflict", confidence: 0.35, needsReview: true}
  }

  return {value: raw, reason: null, confidence: 0.9, needsReview: false}
}

function normalizeGenderToken(raw: string): "men" | "women" | "unisex" | null {
  for (const rule of GENDER_RULES) {
    if (matchesAny(raw, rule.patterns, rule.contains)) return rule.gender
  }
  return null
}

function inferGenderFromText(text: string): "men" | "women" | "unisex" | null {
  const matches = GENDER_RULES.filter((rule) => matchesAny(text, rule.patterns, rule.contains)).map((rule) => rule.gender)
  const unique = [...new Set(matches)]
  if (unique.includes("unisex")) return "unisex"
  return unique.length === 1 ? unique[0] : null
}

function normalizeGenderField(product: ProductQcInput): {
  value: string[] | null
  reason: string | null
  confidence: number
  needsReview: boolean
} {
  const raw = Array.isArray(product.gender) ? product.gender : []
  const normalized = [...new Set(raw.map((g) => normalizeGenderToken(String(g)) ?? normalizeForMatch(String(g))).filter(Boolean))]
    .filter((g): g is "men" | "women" | "unisex" => g === "men" || g === "women" || g === "unisex")

  if (normalized.length > 0) {
    return {
      value: normalized,
      reason: JSON.stringify(raw) === JSON.stringify(normalized) ? null : "gender_canonicalized",
      confidence: 0.95,
      needsReview: false,
    }
  }

  const inferred = inferGenderFromText([product.name, product.category ?? "", product.description ?? ""].join(" "))
  if (inferred) return {value: [inferred], reason: "gender_missing_text_fallback", confidence: 0.82, needsReview: false}
  return {value: null, reason: "gender_missing", confidence: 0.2, needsReview: true}
}

export function normalizeProductTextFields<T extends ProductQcInput>(product: T): ProductQcResult<T> {
  const nonProduct = nonProductReason(product)
  if (nonProduct) {
    return {
      action: "reject",
      product,
      changes: [],
      reasons: [nonProduct],
      confidence: 0.98,
    }
  }

  const next = {...product} as T
  const changes: ProductQcFieldChange[] = []
  const reasons: string[] = []
  const confidences: number[] = []
  let needsReview = false

  const color = normalizeColorField(product)
  confidences.push(color.confidence)
  if (color.needsReview) needsReview = true
  if (color.reason) reasons.push(color.reason)
  if (color.value && color.value !== product.color) {
    changes.push({field: "color", before: product.color, after: color.value, reason: color.reason ?? "color_normalized", confidence: color.confidence})
    next.color = color.value
  }

  const category = normalizeCategoryField(product)
  confidences.push(category.confidence)
  if (category.needsReview) needsReview = true
  if (category.reason) reasons.push(category.reason)
  if (category.value && category.value !== product.category) {
    changes.push({field: "category", before: product.category, after: category.value, reason: category.reason ?? "category_normalized", confidence: category.confidence})
    next.category = category.value
  }

  const gender = normalizeGenderField(product)
  confidences.push(gender.confidence)
  if (gender.needsReview) needsReview = true
  if (gender.reason) reasons.push(gender.reason)
  if (gender.value && JSON.stringify(gender.value) !== JSON.stringify(product.gender)) {
    changes.push({field: "gender", before: product.gender, after: gender.value, reason: gender.reason ?? "gender_normalized", confidence: gender.confidence})
    next.gender = gender.value
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
