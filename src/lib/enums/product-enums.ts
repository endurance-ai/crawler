// Centralized product enum definitions — single source of truth
// Used by: prompts (analyze, prompt-search), search engine, batch analyzer

// ─── Categories (families) ───────────────────────────────
// Frozen vocabulary shared with the search path (Vision/RPC). The crawler emits
// exactly these tokens so both halves meet on the same words. Fashion families
// give precision at the subcategory level (e.g. sneakers vs boots live under
// `shoes`), so the family count stays small. Non-fashion / unclassifiable → `other`.

export const CATEGORIES = [
  "tops", "knitwear", "bottoms", "dresses", "outerwear",
  "underwear", "swimwear", "activewear",
  "shoes", "bags", "accessories", "eyewear", "jewelry", "headwear",
  "other",
] as const
export type Category = (typeof CATEGORIES)[number]

// ─── Subcategories ───────────────────────────────────────
// One vocabulary per family. `other` carries no subcategory.

export const SUBCATEGORIES = {
  tops: [
    "t-shirt", "shirt", "blouse", "polo", "hoodie", "sweatshirt",
    "tank-top", "crop-top", "henley", "camisole",
    "bodysuit", "asymmetric-top",
  ],
  knitwear: [
    "sweater", "cardigan", "pullover", "knit-top", "turtleneck",
    "sweater-vest",
  ],
  bottoms: [
    "jeans", "trousers", "chinos", "shorts", "skirt", "joggers",
    "cargo-pants", "wide-pants", "leggings", "sweatpants",
    // Generic last resort, same role as outerwear's "jacket": "pants" with no
    // cut/fabric cue was previously dropped to null (실측 7,478행), which reads
    // as "no data" when the truth is "bottoms, type unknown".
    "pants",
  ],
  dresses: [
    "mini-dress", "midi-dress", "maxi-dress", "shirt-dress",
    "wrap-dress", "slip-dress", "knit-dress", "jumpsuit",
  ],
  // 2026-08-10 jacket 세분화: 아래 두 줄(기존 11종)은 **한 글자도 바꾸지 않는다**.
  // 세분화는 순수 추가(additive)였다 — 기존 토큰의 의미도 철자도 유지되므로
  // 이미 적재된 행은 재분류 없이 그대로 유효하고, 되돌리려면 추가분만 지우면 된다.
  // 세 번째 줄부터가 추가분이며, 마지막 "jacket" 은 단서가 없을 때의 안전한
  // 상위값이다 (오분류보다 generic 유지가 낫다 — 실측 28%가 여기 남는다).
  outerwear: [
    "overcoat", "trench-coat", "parka", "bomber", "blazer", "vest",
    "leather-jacket", "denim-jacket", "down-jacket", "windbreaker", "fleece",
    "varsity-jacket", "biker-jacket", "suede-jacket", "shearling-jacket",
    "fur-jacket", "quilted-jacket", "coach-jacket", "track-jacket",
    "field-jacket", "chore-jacket", "wool-jacket",
    "harrington", "anorak", "shirt-jacket",
    "jacket",
  ],
  underwear: [
    "briefs", "bra",
  ],
  swimwear: [
    "swimsuit", "bikini", "trunks",
  ],
  activewear: [
    "tracksuit", "sports-bra", "athletic-shorts",
  ],
  shoes: [
    "sneakers", "boots", "loafers", "derby", "oxford", "sandals",
    "mules", "heels", "flats", "slides", "running-shoes", "flip-flops",
  ],
  bags: [
    "tote", "crossbody", "backpack", "clutch", "shoulder-bag",
    "belt-bag", "messenger", "bucket-bag",
    "mini-bag", "hobo-bag", "camera-bag", "handbag",
  ],
  accessories: [
    "scarf", "belt", "watch", "tie", "gloves", "socks", "phone-case",
  ],
  eyewear: [
    "sunglasses", "glasses",
  ],
  jewelry: [
    "necklace", "bracelet", "ring", "earrings",
  ],
  headwear: [
    "hat", "cap", "beanie", "beret", "bucket-hat",
  ],
  other: [],
} as const satisfies Record<Category, readonly string[]>

export type Subcategory = (typeof SUBCATEGORIES)[Category][number]
export const ALL_SUBCATEGORIES: readonly string[] = (
  Object.values(SUBCATEGORIES) as readonly (readonly string[])[]
).flat()

// ─── Fits ────────────────────────────────────────────────

export const FITS = [
  "oversized", "relaxed", "regular", "slim", "skinny", "boxy", "cropped", "longline",
] as const
export type Fit = (typeof FITS)[number]

// ─── Fabrics ─────────────────────────────────────────────

export const FABRICS = [
  "cotton", "wool", "linen", "silk", "denim", "leather", "suede",
  "nylon", "polyester", "cashmere", "corduroy", "fleece", "tweed",
  "jersey", "knit", "mesh", "satin", "chiffon", "velvet", "canvas",
  "gore-tex", "ripstop",
] as const
export type Fabric = (typeof FABRICS)[number]

// ─── Color Families ──────────────────────────────────────

export const COLOR_FAMILIES = [
  "BLACK", "WHITE", "GREY", "NAVY", "BLUE", "BEIGE", "BROWN", "GREEN",
  "RED", "PINK", "PURPLE", "ORANGE", "YELLOW", "CREAM", "KHAKI", "MULTI",
] as const
export type ColorFamily = (typeof COLOR_FAMILIES)[number]

// ─── Validation ──────────────────────────────────────────

export function isValidCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v)
}

export function isValidSubcategory(v: string, category?: Category): boolean {
  if (category) {
    return (SUBCATEGORIES[category] as readonly string[]).includes(v)
  }
  return ALL_SUBCATEGORIES.includes(v)
}

export function isValidFit(v: string): v is Fit {
  return (FITS as readonly string[]).includes(v)
}

export function isValidFabric(v: string): v is Fabric {
  return (FABRICS as readonly string[]).includes(v)
}

export function isValidColorFamily(v: string): v is ColorFamily {
  return (COLOR_FAMILIES as readonly string[]).includes(v)
}

// ─── Prompt Builder ──────────────────────────────────────

/**
 * "category: [subcategory, ...]" 블록만 뽑은 레퍼런스. buildEnumReference() 의
 * 일부이자, subcategory 만 필요한 다른 프롬프트(예: qwen-product-enrichment.ts)
 * 가 fit/fabric/color_family 까지 포함한 전체 블록을 복제하지 않고 재사용하는 용도.
 */
export function buildSubcategoryReference(): string {
  return (Object.entries(SUBCATEGORIES) as [Category, readonly string[]][])
    .filter(([, subs]) => subs.length > 0)
    .map(([cat, subs]) => `  ${cat}: ${subs.join(", ")}`)
    .join("\n")
}

/** AI 프롬프트에 주입할 enum 레퍼런스 텍스트 생성 */
export function buildEnumReference(): string {
  return `category (pick one; use "other" for non-fashion / unclassifiable items):
  ${CATEGORIES.join(", ")}

subcategory by category (null if none fits):
${buildSubcategoryReference()}

fit (pick one):
  ${FITS.join(", ")}

fabric (pick one primary):
  ${FABRICS.join(", ")}

color_family (pick one):
  ${COLOR_FAMILIES.join(", ")}`
}
