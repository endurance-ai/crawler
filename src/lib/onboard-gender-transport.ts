import type {GenderSource} from "./product-gender"

interface CrawlerGenderFields {
  gender?: unknown
  genderSource?: unknown
  tags?: unknown
}

interface PocGenderFields {
  gender?: unknown
  gender_source?: unknown
  tags?: unknown
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

/** Preserve crawler-owned gender evidence in the snake_case POC artifact. */
export function genderFieldsToPoc(product: CrawlerGenderFields): {
  gender: string[]
  gender_source?: GenderSource
  tags?: string[]
} {
  const gender = stringArray(product.gender) ?? []
  const tags = stringArray(product.tags)
  const genderSource = typeof product.genderSource === "string"
    ? product.genderSource as GenderSource
    : undefined

  return {
    gender,
    ...(genderSource ? {gender_source: genderSource} : {}),
    ...(tags ? {tags} : {}),
  }
}

/** Restore POC gender evidence to the camelCase import-file contract. */
export function genderFieldsFromPoc(row: PocGenderFields): {
  gender: string[]
  genderSource?: GenderSource
  tags?: string[]
} {
  const gender = stringArray(row.gender) ?? []
  const tags = stringArray(row.tags)
  const genderSource = typeof row.gender_source === "string"
    ? row.gender_source as GenderSource
    : undefined

  return {
    gender,
    ...(genderSource ? {genderSource} : {}),
    ...(tags ? {tags} : {}),
  }
}
