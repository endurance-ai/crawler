/**
 * Color normalization and text-based extraction utilities.
 *
 * Two responsibilities:
 *  1. normalizeColor / normalizeColorList — unify casing and synonyms so
 *     "Yellow", "yellow", "YELLOW" all map to "Yellow".
 *  2. extractColorFromText — keyword scan of product name / tags /
 *     description for platforms where option-based extraction returns null.
 *
 * Synonym policy: only merge *exact* duplicates (grey/gray, colour/color).
 *   Distinct named colors (Charcoal, Mustard, Camel) are preserved as-is
 *   to avoid search-quality loss from over-merging.
 */

// ---------------------------------------------------------------------------
// Canonical color map — shared source for both normalization and extraction.
// Order matters: first match wins. More specific patterns must come before
// broader ones (e.g. "navy" before "blue").
// ---------------------------------------------------------------------------
// Note: \b (word boundary) does not work with Korean characters because Korean
// chars are not \w chars. Patterns that mix English and Korean must keep the
// Korean alternatives outside the \b()  group.
const CANONICAL: [RegExp, string][] = [
  // Neutrals
  [/\bblack\b|블랙|검정/i,                                    "Black"],
  [/\bwhite\b|화이트|흰/i,                                     "White"],
  [/\b(off[-\s]white|offwhite|ivory|ecru)\b|아이보리|크림/i,   "Ivory"],
  [/\b(cream)\b/i,                                             "Cream"],
  [/\b(charcoal)\b|차콜/i,                                     "Charcoal"],
  [/\b(gr[ae]y)\b|그레이|회색/i,                               "Grey"],
  [/\bbeige\b|베이지/i,                                        "Beige"],
  [/\b(sand|stone|oatmeal|oat)\b/i,                            "Sand"],
  [/\b(camel)\b|카멜/i,                                        "Camel"],
  [/\b(tan)\b/i,                                               "Tan"],
  [/\b(khaki)\b|카키/i,                                        "Khaki"],

  // Browns
  [/\b(brown|chocolate|espresso)\b|브라운|갈색/i,              "Brown"],
  [/\b(burgundy|wine|maroon)\b|버건디|와인/i,                  "Burgundy"],

  // Blues
  [/\bnavy\b|네이비|곤색|감색/i,                               "Navy"],
  [/\bindigo\b|인디고/i,                                       "Indigo"],
  [/\b(cobalt|royal\s*blue)\b/i,                               "Cobalt"],
  [/\b(sky\s*blue|skyblue)\b|블루|파랑|소라|하늘색|스카이/i,   "Blue"],
  [/\bblue\b/i,                                                "Blue"],
  [/\b(teal|turquoise|aqua)\b/i,                               "Teal"],
  [/\bmint\b|민트/i,                                           "Mint"],

  // Greens
  [/\b(olive)\b|올리브/i,                                      "Olive"],
  [/\b(forest|hunter|military)\s*green\b/i,                    "Forest Green"],
  [/\bgreen\b|그린|녹색/i,                                     "Green"],

  // Reds / Pinks
  [/\b(burgundy|crimson|scarlet)\b|자주/i,                     "Burgundy"],
  [/\bred\b|레드|빨강|다홍/i,                                  "Red"],
  [/\b(pink|blush|rose)\b|핑크|분홍/i,                        "Pink"],
  [/\b(coral)\b|코랄/i,                                        "Coral"],

  // Purples
  [/\b(purple|lavender|violet|lilac)\b|퍼플|보라|라벤더/i,    "Purple"],

  // Yellows / Oranges
  [/\b(mustard)\b/i,                                           "Mustard"],
  [/\byellow\b|옐로|노랑/i,                                    "Yellow"],
  [/\b(rust|terracotta|burnt\s*orange)\b/i,                    "Rust"],
  [/\borange\b|오렌지|주황/i,                                  "Orange"],

  // Metallics
  [/\b(silver)\b|실버|은색/i,                                  "Silver"],
  [/\b(gold)\b|골드|금색/i,                                    "Gold"],

  // Special
  [/\b(multicolor|multicolour|multicolore|multi-color|multi-colour)\b/i, "Multi"],
]

// ---------------------------------------------------------------------------
// normalizeColor
// ---------------------------------------------------------------------------

/**
 * Normalize a single raw color token to its canonical Title Case form.
 *
 * Examples:
 *   "YELLOW"          → "Yellow"
 *   "gray"            → "Grey"
 *   "PIGMENT CHARCOAL"→ "Charcoal"
 *   "블랙"             → "Black"
 *   "네이비"            → "Navy"
 *   "off-white"       → "Ivory"
 */
