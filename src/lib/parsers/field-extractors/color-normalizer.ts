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
// 2026-07-28: added the block of entries under each "// NEW 2026-07-28"
// marker below to re-sync this list with product-qc/normalization.ts's
// COLOR_RULES, which had drifted apart (this file already recognized Teal/
// Mint/Coral/Mustard/Rust/Cobalt/Forest Green as their own colors while the
// QC-gate list didn't — those, plus dozens of others confirmed against real
// DB samples, are now added here so a Cafe24 detail-page value never gets
// recognized at parse time only to hit the same unresolved gap again at the
// QC gate). Deliberately NOT split into the finer Sky Blue/Light Blue/Dark
// Blue/Cobalt-vs-Blue granularity that normalization.ts now uses — this
// file's own header docstring states its policy as "unify casing and
// synonyms", i.e. merge-for-simplicity, which is a different and equally
// valid intent from the QC gate's "detailed granularity is the point of
// this pass". Respecting each file's own stated policy rather than forcing
// identical output granularity is the right call; what actually matters for
// "sync" is that no color word recognized by one gate is a total miss (title
// -cased garbage) at the other, which this closes.
const CANONICAL: [RegExp, string][] = [
  // Neutrals
  [/\bblack\b|블랙|검정|blackout|\bblk\b/i,                    "Black"],
  [/\bwhite\b|화이트|흰/i,                                     "White"],
  [/\bonyx\b/i,                                                "Onyx"],  // NEW 2026-07-28
  [/\bcrow\b|크로우/i,                                         "Crow"],  // NEW 2026-07-28
  [/\bink\b/i,                                                 "Ink"],  // NEW 2026-07-28
  [/\b(off[-\s]white|offwhite|ivory|ecru)\b|아이보리|크림/i,   "Ivory"],
  [/\b(cream)\b/i,                                             "Cream"],
  [/\bvanilla\b/i,                                             "Vanilla"],  // NEW 2026-07-28
  [/\bpearl\b/i,                                                "Pearl"],  // NEW 2026-07-28
  [/\b(charcoal)\b|차콜/i,                                     "Charcoal"],
  [/\b(gr[ae]y)\b|그레이|회색/i,                               "Grey"],
  [/\bchalk\b/i,                                                "Chalk"],  // NEW 2026-07-28
  [/\bcement\b/i,                                               "Cement"],  // NEW 2026-07-28
  [/\bmist\b/i,                                                 "Mist"],  // NEW 2026-07-28
  [/\bfog\b/i,                                                  "Fog"],  // NEW 2026-07-28
  [/\bice\b/i,                                                  "Ice"],  // NEW 2026-07-28
  [/\bheather\s*gr[ae]y\b/i,                                    "Heather Grey"],  // NEW 2026-07-28
  [/\bsteel\b/i,                                                "Steel"],  // NEW 2026-07-28
  [/\bnatural\b/i,                                              "Natural"],  // NEW 2026-07-28
  [/\bbone\b/i,                                                 "Bone"],  // NEW 2026-07-28
  [/\bcoconut\s*milk\b/i,                                       "Coconut Milk"],  // NEW 2026-07-28
  [/\bbeige\b|베이지/i,                                        "Beige"],
  [/\b(sand|stone|oatmeal|oat)\b/i,                            "Sand"],
  [/\bdune\b/i,                                                 "Dune"],  // NEW 2026-07-28
  [/\bmushroom\b/i,                                             "Mushroom"],  // NEW 2026-07-28
  [/\b(camel)\b|카멜/i,                                        "Camel"],
  [/\bcaramel\b/i,                                              "Caramel"],  // NEW 2026-07-28
  [/\b(tan)\b/i,                                               "Tan"],
  [/\b(khaki)\b|카키/i,                                        "Khaki"],
  [/\bmink\b/i,                                                 "Mink"],  // NEW 2026-07-28

  // Browns
  [/\b(brown|chocolate|espresso)\b|브라운|갈색|초콜렛/i,       "Brown"],
  [/\bmocha\b/i,                                                "Mocha"],  // NEW 2026-07-28
  [/\bchestnut\b/i,                                             "Chestnut"],  // NEW 2026-07-28
  [/\bcognac\b/i,                                               "Cognac"],  // NEW 2026-07-28
  [/\btobacco\b/i,                                              "Tobacco"],  // NEW 2026-07-28
  [/\bmud\b|머드/i,                                             "Mud"],  // NEW 2026-07-28
  [/\b(burgundy|wine|maroon)\b|버건디|와인/i,                  "Burgundy"],
  [/\bbrick\b/i,                                                "Brick"],  // NEW 2026-07-28

  // Blues
  [/\bnavy\b|네이비|곤색|감색/i,                               "Navy"],
  [/\bindigo\b|인디고|\bidg\b/i,                                "Indigo"],
  [/\b(cobalt|royal\s*blue)\b/i,                               "Cobalt"],
  [/\b(sky\s*blue|skyblue)\b|블루|파랑|소라|하늘색|스카이/i,   "Blue"],
  [/\bblue\b/i,                                                "Blue"],
  [/\b(teal|turquoise|aqua)\b/i,                               "Teal"],
  [/\bmint\b|민트/i,                                           "Mint"],
  [/\bblueberry\b/i,                                            "Blueberry"],  // NEW 2026-07-28

  // Greens
  [/\b(olive)\b|올리브/i,                                      "Olive"],
  [/\bpistachio\b/i,                                            "Pistachio"],  // NEW 2026-07-28
  [/\blime\b/i,                                                 "Lime"],  // NEW 2026-07-28
  [/\bmelange\b|멜란지/i,                                       "Melange"],  // NEW 2026-07-28
  [/\bgraphite\b/i,                                             "Graphite"],  // NEW 2026-07-28
  [/\b(forest|hunter|military)\s*green\b/i,                    "Forest Green"],
  [/\bpine\b/i,                                                 "Pine"],  // NEW 2026-07-28
  [/\bmoss\b/i,                                                 "Moss"],  // NEW 2026-07-28
  [/\bemerald\b/i,                                              "Emerald"],  // NEW 2026-07-28
  [/\bjade\b/i,                                                 "Jade"],  // NEW 2026-07-28
  [/\bgreen\b|그린|녹색/i,                                     "Green"],

  // Reds / Pinks
  [/\b(burgundy|crimson|scarlet)\b|자주/i,                     "Burgundy"],
  [/\bruby\b/i,                                                 "Ruby"],  // NEW 2026-07-28
  [/\bred\b|레드|빨강|다홍/i,                                  "Red"],
  [/\b(pink|blush|rose)\b|핑크|분홍/i,                        "Pink"],
  [/\b(coral)\b|코랄/i,                                        "Coral"],
  [/\bpeach\b/i,                                                "Peach"],  // NEW 2026-07-28
  [/\bsalmon\b/i,                                               "Salmon"],  // NEW 2026-07-28

  // Purples
  [/\b(purple|lavender|violet|lilac)\b|퍼플|보라|라벤더/i,    "Purple"],
  [/\bplum\b/i,                                                 "Plum"],  // NEW 2026-07-28
  [/\bmauve\b/i,                                                "Mauve"],  // NEW 2026-07-28

  // Yellows / Oranges
  [/\b(mustard)\b/i,                                           "Mustard"],
  [/\bbutter\b/i,                                               "Butter"],  // NEW 2026-07-28
  [/\blemon\b/i,                                                "Lemon"],  // NEW 2026-07-28
  [/\byellow\b|옐로|노랑/i,                                    "Yellow"],
  [/\b(rust|terracotta|burnt\s*orange)\b/i,                    "Rust"],
  [/\borange\b|오렌지|주황/i,                                  "Orange"],

  // Metallics
  [/\b(silver)\b|실버|은색/i,                                  "Silver"],
  [/\b(gold)\b|골드|금색/i,                                    "Gold"],
  [/\bbrass\b/i,                                                "Brass"],  // NEW 2026-07-28
  [/\bbronze\b/i,                                               "Bronze"],  // NEW 2026-07-28

  // Prints/materials that function as de-facto colors in retail listings
  // (same rationale as normalization.ts's COLOR_RULES: Denim/Stripe/Printed
  // deliberately NOT included — Denim spans too many actual colors to trust
  // as a text-fallback signal, and Stripe/Printed describe pattern, not hue).
  [/\bcamo\b|\bcamouflage\b/i,                                  "Camo"],  // NEW 2026-07-28
  [/\bleopard\b/i,                                              "Leopard"],  // NEW 2026-07-28

  // Special
  [/\b(multicolor|multicolour|multicolore|multi-color|multi-colour|multicolored|multicoloured)\b/i, "Multi"],
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
  if (/^null$/i.test(t)) return true
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
  // 2026-07-28: spelled-out sizes ("Small"/"Medium"/"Large" — only s/m/l
  // abbreviations were covered above), a dotted "O.s" variant of "os", bare
  // "one" (previously only "one size" matched), "sm"/"ml"/"md"/"lg" (merged
  // abbreviations), bare "ss" (a spring/summer season-collection code), and
  // Roman numeral size tiers I–X (Korean sites commonly use 사이즈 Ⅰ/Ⅱ/Ⅲ
  // instead of S/M/L) — same real-DB findings as normalization.ts's
  // SIZE_TOKEN_RE, mirrored here since this function runs earlier, at parse
  // time, on the same kind of raw option-list tokens.
  if (/^o\.?s\.?$/i.test(t)) return true
  if (/^one$/i.test(t)) return true
  if (/^(small|medium|large|extra\s*small|extra\s*large)$/i.test(t)) return true
  if (/^(sm|ml|md|lg|ss)$/i.test(t)) return true
  if (/^(i{1,3}|iv|vi{0,3}|ix|x)$/i.test(t)) return true
  // "SIZE" / "Size, 43cm, 45cm" / "Size, US 5.5, US 6.5" — the literal word "size"
  // (any case) as the whole token or leading token, not just abbreviations like
  // S/M/L (2026-07-06: rollingstudios/enlowool/leete/waineke/jungdo onboarding).
  if (/^(size|사이즈)\b/i.test(t)) return true
  if (/사이즈\s*기준/.test(t)) return true
  if (/품절|sold\s*out|재고|low in stock|restock/i.test(t)) return true
  if (/[+-]\s*₩[\d,]+/.test(t)) return true
  // 2026-07-28: discount/return-policy disclaimer tokens leaking into the
  // color option list whole — "Sale, 세일 상품은 교환, 환불이 어렵습니다" and
  // "Notice, 액세서리 상품 특성상 교환 환불이 불가능합니다" variants.
  if (/^sale$/i.test(t)) return true
  if (/^notice$/i.test(t)) return true
  if (/교환|환불|동의/.test(t)) return true
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
