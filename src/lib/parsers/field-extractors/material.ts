/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 — shared material field-extractors.
 *
 * Behavior-preserving primitives factored from the 18 per-site parsers.
 *
 * @MX:NOTE: [AUTO] baseMaterialFromDescription extracts the fabric
 * COMPOSITION ONLY. It anchors on a material label
 * (소재|원단|Material|Fabric|Composition) or, failing that, on a bare
 * <pct>% <fiber> token, then captures only the run of composition
 * segments and stops at the first non-composition token (Korean
 * particle, sentence boundary, bullet prose). The earlier
 * material-pollution bug (preserve-findings.md 유형 1: blankroom/visualaid
 * trailing prose leaking into material) is FIXED here by
 * SPEC-CRAWLER-DETAIL-FIX-001 (Type 1 shared root cause). baseStrategy
 * in strategies.ts inlines the identical algorithm for the in-page
 * (page.evaluate) execution path and MUST stay in sync with this.
 * Accepted narrowing: a material label with no <pct>% <fiber> segment
 * (e.g. "소재: 면/나일론혼방") returns null by design (composition-only,
 * REQ-DFIX-002); the base fallback path is the unknown-site fallback
 * and is out of SPEC scope.
 * @MX:SPEC: SPEC-CRAWLER-DETAIL-FIX-001 REQ-DFIX-001/002
 */

/**
 * One composition segment: `<pct>% <fiber>` (e.g. `70% Acrylic`,
 * `100% CO`) OR `<fiber> <pct>%` (e.g. `Wool 80%`, `면 100%`). Fiber
 * tokens are Latin or Hangul words. A composition run is one segment
 * followed by zero or more comma/slash-separated segments. The run stops
 * at the first token that is not a composition segment (Korean particle
 * such as 으로/의, sentence boundary, bullet prose, any non-fiber word).
 */
const COMPOSITION_RUN_SRC =
  String.raw`(?:\d+\s*%\s*[A-Za-z가-힣]+|[A-Za-z가-힣]+\s*\d+\s*%)` +
  String.raw`(?:\s*[,/]\s*(?:\d+\s*%\s*[A-Za-z가-힣]+|[A-Za-z가-힣]+\s*\d+\s*%))*`

/** Material label anchor; the composition run is searched AFTER it. */
const MATERIAL_LABEL_SRC = String.raw`(?:소재|원단|Material|Fabric|Composition)\s*[:：]?\s*`

/**
 * From a description string, extract the fabric composition only.
 *
 * Strategy: locate the material label; from the end of that label,
 * capture the composition run. If no label is present, fall back to the
 * first bare composition run anywhere in the text. Trailing marketing
 * prose is excluded because the composition run terminates at the first
 * non-composition token.
 *
 * `matPatternSrc`/`matKeywords` are accepted for API compatibility with
 * the registry-driven call site but are no longer needed: the corrected
 * extraction is structural (label + composition grammar), not a
 * caller-supplied over-capturing regex.
 *
 * Shared by base fallback + blankroom + visualaid. The inline twin in
 * strategies.ts baseStrategy MUST implement the identical algorithm.
 */
export function baseMaterialFromDescription(
  description: string | null,
  _matPatternSrc?: string,
  _matKeywords?: string[],
): string | null {
  if (!description) return null
  const compRe = new RegExp(COMPOSITION_RUN_SRC)
  const labelMatch = description.match(new RegExp(MATERIAL_LABEL_SRC, "i"))
  if (labelMatch && labelMatch.index !== undefined) {
    const rest = description.slice(labelMatch.index + labelMatch[0].length)
    const c = rest.match(compRe)
    if (c) return c[0].trim()
  }
  const bare = description.match(compRe)
  if (bare) return bare[0].trim()
  return null
}
