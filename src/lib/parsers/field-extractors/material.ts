/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 — shared material field-extractors.
 *
 * Behavior-preserving primitives factored from the 18 per-site parsers.
 *
 * @MX:NOTE: [AUTO] baseMaterialInPage reproduces the BaseDetailParser
 * material-pollution path verbatim (regex-then-keyword-line-scan). When
 * the description's material line carries trailing prose, that prose is
 * captured into `material` — this is a KNOWN BUG kept byte-identical.
 * @MX:REASON: preserve-findings.md 유형 1 (blankroom/visualaid material
 * pollution) — Phase 2 is behavior-preserving; fix is SPEC-CRAWLER-DETAIL-FIX-001.
 */

/**
 * BaseDetailParser material algorithm: from a description string, try the
 * material regex; on miss, scan lines for a material keyword and take the
 * whole (de-bulleted) line. Reproduces the material-pollution quirk.
 *
 * Shared by base fallback + blankroom + visualaid (params from registry).
 */
export function baseMaterialFromDescription(
  description: string | null,
  matPatternSrc: string,
  matKeywords: string[],
): string | null {
  if (!description) return null
  const matMatch = description.match(new RegExp(matPatternSrc, "i"))
  if (matMatch?.[1]) return matMatch[1].trim()
  const lines = description.split("\n")
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (matKeywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      const cleaned = line.replace(/^\s*[-·•]\s*/, "").trim()
      if (cleaned.length > 3 && cleaned.length < 200) return cleaned
    }
  }
  return null
}
