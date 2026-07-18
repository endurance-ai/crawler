/**
 * extractCafe24CateNos regression tests.
 *
 * Two silent-corruption incidents already hit this exact extraction logic
 * during the 2026-07 not-started-brand onboarding batch:
 *   1. dadadaseoul: a naive `cate_no=(\d+)` scan matched a cafe24 board
 *      widget link reusing the same query param, replacing the real
 *      product categories (42/43/45..) with board ids (9/13) — crawl 0.
 *   2. kyod/roseanne/wknd-project: a naive `/category/slug/(\d+)/` scan
 *      matched CDN upload paths (`/web/upload/category/editor/2025/12/07/
 *      hash.jpg`), reading years/dates as cate_no.
 * Both fixes are locked down here so neither regresses.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {extractCafe24CateNos} from "../src/brand-crawl"

test("classic /product/list.html?cate_no= links are extracted", () => {
  const html = `
    <a href="/product/list.html?cate_no=42">OUTER</a>
    <a href="https://example.com/product/list.html?cate_no=43&sort=new">TOP</a>
  `
  assert.deepEqual(extractCafe24CateNos(html), [42, 43])
})

test("board widget links reusing cate_no= are NOT extracted (dadadaseoul incident)", () => {
  const html = `
    <a href="/board/free/list.html?board_act=list&board_no=12&category_no=9&cate_no=9">공지사항</a>
    <a href="/product/list.html?cate_no=42">OUTER</a>
  `
  assert.deepEqual(extractCafe24CateNos(html), [42])
})

test("pretty-URL /category/slug/N/ links are extracted", () => {
  const html = `
    <a href="/category/acc/46/">ACC</a>
    <a href="/category/all/42/">ALL</a>
  `
  assert.deepEqual(extractCafe24CateNos(html), [46, 42])
})

test("CDN upload paths containing /category/ are NOT extracted (kyod/roseanne incident)", () => {
  const html = `
    <img src="/web/upload/category/editor/2025/12/07/a5719219f610f.jpg">
    <img src="/web/upload/category/editor/2023/03/24/5dbdb12908ee3.jpg">
    <a href="/category/acc/46/">ACC</a>
  `
  assert.deepEqual(extractCafe24CateNos(html), [46])
})

test("lookbook links are NOT extracted (not a product listing path)", () => {
  const html = `
    <a href="/product/lookbook.html?cate_no=47">LOOKBOOK</a>
    <a href="/product/list.html?cate_no=42">REAL</a>
  `
  assert.deepEqual(extractCafe24CateNos(html), [42])
})

test("board path that happens to contain /product/list.html as a substring, without cate_no, contributes nothing", () => {
  const html = `<a href="/board/product/list.html?board_no=4">Q&A</a>`
  assert.deepEqual(extractCafe24CateNos(html), [])
})

test("duplicates across both patterns are deduplicated", () => {
  const html = `
    <a href="/product/list.html?cate_no=42">A</a>
    <a href="/category/outer/42/">A again</a>
  `
  assert.deepEqual(extractCafe24CateNos(html), [42])
})

test("no matches returns empty array", () => {
  assert.deepEqual(extractCafe24CateNos("<html><body>no categories here</body></html>"), [])
})

test("result is capped at 80 entries", () => {
  const links = Array.from({length: 100}, (_, i) => `<a href="/product/list.html?cate_no=${i + 1}">C${i}</a>`).join("\n")
  assert.equal(extractCafe24CateNos(links).length, 80)
})
