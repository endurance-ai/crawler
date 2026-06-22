/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 — shared color field-extractors.
 *
 * Behavior-preserving extraction primitives factored verbatim out of the
 * 18 per-site detail parsers. Each helper reproduces the exact in-page
 * logic of the original parser(s) it replaces. Quirks are preserved on
 * purpose (see .moai/specs/SPEC-ARCH-CRAWLER-001/preserve-findings.md).
 */

import type {Page} from "playwright"
import {normalizeColorList} from "./color-normalizer"

/**
 * Collect <option> innerText from `select[name*="option"]`, filtered.
 *
 * Shared by anotheroffice, bastong, chanceclothing, havati, sculpstore,
 * slowsteadyclub, swallowlounge. Each original used a slightly different
 * filter/dedupe/transform; encoded here as explicit modes so output stays
 * byte-identical per site.
 */
export type OptionColorMode =
  | "swallowlounge" // empty/선택/Select/* filter, no dedupe
  | "anotheroffice" // startsWith('-')/empty/선택/* filter, no dedupe
  | "bastong" // 선택/---/* filter, Set dedupe
  | "chanceclothing" // COLOR-SIZE split, Set dedupe
  | "havati" // startsWith('-')/empty/선택/* filter, no dedupe (same as anotheroffice but no `|| null`)
  | "slowsteadyclub" // startsWith('-')/empty/선택/* filter, Set dedupe

export async function colorFromOptionList(
  page: Page,
  mode: OptionColorMode,
): Promise<string | null> {
  const raw = await page
    .$$eval(
      'select[name*="option"] option',
      (els, m) => {
        const texts = els.map((el) => (el as HTMLElement).innerText?.trim())
        if (m === "swallowlounge") {
          return (
            texts
              .filter(
                (t) => t && t !== "empty" && !t.includes("선택") && !t.includes("Select") && t !== "*",
              )
              .slice(0, 20)
              .join(", ") || null
          )
        }
        if (m === "anotheroffice") {
          return (
            texts
              .filter(
                (t) => t && !t.startsWith("-") && t !== "empty" && !t.includes("선택") && t !== "*",
              )
              .slice(0, 20)
              .join(", ") || null
          )
        }
        if (m === "havati") {
          const opts = texts.filter(
            (t) => t && !t.startsWith("-") && t !== "empty" && !t.includes("선택") && t !== "*",
          )
          return opts.length > 0 ? opts.slice(0, 20).join(", ") : null
        }
        if (m === "bastong") {
          const colors = texts.filter(
            (t) => t && !t.includes("선택") && !t.includes("---") && t !== "*",
          )
          return colors.length > 0 ? [...new Set(colors)].slice(0, 20).join(", ") : null
        }
        if (m === "slowsteadyclub") {
          const opts = texts.filter(
            (t) => t && !t.startsWith("-") && t !== "empty" && !t.includes("선택") && t !== "*",
          )
          return opts.length > 0 ? [...new Set(opts)].slice(0, 20).join(", ") : null
        }
        // chanceclothing: COLOR-SIZE → COLOR, Set dedupe
        const colors = new Set<string>()
        for (const el of els) {
          const t = (el as HTMLElement).innerText?.trim() || ""
          if (!t || t.includes("선택") || t.includes("---") || t === "*") continue
          const color = t.replace(/-(XXS|XS|S|M|L|XL|XXL|2XL|3XL|\d+)$/i, "").trim()
          if (color) colors.add(color)
        }
        return colors.size > 0 ? [...colors].slice(0, 20).join(", ") : null
      },
      mode,
    )
    .catch(() => null)

  return raw ? normalizeColorList(raw) : null
}
