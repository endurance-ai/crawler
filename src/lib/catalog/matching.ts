import type {ProductIdentifier} from "./types"

export type MatchStatus = "auto" | "review" | "reject"

export interface CatalogMatchInput {
  brandKey: string
  name: string
  category?: string | null
  colorKey?: string | null
  identifiers?: ProductIdentifier[]
}

export interface CatalogMatchDecision {
  status: MatchStatus
  confidence: number
  reason: string
  evidence: Record<string, unknown>
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function tokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length >= 2))
}

function colorCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  return !a || !b || normalizeText(a) === normalizeText(b)
}

function identifiersByKind(input: CatalogMatchInput, kind: ProductIdentifier["kind"]): ProductIdentifier[] {
  const minimumTrust = kind === "gtin" ? 0.99 : 0.8
  return (input.identifiers ?? []).filter(
    (identifier) => identifier.kind === kind && identifier.normalized && identifier.trust >= minimumTrust,
  )
}

function exactEvidence(a: CatalogMatchInput, b: CatalogMatchInput): {kind: string; value: string} | null {
  for (const kind of ["gtin", "mpn", "model_id", "product_group_id"] as const) {
    const left = identifiersByKind(a, kind)
    const right = identifiersByKind(b, kind)
    for (const l of left) {
      if (right.some((r) => l.normalized === r.normalized && l.namespace === r.namespace && l.scope === r.scope)) {
        return {kind, value: l.normalized}
      }
    }
  }
  return null
}

export function decideCatalogMatch(a: CatalogMatchInput, b: CatalogMatchInput): CatalogMatchDecision {
  if (normalizeText(a.brandKey) !== normalizeText(b.brandKey)) {
    return {status: "reject", confidence: 1, reason: "brand_conflict", evidence: {}}
  }
  if (!colorCompatible(a.colorKey, b.colorKey)) {
    return {status: "reject", confidence: 1, reason: "color_conflict", evidence: {a: a.colorKey, b: b.colorKey}}
  }
  const exact = exactEvidence(a, b)
  if (exact) {
    return {status: "auto", confidence: exact.kind === "gtin" ? 1 : 0.995, reason: "trusted_identifier_exact", evidence: exact}
  }

  const left = tokens(a.name)
  const right = tokens(b.name)
  const intersection = [...left].filter((token) => right.has(token)).length
  const union = new Set([...left, ...right]).size
  const titleJaccard = union === 0 ? 0 : intersection / union
  const sameCategory = Boolean(a.category && b.category && normalizeText(a.category) === normalizeText(b.category))
  if (sameCategory && titleJaccard >= 0.8) {
    return {
      status: "review",
      confidence: Math.min(0.94, 0.55 + titleJaccard * 0.35),
      reason: "composite_candidate_requires_review",
      evidence: {titleJaccard, sameCategory},
    }
  }
  return {status: "reject", confidence: titleJaccard, reason: "insufficient_evidence", evidence: {titleJaccard, sameCategory}}
}
