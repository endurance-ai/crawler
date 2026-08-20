#!/usr/bin/env npx tsx
/**
 * Applies CAFE24_CATEGORY_NAME_BACKFILL (tools/cafe24-category-name-overrides.generated.ts)
 * directly onto the committed src/configs/platforms.generated.ts text, in place.
 *
 * Deliberately NOT a re-run of generate-platform-configs.ts: that pulls the full
 * candidate list fresh from the DB, which can add/drop/disable unrelated sites due
 * to DB drift since the file was last generated (confirmed 2026-08-20: a full
 * regen silently dropped "innir", breaking tests/verified-brand-gender-configs.test.ts
 * — unrelated to this category-name fix). This script only rewrites the
 * `categories: [...]` array for the specific keys in the backfill map, leaving
 * every other byte of the file — including which sites are present at all —
 * untouched.
 *
 * Usage: npx tsx tools/apply-cafe24-category-backfill.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"
import {CAFE24_CATEGORY_NAME_BACKFILL} from "./cafe24-category-name-overrides.generated"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TARGET = path.join(__dirname, "../src/configs/platforms.generated.ts")

function categoriesLines(key: string): string[] {
  const categories = CAFE24_CATEGORY_NAME_BACKFILL[key]!
  const lines = ["      categories: ["]
  for (const c of categories) {
    const gender = c.gender?.length ? `, gender: ${JSON.stringify(c.gender)}` : ""
    lines.push(`        {name: ${JSON.stringify(c.name)}, cateNo: ${c.cateNo}${gender}},`)
  }
  lines.push("      ],")
  return lines
}

function main() {
  const content = fs.readFileSync(TARGET, "utf8")
  const eol = content.includes("\r\n") ? "\r\n" : "\n"
  const lines = content.split(/\r\n|\n/)
  let i = 0
  let currentKey: string | null = null
  let patched = 0
  const missing: string[] = []
  const wantedKeys = new Set(Object.keys(CAFE24_CATEGORY_NAME_BACKFILL))
  const seenKeys = new Set<string>()
  const out: string[] = []

  while (i < lines.length) {
    const line = lines[i]
    const keyMatch = line.match(/^\s{4}key: "([^"]+)",$/)
    if (keyMatch) currentKey = keyMatch[1]

    if (
      currentKey &&
      wantedKeys.has(currentKey) &&
      /^\s{6}categories: \[$/.test(line)
    ) {
      seenKeys.add(currentKey)
      out.push(...categoriesLines(currentKey))
      patched += 1
      // Skip the original categories block through its closing "      ],"
      i += 1
      while (i < lines.length && lines[i] !== "      ],") i += 1
      i += 1 // consume the closing line too
      continue
    }

    out.push(line)
    i += 1
  }

  for (const key of wantedKeys) if (!seenKeys.has(key)) missing.push(key)

  fs.writeFileSync(TARGET, out.join(eol), "utf8")
  console.log(`Patched ${patched} site category blocks in ${TARGET}`)
  if (missing.length > 0) {
    console.log(`\n${missing.length} backfill keys NOT found in the generated file (site removed/renamed since backfill ran — left as-is):`)
    for (const m of missing) console.log(`  ${m}`)
  }
}

main()
