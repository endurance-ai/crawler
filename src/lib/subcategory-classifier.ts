/**
 * Shared subcategory keyword maps + resolver.
 *
 * Single source of truth for "free text -> canonical Subcategory" used by:
 *   - shopify-category-classifier.ts (Shopify product_type/tags/title signal)
 *   - product-qc/normalization.ts (QC gate at crawl/import write time, all platforms)
 *   - subcategory-repair.ts (one-off backfill of already-imported rows)
 *
 * Canonical vocabulary is product-enums.ts SUBCATEGORIES — this module never
 * invents a value outside that list.
 */

import {isValidSubcategory, type Category} from "./enums/product-enums"
import {normalizeForMatch} from "./text-match"

export type SubcategoryMap = [RegExp, string][]

export const SUBCATEGORY_BY_CATEGORY: Record<Category, SubcategoryMap> = {
  // Every pattern below tolerates a trailing plural "s"/"es" — a bare
  // /\bskirt\b/ never matches "skirts" (no word-boundary between "t" and "s"),
  // which is exactly the class of bug that let "midi skirt(s)"/"miniskirts"/
  // etc. accumulate as distinct raw subcategory strings in the first place.
  tops: [
    [/\bhoodies?\b|\bzip[\s-]ups?\b/, "hoodie"],
    [/\bsweatshirts?\b/, "sweatshirt"],
    [/\bbodysuits?\b|\bleotards?\b/, "bodysuit"],
    [/\basymmetric(?:al)?\b/, "asymmetric-top"],
    [/\bcamisoles?\b|\bslip\s+tops?\b/, "camisole"],
    [/\bcrop[\s-]?tops?\b|\bcropped\s+tops?\b/, "crop-top"],
    [/\btank[\s-]?tops?\b|\btanks?\b|\bsleeveless\b/, "tank-top"],
    [/\bhenleys?\b/, "henley"],
    [/\bpolos?\b/, "polo"],
    [/\bblouses?\b/, "blouse"],
    [/\bt[\s-]?shirts?\b|\btees?\b/, "t-shirt"],
    [/\bshirts?\b/, "shirt"],
  ],
  knitwear: [
    // Before the "sweater" rule on purpose — "sweater vest" contains "sweater".
    [/\bvests?\b|\bsweater\s+vests?\b/, "sweater-vest"],
    [/\bturtlenecks?\b|\bmock[\s-]necks?\b|\broll[\s-]necks?\b/, "turtleneck"],
    [/\bcardigans?\b/, "cardigan"],
    [/\bpullovers?\b|\bcrewnecks?\b|\bcrew[\s-]necks?\b/, "pullover"],
    [/\bknit[\s-]?tops?\b/, "knit-top"],
    [/\bsweaters?\b|\bjumpers?\b|\bknits?\b/, "sweater"],
  ],
  bottoms: [
    // mini/midi/maxi may be fused onto "skirt" with no separator at all
    // ("miniskirts") as well as with a space/hyphen ("mini skirt(s)") — the
    // prefix+separator are modeled explicitly rather than relied on \b to
    // split them, mirroring dresses' \bmini[\s-]?dresses?\b below.
    [/\b(?:mini|midi|maxi)?[\s-]?skirts?\b/, "skirt"],
    [/\bleggings?\b/, "leggings"],
    // "sweat pants" (spaced) used to fall through to null; now the generic
    // "pants" rule below would swallow it, so the separator is modeled here.
    [/\bsweat[\s-]?pants?\b|\bfleece\s+pants?\b/, "sweatpants"],
    [/\bjoggers?\b|\btrack\s+pants?\b/, "joggers"],
    [/\bcargos?\b/, "cargo-pants"],
    [/\bwide[\s-](?:pants?|legs?|trousers)\b|\bpalazzos?\b/, "wide-pants"],
    [/\bshorts?\b/, "shorts"],
    [/\bchinos?\b|\bkhaki\s+pants?\b/, "chinos"],
    [/\bjeans?\b|\bdenim\s+pants?\b/, "jeans"],
    [/\btrousers?\b|\bdress\s+pants?\b|\bformal\s+pants?\b|\bslacks?\b/, "trousers"],
    // Generic catch-all — must stay last so every cut above wins first.
    // Do not match "bottoms": it is the broad category label, not evidence
    // that the product is specifically a pair of pants.
    [/\bpants?\b/, "pants"],
  ],
  dresses: [
    [/\bshirt[\s-]dresses?\b/, "shirt-dress"],
    [/\bwrap[\s-]dresses?\b/, "wrap-dress"],
    [/\bslip[\s-]dresses?\b/, "slip-dress"],
    [/\bknit[\s-]dresses?\b/, "knit-dress"],
    [/\bjumpsuits?\b|\brompers?\b/, "jumpsuit"],
    [/\bmini[\s-]?dresses?\b|\bminis?\b/, "mini-dress"],
    [/\bmidi[\s-]?dresses?\b|\bmidis?\b/, "midi-dress"],
    [/\bmaxi[\s-]?dresses?\b|\bmaxis?\b/, "maxi-dress"],
  ],
  // Order is priority — first match wins. Every rule added by the 2026-08-10
  // jacket split sits *before* the generic type it refines (varsity before
  // bomber, biker/suede/shearling before leather-jacket, quilted after
  // down-jacket), and the bare `jacket` catch-all is last on purpose: a name
  // with no style cue stays generic rather than being guessed into a subtype.
  outerwear: [
    [/\bovercoats?\b|\bwool\s+coats?\b|\btopcoats?\b|\btop\s+coats?\b/, "overcoat"],
    [/\btrenche?s?\b/, "trench-coat"],
    [/\banoraks?\b/, "anorak"],
    [/\bparkas?\b/, "parka"],
    [/\bvarsity\b|\blettermans?\b|\bbaseball\s+jackets?\b/, "varsity-jacket"],
    [/\bbombers?\b|ma-?1\b/, "bomber"],
    [/\bblazers?\b/, "blazer"],
    [/\bvests?\b|\bgilets?\b/, "vest"],
    [/\bbikers?\b|\bmotorcycle\b|\bmoto\s+jackets?\b|\bperfectos?\b/, "biker-jacket"],
    [/\bshearlings?\b/, "shearling-jacket"],
    [/\bsuede\b/, "suede-jacket"],
    [/\bleather\s+(?:jackets?|coats?)\b/, "leather-jacket"],
    [/\bdenim\s+jackets?\b|\bjean\s+jackets?\b|\btruckers?\b/, "denim-jacket"],
    [/\bchore\s+(?:jackets?|coats?)\b/, "chore-jacket"],
    [/\bharringtons?\b/, "harrington"],
    [/\bcoach\s+jackets?\b/, "coach-jacket"],
    [/\btrack\s+(?:jackets?|tops?)\b/, "track-jacket"],
    [/\bfield\s+jackets?\b|\bm-?65\b/, "field-jacket"],
    [/\bshackets?\b|\bshirt[\s-]jackets?\b|\bovershirts?\b/, "shirt-jacket"],
    // "quilted" only reaches its own bucket when the name carries no explicit
    // down/puffer/padded cue — a "quilted down jacket" stays down-jacket, which
    // is how every already-imported row was classified.
    [/\bdown\s+(?:jackets?|coats?|puffers?)\b|\bpuffers?\b|\bpadded\s+jackets?\b/, "down-jacket"],
    [/\bquilted\b/, "quilted-jacket"],
    [/\bwindbreakers?\b|\bwind\s+jackets?\b|\bshell\s+jackets?\b/, "windbreaker"],
    [/\b(?:faux[\s-])?furs?\b/, "fur-jacket"],
    [/\bfleece\b|\bpolar\b|\bsherpas?\b/, "fleece"],
    // Fabric, not silhouette — only reached once every cut above has missed,
    // so a wool bomber stays a bomber and a wool coat stays an overcoat.
    [/\bwool\b/, "wool-jacket"],
    [/\bjackets?\b/, "jacket"],
  ],
  underwear: [
    [/\bbras?\b|\bbralettes?\b/, "bra"],
    [/\bbriefs?\b|\bboxers?\b|\bpant(?:y|ies)\b|\bthongs?\b/, "briefs"],
  ],
  swimwear: [
    [/\bbikinis?\b/, "bikini"],
    [/\btrunks?\b|\bboard\s+shorts?\b/, "trunks"],
    [/\bswimsuits?\b|\bswims?\b|\bone[\s-]pieces?\b|\brashguards?\b|\brash\s+guards?\b/, "swimsuit"],
  ],
  activewear: [
    [/\bsports\s*bras?\b/, "sports-bra"],
    [/\bathletic\s+shorts?\b|\brunning\s+shorts?\b|\bgym\s+shorts?\b/, "athletic-shorts"],
    [/\btracksuits?\b|\btrack\s+suits?\b|\bjogging\s+suits?\b/, "tracksuit"],
  ],
  shoes: [
    [/\brunning\b|\btrails?\b|\brunners?\b/, "running-shoes"],
    [/\bflip[\s-]?flops?\b|\bthong\s+sandals?\b/, "flip-flops"],
    [/\bsandals?\b/, "sandals"],
    [/\bslides?\b/, "slides"],
    [/\bmules?\b|\bclogs?\b/, "mules"],
    [/\bpumps?\b|\bheels?\b/, "heels"],
    [/\bballet\s+flats?\b|\bflat\s+shoes?\b|\bflats?\b/, "flats"],
    [/\bloafers?\b|\bpenn(?:y|ies)\b|\bhorsebits?\b/, "loafers"],
    [/\bderb(?:y|ies)\b|\brogues?\b/, "derby"],
    [/\boxford\s+shoes?\b|\boxfords?\b/, "oxford"],
    [/\bboots?\b/, "boots"],
    [/\bsneakers?\b|\btrainers?\b/, "sneakers"],
  ],
  bags: [
    [/\bcamera\s*bags?\b/, "camera-bag"],
    [/\bbackpacks?\b|\brucksacks?\b/, "backpack"],
    [/\bbelt[\s-]bags?\b|\bfann(?:y|ies)\b|\bbum\s+bags?\b|\bwaist\s+bags?\b/, "belt-bag"],
    [/\bmessengers?\b|\bsatchels?\b/, "messenger"],
    [/\bbuckets?\b/, "bucket-bag"],
    [/\bclutch(?:es)?\b|\bpouch(?:es)?\b/, "clutch"],
    [/\bcrossbod(?:y|ies)\b|\bcross[\s-]bod(?:y|ies)\b|\bshoulder\s+straps?\b/, "crossbody"],
    [/\bshoulder[\s-]bags?\b/, "shoulder-bag"],
    [/\btotes?\b/, "tote"],
    [/\bhobos?\b/, "hobo-bag"],
    // Size and generic shape come last — a "mini crossbody" is a crossbody.
    [/\bmini[\s-]?bags?\b/, "mini-bag"],
    [/\bhandbags?\b/, "handbag"],
  ],
  accessories: [
    [/\bphone\s*cases?\b|\biphone\s+cases?\b/, "phone-case"],
    [/\bwatch(?:es)?\b/, "watch"],
    [/\bscarf\b|\bscarves\b|\bmufflers?\b/, "scarf"],
    [/\bbelts?\b/, "belt"],
    [/(?<!hair )\bties?\b|\bneckties?\b|\bbow\s+ties?\b/, "tie"],
    [/\bgloves?\b|\bmittens?\b/, "gloves"],
    [/\bsocks?\b|\bhosiery\b/, "socks"],
  ],
  eyewear: [
    [/\bsunglass(?:es)?\b/, "sunglasses"],
    [/\bglasses\b|\beyeglass(?:es)?\b|\boptical\b/, "glasses"],
  ],
  jewelry: [
    [/\bnecklaces?\b|\bchains?\b|\bpendants?\b/, "necklace"],
    [/\bbracelets?\b|\bbangles?\b|\bcuffs?\b|\banklets?\b/, "bracelet"],
    [/\bearrings?\b/, "earrings"],
    [/\brings?\b/, "ring"],
  ],
  headwear: [
    [/\bbeanies?\b|\bbalaclavas?\b/, "beanie"],
    [/\bberets?\b/, "beret"],
    [/\bbucket\s+hats?\b/, "bucket-hat"],
    [/\bcaps?\b|\bbaseball\s+caps?\b|\bsnapbacks?\b|\bdad\s+hats?\b/, "cap"],
    [/\bhats?\b/, "hat"],
  ],
  other: [],
}

