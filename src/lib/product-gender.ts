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

export function resolveProductGender(productGender: unknown, brandGenderScope: unknown): ProductGender[] {
  const fromProduct = cleanGenderScope(productGender)
  return fromProduct.length > 0 ? fromProduct : cleanGenderScope(brandGenderScope)
}
