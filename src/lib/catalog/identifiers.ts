import type {SiteConfig} from "../types"
import type {ProductIdentifier, ProductIdentifierKind, ProductIdentifierScope} from "./types"

export interface IdentifierProfile {
  productCode: ProductIdentifierKind | "unknown"
  namespace: string
  scope: ProductIdentifierScope
  level: ProductIdentifier["level"]
}

const PROFILE_BY_PLATFORM: Record<string, IdentifierProfile> = {
  uniqlo: {productCode: "model_id", namespace: "uniqlo", scope: "brand", level: "product"},
  zara: {productCode: "model_id", namespace: "zara", scope: "brand", level: "product"},
  farfetch: {productCode: "source_item_id", namespace: "farfetch", scope: "platform", level: "offer"},
}

export function identifierProfileFor(configOrPlatform: Pick<SiteConfig, "key" | "type" | "identifierProfile"> | string): IdentifierProfile {
  if (typeof configOrPlatform !== "string" && configOrPlatform.identifierProfile) {
    return configOrPlatform.identifierProfile
  }
  const key = typeof configOrPlatform === "string" ? configOrPlatform : configOrPlatform.key
  const type = typeof configOrPlatform === "string" ? configOrPlatform : configOrPlatform.type
  const profile = PROFILE_BY_PLATFORM[key]
    ?? PROFILE_BY_PLATFORM[type]
    ?? Object.entries(PROFILE_BY_PLATFORM).find(([prefix]) => key.startsWith(`${prefix}-`))?.[1]
  if (profile) return profile
  return {
    productCode: "unknown",
    namespace: type || key,
    scope: "platform",
    level: "offer",
  }
}

export function normalizeIdentifierValue(kind: ProductIdentifierKind, raw: string): string {
  const value = raw.normalize("NFKC").trim().toUpperCase()
  if (kind === "gtin") return value.replace(/[^0-9]/g, "")
  return value.replace(/[^A-Z0-9]+/g, "")
}

export function isValidGtin(value: string): boolean {
  if (![8, 12, 13, 14].includes(value.length) || !/^\d+$/.test(value)) return false
  let sum = 0
  for (let i = value.length - 1, position = 0; i >= 0; i--, position++) {
    const digit = Number(value[i])
    sum += digit * (position === 0 || position % 2 === 0 ? 1 : 3)
  }
  return sum % 10 === 0
}

export function makeIdentifier(
  kind: ProductIdentifierKind,
  raw: string,
  profile: Pick<ProductIdentifier, "namespace" | "scope" | "level" | "provenance" | "trust">,
): ProductIdentifier | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = normalizeIdentifierValue(kind, trimmed)
  if (!normalized || (kind === "gtin" && !isValidGtin(normalized))) return null
  return {kind, raw: trimmed, normalized, ...profile}
}