export function matchSubcategory(category: Category, text: string): string | undefined {
  for (const [re, sub] of SUBCATEGORY_BY_CATEGORY[category]) {
    if (re.test(text)) return sub
  }
  return undefined
}

export type SubcategoryResolutionReason =
  | "canonicalized"
  | "text_fallback"
  | "noncanonical_dropped"
  | "no_category"
  | null

export interface SubcategoryResolution {
  /** Canonical SUBCATEGORIES[category] member, or null when unresolved/inapplicable. */
  value: string | null
  reason: SubcategoryResolutionReason
}

/**
 * Resolve a raw subcategory string (whatever a site's breadcrumb/menu label
 * happened to say — plural, "mini skirt"/"midi skirt" variants, typos, etc.)
 * against the canonical per-category vocabulary.
 *
 * Canonical-strict, mirroring normalizeCategoryField's policy for `category`:
 * output is a SUBCATEGORIES[category] member or null, never the raw noise —
 * a stray "mini check skirt" value would otherwise fragment search filters.
 * subcategory is optional (unlike category), so unresolved never blocks import.
 */
export function resolveSubcategory(
  rawSubcategory: string | null | undefined,
  category: Category | null,
  fallbackText = "",
): SubcategoryResolution {
  const raw = typeof rawSubcategory === "string" ? rawSubcategory.trim() : ""

  if (!category || category === "other") {
    return {value: null, reason: raw ? "no_category" : null}
  }

  if (raw && isValidSubcategory(raw, category)) {
    return {value: raw, reason: null}
  }

  // Product titles commonly use `_`/`-` as colour delimiters. Regex word
  // boundaries treat `_` as a word character, so normalize them to spaces
  // before matching (for example `SHIRTS_IVORY`, `S/S TEE_BLACK`).
  const text = normalizeForMatch(`${raw} ${fallbackText}`)
  const inferred = matchSubcategory(category, text)
  if (inferred) return {value: inferred, reason: raw ? "canonicalized" : "text_fallback"}

  if (raw) return {value: null, reason: "noncanonical_dropped"}
  return {value: null, reason: null}
}
