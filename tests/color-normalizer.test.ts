/**
 * Parser-layer color vocabulary (src/lib/parsers/field-extractors/color-normalizer.ts).
 *
 * No test file existed for this module before the 2026-07-28 color-vocab
 * sync — it had silently drifted from the QC-gate vocabulary
 * (product-qc/normalization.ts's COLOR_RULES) for a long time with nothing
 * locking either list's coverage in place. These tests cover the additions
 * made during that sync, not the full pre-existing vocabulary.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  normalizeColor,
  normalizeColorList,
  isNonColorOptionText,
  extractColorFromText,
} from "../src/lib/parsers/field-extractors/color-normalizer"

test("normalizeColor: colors newly synced from the QC-gate vocabulary resolve here too", () => {
  // Before the sync, this file recognized Teal/Mint/Coral/Mustard/Rust/
  // Cobalt/Forest Green while normalization.ts didn't (the original bug).
  // These are the reverse direction — colors the QC gate gained that this
  // parser-layer file needs so extraction doesn't hit the same gap twice.
  assert.equal(normalizeColor("Coconut Milk"), "Coconut Milk")
  assert.equal(normalizeColor("mocha"), "Mocha")
  assert.equal(normalizeColor("CARAMEL"), "Caramel")
  assert.equal(normalizeColor("camouflage"), "Camo")
  assert.equal(normalizeColor("Leopard"), "Leopard")
})

test("normalizeColor: 'sky blue' still folds into Blue here, unlike the QC gate's finer split", () => {
  // Deliberate: this file's stated policy is "unify casing and synonyms"
  // (merge), while normalization.ts's COLOR_RULES policy for this pass is
  // "detailed granularity is the point" (split Sky Blue/Light Blue/Dark Blue
  // out from generic Blue). Both are valid; forcing identical output
  // granularity across the two files was never the goal of the sync.
  assert.equal(normalizeColor("sky blue"), "Blue")
  assert.equal(normalizeColor("Cobalt"), "Cobalt")
})

test("normalizeColorList: multi-value comma list picks up newly-synced colors", () => {
  assert.equal(normalizeColorList("BLACK, mocha, CARAMEL"), "Black, Mocha, Caramel")
})

test("isNonColorOptionText: 2026-07-28 additions — spelled-out sizes, Roman numeral tiers, dotted O.s", () => {
  for (const noise of ["Small", "Medium", "Large", "Extra Large", "one", "O.s", "o.S", "Sm", "Ml", "Md", "Lg", "Ss"]) {
    assert.equal(isNonColorOptionText(noise), true, `expected noise: ${noise}`)
  }
  for (const roman of ["I", "II", "III", "IV", "V", "VI", "IX", "X"]) {
    assert.equal(isNonColorOptionText(roman), true, `expected Roman numeral size tier noise: ${roman}`)
  }
})

test("isNonColorOptionText: 2026-07-28 additions — null placeholder and disclaimer leaks", () => {
  assert.equal(isNonColorOptionText("Null"), true)
  assert.equal(isNonColorOptionText("Sale"), true)
  assert.equal(isNonColorOptionText("Notice"), true)
  assert.equal(isNonColorOptionText("restock"), true)
  assert.equal(isNonColorOptionText("세일 상품은 교환, 환불이 어렵습니다"), true)
  assert.equal(isNonColorOptionText("동의합니다"), true)
})

test("isNonColorOptionText: does not reject real colors that happen to look short", () => {
  // Guard against the new short-token noise patterns (sm/ml/md/lg/ss/n/x)
  // over-matching real color names.
  assert.equal(isNonColorOptionText("Mint"), false)
  assert.equal(isNonColorOptionText("Sand"), false)
  assert.equal(isNonColorOptionText("Ink"), false)
})

test("extractColorFromText: finds a newly-synced color inside a longer product name", () => {
  assert.equal(extractColorFromText("Wool Coat in Chestnut colorway"), "Chestnut")
  assert.equal(extractColorFromText("No color mentioned here"), null)
})