export function normalizeColor(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  for (const [re, canonical] of CANONICAL) {
    if (re.test(s)) return canonical
  }
  // Fallback: Title Case each word
  return s
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

// ---------------------------------------------------------------------------
// normalizeColorList
// ---------------------------------------------------------------------------

/**
 * Normalize a comma-separated multi-color string.
 *
 * "WHITE, black, NAVY" → "White, Black, Navy"
 */
export function normalizeColorList(raw: string): string {
  return raw
    .split(",")
    .map((s) => normalizeColor(s.trim()))
    .filter(Boolean)
    .join(", ")
}

/**
 * Normalize live Cafe24 detail option text before assigning it to Product.color.
 *
 * Kept separate from normalizeColorList() because the characterization goldens
 * intentionally preserve legacy parser outputs like "Free" / "One Size".
 */
export function normalizeCafe24DetailColorList(raw: string): string {
  return raw
    .split(",")
    .map((s) => cleanColorOptionToken(s))
    .filter((s) => s && !isNonColorOptionText(s))
    .map((s) => normalizeColor(s))
    .filter(Boolean)
    .join(", ")
}

function cleanColorOptionToken(raw: string): string {
  let t = raw.trim().replace(/\s+/g, " ")
  if (!t) return t

  // Cafe24 option headers are often concatenated into the option list as
  // "색상-사이즈, off white-FREE"; keep only the actual color tokens.
  t = t.replace(/^(?:색상|컬러|color|colour)\s*[-/:：]?\s*(?:사이즈|size)?\s*$/i, "")
  t = t.replace(/^(?:색상|컬러|color|colour)\s*[-/:：]\s*/i, "")
  t = t.replace(
    /\s*[-/]\s*(?:free|one\s*size|os|f|xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl)\s*(?:\[[^\]]*\]|\([^)]*\))?\s*$/i,
    "",
  )
  return t.trim()
}

// ---------------------------------------------------------------------------
// isNonColorOptionText
// ---------------------------------------------------------------------------

/**
 * True when a scraped option/select token is clearly SIZE, stock-status, or
 * price-adjustment noise rather than a color — e.g. "ONE SIZE", "1(low in
 * stock) [sold out]", "2 (+₩5,000)", "M", "품절". Single-brand Cafe24 malls
 * without a dedicated color <select> reuse option1 for these, and the
 * default color-option scraper (base-detail-parser.ts) was mistaking them
 * for color values (2026-07-06: demoshop/franksupply/hamsaseyo/piscess/
 * seygun onboarding).
 *
 * Used to reject noise tokens *before* accepting a scraped option list as
 * color, so extraction falls through to the next selector / product-name
 * fallback instead of writing garbage into the color field.
 */
export function isNonColorOptionText(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^empty$/i.test(t)) return true
  if (/^(?:color|colour|색상|컬러)\s*[-/:：]?\s*(?:size|사이즈)?$/i.test(t)) return true
  if (/^\d+$/.test(t)) return true
  if (/^\d+\s*(size|사이즈)$/i.test(t)) return true
  // Numeric value + size unit: "36 EU", "38 eu", "US 6.5", "UK 9", "43cm", "270mm".
  // Shopify stores using a non-recognized size-option name (e.g. Spanish "Talla")
  // otherwise leak these into the color field (2026-07-07: becay onboarding —
  // "36 Eu, 38 Eu, ..." captured as color on jeans whose real color is in the name).
  if (/^\d+(\.\d+)?\s*(eu|us|uk|cm|mm|inch|in)\b/i.test(t)) return true
  if (/^(us|uk|eu)\s*\d/i.test(t)) return true
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|f|free|os|one\s*size)$/i.test(t)) return true
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl)\s*[/(]/i.test(t)) return true
  // "SIZE" / "Size, 43cm, 45cm" / "Size, US 5.5, US 6.5" — the literal word "size"
  // (any case) as the whole token or leading token, not just abbreviations like
  // S/M/L (2026-07-06: rollingstudios/enlowool/leete/waineke/jungdo onboarding).
  if (/^(size|사이즈)\b/i.test(t)) return true
  if (/사이즈\s*기준/.test(t)) return true
  if (/품절|sold\s*out|재고|low in stock/i.test(t)) return true
  if (/[+-]\s*₩[\d,]+/.test(t)) return true
  return false
}

// ---------------------------------------------------------------------------
// extractColorFromText
// ---------------------------------------------------------------------------

/**
 * Scan plain text (product name, tags, description) for the first matching
 * color keyword and return the canonical name.
 *
 * Returns null when no color keyword is found.
 */
export function extractColorFromText(text: string): string | null {
  if (!text) return null
  for (const [re, canonical] of CANONICAL) {
    if (re.test(text)) return canonical
  }
  return null
}
