import {cleanGenderScope, type GenderSource} from "./product-gender"

export interface BrandGenderProductEvidence {
  id?: number | string
  gender: unknown
  gender_source: string | null
}

export interface BrandGenderEvidenceSummary {
  trustedMen: number
  trustedWomen: number
  trustedUnisex: number
  ignored: number
  sampleMenProductIds: Array<number | string>
  sampleWomenProductIds: Array<number | string>
  sampleUnisexProductIds: Array<number | string>
}

/** Site-wide defaults and legacy brand fallbacks are not product evidence. */
export const TRUSTED_BRAND_SCOPE_PRODUCT_SOURCES = new Set<GenderSource>([
  "engine",
  "url",
  "text",
  "repair_url",
  "repair_text",
])

export function summarizeTrustedBrandGenderEvidence(
  products: BrandGenderProductEvidence[],
): BrandGenderEvidenceSummary {
  const summary: BrandGenderEvidenceSummary = {
    trustedMen: 0,
    trustedWomen: 0,
    trustedUnisex: 0,
    ignored: 0,
    sampleMenProductIds: [],
    sampleWomenProductIds: [],
    sampleUnisexProductIds: [],
  }

  for (const product of products) {
    if (!product.gender_source || !TRUSTED_BRAND_SCOPE_PRODUCT_SOURCES.has(product.gender_source as GenderSource)) {
      summary.ignored++
      continue
    }
    const gender = cleanGenderScope(product.gender)
    if (gender.includes("men")) {
      summary.trustedMen++
      if (product.id !== undefined && summary.sampleMenProductIds.length < 10) summary.sampleMenProductIds.push(product.id)
    }
    if (gender.includes("women")) {
      summary.trustedWomen++
      if (product.id !== undefined && summary.sampleWomenProductIds.length < 10) summary.sampleWomenProductIds.push(product.id)
    }
    if (gender.includes("unisex")) {
      summary.trustedUnisex++
      if (product.id !== undefined && summary.sampleUnisexProductIds.length < 10) summary.sampleUnisexProductIds.push(product.id)
    }
  }
  return summary
}

/**
 * Brand scope is widened only. Incomplete product coverage must never narrow a
 * mixed brand back to one gender.
 */
export function shouldWidenBrandScopeToUnisex(
  currentScope: unknown,
  summary: BrandGenderEvidenceSummary,
): boolean {
  const current = cleanGenderScope(currentScope)
  const alreadyCanonicalUnisex = current.length === 1 && current[0] === "unisex"
  if (alreadyCanonicalUnisex) return false
  // A unisex accessory does not by itself make a women- or men-focused brand
  // mixed. Widen only when distinct trusted men and women product evidence is
  // present; this is the exact invariant this reconciliation protects.
  return summary.trustedMen > 0 && summary.trustedWomen > 0
}
