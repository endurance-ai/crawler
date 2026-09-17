/**
 * Legacy sources whose `unisex` value was historically used as "unknown".
 * Keep this list shared by the one-off repair tools and the listing refresher,
 * otherwise a price/stock refresh can silently reactivate quarantined rows.
 */

export const EDIT_SHOP_GENDER_RECLASSIFIED_SITES = new Set([
  "8division",
  "slowsteadyclub",
  "etcseoul",
  "fr8ight",
  "kith",
])

export const HISTORICAL_BLANKET_UNISEX_SITES = new Set([
  "sculpstore",
  "takeastreet",
  "chanceclothing",
  "havati",
  "blankroom",
  "taats",
  "franksupply",
  "nnpcs",
  "seygun",
  "demoshop",
])

const ALWAYS_UNVERIFIED_SOURCES = new Set<string | null>([
  null,
  "unverified_legacy",
  "legacy_backfill",
  "brand_scope",
  "repair_brand_scope",
])

export function isUnverifiedUnisexRow(input: {
  platform: string
  gender: string[] | null
  genderSource: string | null
  verifiedUnisexDefault: boolean
}): boolean {
  if (input.gender?.length !== 1 || input.gender[0] !== "unisex") return false
  if (ALWAYS_UNVERIFIED_SOURCES.has(input.genderSource)) return true
  if (input.genderSource === "config_default") return !input.verifiedUnisexDefault
  return input.genderSource === "engine"
    && (
      EDIT_SHOP_GENDER_RECLASSIFIED_SITES.has(input.platform)
      || HISTORICAL_BLANKET_UNISEX_SITES.has(input.platform)
    )
}
