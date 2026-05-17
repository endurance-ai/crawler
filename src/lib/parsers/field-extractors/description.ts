/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 — shared description field-extractors.
 *
 * Behavior-preserving primitives factored from the 18 per-site parsers.
 * Quirks intentionally preserved (preserve-findings.md).
 */

/**
 * BaseDetailParser description algorithm: first selector whose innerText
 * (trimmed) is longer than 10 chars wins, sliced to 2000.
 *
 * Shared by base fallback + blankroom + visualaid (3 → 1 collapse; the
 * only per-site difference is the selector list, now a registry param).
 */
export function baseDescriptionInPage(selectors: string[]): string | null {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel)
      if (!el) continue
      const text = (el as HTMLElement).innerText?.trim()
      if (text && text.length > 10) return text.slice(0, 2000)
    } catch {
      /* next */
    }
  }
  return null
}
