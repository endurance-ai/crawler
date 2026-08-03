export const PRODUCT_GENDER_VALUES = ["men", "women", "unisex"] as const

const PRODUCT_GENDER_SET = new Set<string>(PRODUCT_GENDER_VALUES)

export type ProductGender = (typeof PRODUCT_GENDER_VALUES)[number]
export type ProductGenderSource =
  | "engine"
  | "config_default"
  | "brand_scope"
  | "text"
  | "url"
  | "unverified_legacy"

export interface ResolvedProductGender {
  gender: ProductGender[]
  source: ProductGenderSource | null
}

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

export function resolveProductGender(productGender: unknown, brandGenderScope: unknown): ProductGender[] {
  return resolveProductGenderWithSource(productGender, brandGenderScope).gender
}

export function resolveProductGenderWithSource(
  productGender: unknown,
  brandGenderScope: unknown,
  productSource: ProductGenderSource = "unverified_legacy",
): ResolvedProductGender {
  const fromProduct = cleanGenderScope(productGender)
  if (fromProduct.length > 0) return {gender: fromProduct, source: productSource}
  const fromBrand = cleanGenderScope(brandGenderScope)
  return {
    gender: fromBrand,
    source: fromBrand.length > 0 ? "brand_scope" : null,
  }
}
