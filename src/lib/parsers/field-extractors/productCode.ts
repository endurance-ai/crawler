/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 — shared productCode field-extractor.
 *
 * Behavior-preserving primitive factored from BaseDetailParser. Only the
 * base family uses a selector-driven productCode; the bespoke strategies
 * derive productCode from in-page text inline (adekuver/chanceclothing/
 * sculpstore) and keep that logic verbatim in strategies.ts.
 */

/**
 * BaseDetailParser productCode algorithm: first selector with text; take
 * the substring after ':'/'：' if present, else the whole trimmed text.
 */
export function baseProductCodeInPage(selectors: string[]): string | null {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel)
      if (!el) continue
      const text = (el as HTMLElement).innerText?.trim()
      if (text) {
        const m = text.match(/[:：]\s*(.+)/)
        return m ? m[1].trim() : text
      }
    } catch {
      /* next */
    }
  }
  return null
}
