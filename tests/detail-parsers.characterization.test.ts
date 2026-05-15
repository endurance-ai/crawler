/**
 * Golden-master characterization tests for the 18 site detail parsers.
 *
 * SPEC: SPEC-ARCH-CRAWLER-001 (pre-phase-2 selector-registry gate +
 * cafe24-family detail-layer characterization for the pre-phase-3 gate)
 * Runs via: pnpm test (node --test --import tsx ./tests/*.test.ts)
 *
 * PURPOSE (DDD PRESERVE phase)
 * ---------------------------
 * These tests lock the CURRENT observable output of every site detail
 * parser in src/lib/parsers/detail/ as a byte-identical golden master.
 * They are characterization tests: they assert WHAT THE CODE DOES TODAY,
 * not what it should do. Any quirk visible in a *.golden.json file
 * (trailing prose captured into material, null fields from innerText
 * newline collapsing, etc.) is intentional — a future selector-registry
 * / parser-strategy refactor MUST reproduce it field-for-field.
 *
 * MECHANISM
 * ---------
 * Each parser's real .parse(page, url) requires a live Playwright Page
 * (page.goto + page.evaluate / $eval / $$eval); none expose a pure
 * extraction function. So the unmodified parser is driven against a
 * recorded fixture HTML file served via page.route() interception —
 * zero network, zero production-code change. The produced DetailData
 * is compared deep-equal against the committed golden JSON.
 *
 * Fixtures:
 *   tests/fixtures/detail/<site>.html         — minimal HTML crafted to
 *                                               exercise that parser's
 *                                               actual selectors
 *   tests/fixtures/detail/<site>.golden.json  — current parser output,
 *                                               captured 2026-05-16
 *                                               from unmodified code
 *
 * The 18 sites match SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-003 exactly.
 * (triplestore-parser.ts exists in index.ts but is NOT in the SPEC's
 * 18-site list, so it is out of this characterization scope.)
 */

import {test, before, after} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"
import {chromium, type Browser, type BrowserContext} from "playwright"

import {
  EightDivisionDetailParser,
  AdekuverDetailParser,
  AnotherofficeDetailParser,
  BastongDetailParser,
  BlankroomDetailParser,
  ChanceclothingDetailParser,
  EastlogueDetailParser,
  EtcseoulDetailParser,
  Fr8ightDetailParser,
  HavatiDetailParser,
  RoughsideDetailParser,
  SculpstoreDetailParser,
  ShopamomentoDetailParser,
  SienneboutiqueDetailParser,
  SlowsteadyclubDetailParser,
  SwallowloungeDetailParser,
  TakeastreetDetailParser,
  VisualalidDetailParser,
  type DetailData,
  type IDetailParser,
} from "../src/lib/parsers/detail/index"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(__dirname, "fixtures", "detail")

// site key (matches SPEC REQ-CRAWLER-003) -> fresh parser instance
const PARSERS: Record<string, () => IDetailParser> = {
  "8division": () => new EightDivisionDetailParser(),
  adekuver: () => new AdekuverDetailParser(),
  anotheroffice: () => new AnotherofficeDetailParser(),
  bastong: () => new BastongDetailParser(),
  blankroom: () => new BlankroomDetailParser(),
  chanceclothing: () => new ChanceclothingDetailParser(),
  eastlogue: () => new EastlogueDetailParser(),
  etcseoul: () => new EtcseoulDetailParser(),
  fr8ight: () => new Fr8ightDetailParser(),
  havati: () => new HavatiDetailParser(),
  roughside: () => new RoughsideDetailParser(),
  sculpstore: () => new SculpstoreDetailParser(),
  shopamomento: () => new ShopamomentoDetailParser(),
  sienneboutique: () => new SienneboutiqueDetailParser(),
  slowsteadyclub: () => new SlowsteadyclubDetailParser(),
  swallowlounge: () => new SwallowloungeDetailParser(),
  takeastreet: () => new TakeastreetDetailParser(),
  visualaid: () => new VisualalidDetailParser(),
}

const SITES = Object.keys(PARSERS)

let browser: Browser
let ctx: BrowserContext

before(async () => {
  browser = await chromium.launch({headless: true})
  ctx = await browser.newContext()
})

after(async () => {
  await ctx?.close()
  await browser?.close()
})

/**
 * Drive the unmodified parser against the fixture HTML via route
 * interception. The parser's own page.goto(url) is satisfied by the
 * fulfilled fixture response — no network egress.
 */
async function runParser(site: string): Promise<DetailData> {
  const html = fs.readFileSync(path.join(FIX, `${site}.html`), "utf-8")
  const page = await ctx.newPage()
  try {
    await page.route("**/*", (r) =>
      r.fulfill({status: 200, contentType: "text/html; charset=utf-8", body: html}),
    )
    return await PARSERS[site]().parse(page, `https://fixture.local/${site}/product/1`)
  } finally {
    await page.close()
  }
}

function loadGolden(site: string): DetailData {
  return JSON.parse(fs.readFileSync(path.join(FIX, `${site}.golden.json`), "utf-8")) as DetailData
}

// ─── Coverage guard: all 18 SPEC sites characterized ───────────

test("characterize: 18 SPEC detail-parser sites have fixture + golden", () => {
  assert.equal(SITES.length, 18, `expected 18 SPEC sites, got ${SITES.length}`)
  for (const site of SITES) {
    assert.ok(
      fs.existsSync(path.join(FIX, `${site}.html`)),
      `missing fixture HTML for ${site}`,
    )
    assert.ok(
      fs.existsSync(path.join(FIX, `${site}.golden.json`)),
      `missing golden JSON for ${site}`,
    )
  }
})

// ─── Per-site golden-master characterization ───────────────────

for (const site of SITES) {
  test(`characterize_detail_parser_${site}_fixture_output_matches_golden`, async () => {
    const actual = await runParser(site)
    const golden = loadGolden(site)
    assert.deepEqual(
      actual,
      golden,
      `BEHAVIOR DRIFT for ${site}: parser output diverged from the ` +
        `SPEC-ARCH-CRAWLER-001 golden master. If this is an intentional ` +
        `IMPROVE-phase change, the refactor must be byte-identical — ` +
        `do NOT regenerate the golden.\n` +
        `actual:  ${JSON.stringify(actual)}\n` +
        `golden:  ${JSON.stringify(golden)}`,
    )
  })
}

// ─── Shape invariant: DetailData contract ──────────────────────

test("characterize: every parser returns the DetailData 4-field shape", async () => {
  for (const site of SITES) {
    const r = await runParser(site)
    const keys = Object.keys(r).sort()
    assert.deepEqual(
      keys,
      ["color", "description", "material", "productCode"],
      `DetailData shape changed for ${site}: ${JSON.stringify(keys)}`,
    )
  }
})
