/**
 * Focused tests for the Product validation gate.
 *
 * SPEC: SPEC-ARCH-CRAWLER-001 (REQ-CRAWLER-001 / 002 / 005, Phase 1)
 * Runs via: pnpm test (node --test --import tsx ./tests/*.test.ts)
 *
 * Scope: the NEW validation gate only (new-code test, allowed/expected).
 *  - a currently-emitted golden product passes byte-identically
 *  - an invalid product is rejected + a structured reject event is emitted
 *  - CRAWLER_VALIDATION_ENABLED=false bypasses the gate entirely (legacy)
 *
 * Cross-check source: every product in
 * tests/fixtures/uniqlo-kr-parse.golden.json (100 real outputs) must pass
 * the schema — this guards the "schema must not reject anything the
 * crawler emits today" invariant.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

import {validateProduct, ProductSchema} from "../src/lib/core/product-validator"
import {applyValidationGate, isValidationEnabled} from "../src/lib/core/validation-gate"
import {normalizeColor, normalizeColorList, extractColorFromText} from "../src/lib/parsers/field-extractors/color-normalizer"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const GOLDEN_PATH = path.join(__dirname, "fixtures", "uniqlo-kr-parse.golden.json")

const golden: unknown[] = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf-8"))

test("every currently-emitted golden product passes ProductSchema", () => {
  assert.ok(golden.length >= 100, "expected the 100-product golden fixture")
  for (const p of golden) {
    const r = validateProduct(p)
    assert.equal(
      r.ok,
      true,
      `golden product rejected (schema too strict): ${JSON.stringify(p).slice(0, 200)}`,
    )
  }
})

test("valid product passes through by reference (no transform)", () => {
  const p = golden[0]
  const r = validateProduct(p)
  assert.equal(r.ok, true)
  if (r.ok) {
    // Same object graph — gate must not reshape output.
    assert.deepEqual(r.value, p)
  }
})

test("product with null color is rejected (policy A exception — migration 091)", () => {
  // category and color are exceptions to Policy A: both require a non-empty
  // string (z.string().min(1)) to match the products table NOT NULL contract.
  // Products that cannot have color extracted must not be inserted (migration 091).
  const noColor = {
    brand: "X",
    name: "n",
    category: "Tops",
    price: null,
    originalPrice: null,
    salePrice: null,
    priceFormatted: "",
    imageUrl: "",
    productUrl: "https://x/y",
    inStock: true,
    gender: [],
    platform: "8division",
    crawledAt: "2026-01-01",
    description: null,
    color: null,
    productCode: null,
  }
  const r = validateProduct(noColor)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.failedField, "color")
})

test("product with empty category is rejected (policy A exception — migration 091)", () => {
  const noCategory = {
    brand: "X",
    name: "n",
    category: "",
    price: null,
    originalPrice: null,
    salePrice: null,
    priceFormatted: "",
    imageUrl: "",
    productUrl: "https://x/y",
    inStock: true,
    gender: [],
    platform: "8division",
    crawledAt: "2026-01-01",
    color: "Black",
  }
  const r = validateProduct(noCategory)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.failedField, "category")
})

test("invalid product is rejected with failedField/rawValue", () => {
  const bad = {
    brand: "X",
    // name missing (required)
    category: "c",
    price: null,
    originalPrice: null,
    salePrice: null,
    priceFormatted: "",
    imageUrl: "",
    productUrl: "https://x/y",
    inStock: true,
    gender: [],
    platform: "p",
    crawledAt: "t",
  }
  const r = validateProduct(bad)
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.failedField, "name")
    assert.ok(typeof r.rawValue === "string")
    assert.ok(r.issues.length >= 1)
  }
})

test("type mismatch is rejected (gender not an array)", () => {
  const bad = {...(golden[0] as Record<string, unknown>), gender: "women"}
  const r = validateProduct(bad)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.failedField, "gender")
})

test("gate excludes invalid + emits a structured reject event", () => {
  const events: unknown[] = []
  const origWarn = console.warn
  console.warn = (msg?: unknown) => {
    if (typeof msg === "string" && msg.startsWith("[crawler-event] ")) {
      events.push(JSON.parse(msg.slice("[crawler-event] ".length)))
    }
  }
  try {
    const valid = golden[0]
    const invalid = {...(golden[0] as Record<string, unknown>)}
    delete invalid.name
    const out = applyValidationGate([valid, invalid], "uniqlo-kr")
    assert.equal(out.length, 1)
    assert.deepEqual(out[0], valid)
    assert.equal(events.length, 1)
    const ev = events[0] as Record<string, unknown>
    assert.equal(ev.kind, "validation_reject")
    assert.equal(ev.site, "uniqlo-kr")
    assert.equal(ev.failedField, "name")
    assert.ok(typeof ev.sku === "string" && (ev.sku as string).length > 0)
  } finally {
    console.warn = origWarn
  }
})

test("CRAWLER_VALIDATION_ENABLED=false bypasses the gate (legacy behavior)", () => {
  const prev = process.env.CRAWLER_VALIDATION_ENABLED
  process.env.CRAWLER_VALIDATION_ENABLED = "false"
  try {
    assert.equal(isValidationEnabled(), false)
    const invalid = {garbage: true}
    // Bypass → input array returned unchanged, no validation, no events.
    const out = applyValidationGate([invalid], "any")
    assert.equal(out.length, 1)
    assert.equal(out[0], invalid)
  } finally {
    if (prev === undefined) delete process.env.CRAWLER_VALIDATION_ENABLED
    else process.env.CRAWLER_VALIDATION_ENABLED = prev
  }
})

test("flag default (unset) and explicit true → gate enabled", () => {
  const prev = process.env.CRAWLER_VALIDATION_ENABLED
  try {
    delete process.env.CRAWLER_VALIDATION_ENABLED
    assert.equal(isValidationEnabled(), true)
    process.env.CRAWLER_VALIDATION_ENABLED = "true"
    assert.equal(isValidationEnabled(), true)
  } finally {
    if (prev === undefined) delete process.env.CRAWLER_VALIDATION_ENABLED
    else process.env.CRAWLER_VALIDATION_ENABLED = prev
  }
})

test("ProductSchema is exported and usable directly", () => {
  assert.ok(ProductSchema)
  assert.equal(ProductSchema.safeParse(golden[0]).success, true)
})

// ── Color normalization unit tests ────────────────────────────────────────────

test("normalizeColor: lowercase → Title Case", () => {
  assert.equal(normalizeColor("yellow"), "Yellow")
  assert.equal(normalizeColor("black"), "Black")
  assert.equal(normalizeColor("navy"), "Navy")
})

test("normalizeColor: UPPERCASE → canonical", () => {
  assert.equal(normalizeColor("YELLOW"), "Yellow")
  assert.equal(normalizeColor("BLACK"), "Black")
})

test("normalizeColor: synonym merging — gray/grey → Grey", () => {
  assert.equal(normalizeColor("gray"), "Grey")
  assert.equal(normalizeColor("GRAY"), "Grey")
  assert.equal(normalizeColor("grey"), "Grey")
})

test("normalizeColor: Korean → English canonical", () => {
  assert.equal(normalizeColor("블랙"), "Black")
  assert.equal(normalizeColor("네이비"), "Navy")
  assert.equal(normalizeColor("그레이"), "Grey")
})

test("normalizeColor: compound color keyword (Pigment Charcoal → Charcoal)", () => {
  assert.equal(normalizeColor("Pigment Charcoal"), "Charcoal")
})

test("normalizeColorList: comma-separated multi-color", () => {
  assert.equal(normalizeColorList("WHITE, black, NAVY"), "White, Black, Navy")
  assert.equal(normalizeColorList("gray,   YELLOW"), "Grey, Yellow")
})

test("extractColorFromText: finds color keyword in product name", () => {
  assert.equal(extractColorFromText("Black Cotton Trousers"), "Black")
  assert.equal(extractColorFromText("Navy Blue Bomber Jacket"), "Navy")
})

test("extractColorFromText: returns null when no keyword found", () => {
  assert.equal(extractColorFromText("Regular Fit Trousers"), null)
  assert.equal(extractColorFromText(""), null)
})
