import {test} from "node:test"
import assert from "node:assert/strict"
import {officialPageMatches, observedName, verifiedGenderTarget, sameName, selectAuditRows, parseRepairArgs} from "../tools/plan-product-quality-repair"
import {sameProductPage} from "../src/lib/product-url-identity"

test("repair identity matches Cafe24 canonical URLs but not another product or host", () => {
  const target = "https://shop.example.com/product/detail.html?product_no=12&cate_no=3"
  const html = `<link href="https://shop.example.com/product/shirt/12/" rel="canonical">`
  assert.equal(officialPageMatches(html, target), true)
  assert.equal(officialPageMatches(html, target.replace("product_no=12", "product_no=13")), false)
  assert.equal(officialPageMatches(html, target.replace("shop.example.com", "other.example.com")), false)
  assert.equal(officialPageMatches("<title>Login</title>",target),false)
  assert.equal(officialPageMatches("<script>var iProductNo = 12;</script>",target),true)
})

test("product identity preserves variant and product-number distinctions", () => {
  assert.equal(sameProductPage("https://shop.example.com/products/tee?variant=1", "https://shop.example.com/products/tee?variant=2"), false)
  assert.equal(sameProductPage("https://shop.example.com/product/a/12/", "https://shop.example.com/product/detail.html?product_no=12"), true)
})

test("gender repairs require an audited platform and explicit official audience", () => {
  assert.equal(verifiedGenderTarget("uniformbridge", "Coat (womens) beige"), "women")
  assert.equal(verifiedGenderTarget("matin-kim", "TRUCKER FOR MEN IN WHITE"), "men")
  assert.equal(verifiedGenderTarget("en-579", "MENS STRAIGHT EFFECT JEAN_BLUE"), "men")
  assert.equal(verifiedGenderTarget("citizensofhumanity", "Rework Men's Tee"), null)
  assert.equal(verifiedGenderTarget("fr8ight", "Ordinary tee"), null)
})

test("official product name comes from product-specific data rather than a generic OG title", () => {
  const html = `<meta property="og:title" content="Official store"><script>var product_name = 'Urban Muse Tee';</script>`
  assert.equal(observedName(html, "https://shop.example.com/product/detail.html?product_no=12"), "Urban Muse Tee")
})

test("audited promotional labels can change without matching a different product", () => {
  assert.equal(sameName("[무배] 검정 원피스", "[SALE] 검정 원피스", "draw-attention"), true)
  assert.equal(sameName("[무배] 검정 원피스", "[SALE] 노랑 원피스", "draw-attention"), false)
  assert.equal(sameName("Urban Cargo Pants (Camel)Camel", "Urban Cargo Pants_Unisex (Camel) / Camel", "en-208"), true)
})

test("repair snapshot scope rejects empty, unknown, and path-like IDs before I/O", () => {
  const snapshot={rows:[{id:"42"},{id:"9007199254740993"}]}
  assert.equal(selectAuditRows(snapshot).length,2)
  assert.deepEqual(selectAuditRows(snapshot,"9007199254740993, 42,42").map(row=>row.id),["42","9007199254740993"])
  for (const ids of ["",",","43","42,43","../escape","9223372036854775808"]) {
    assert.throws(()=>selectAuditRows(snapshot,ids),undefined,ids)
  }
  for (const rows of [[{id:"../escape"}],[{id:42}],[{id:"42"},{id:"42"}]]) {
    assert.throws(()=>selectAuditRows({rows}))
  }
})

test("repair CLI accepts both ID option forms and never silently ignores a misspelled scope", () => {
  assert.equal(parseRepairArgs(["--ids", "42"]).ids,"42")
  assert.equal(parseRepairArgs(["--ids=42"]).ids,"42")
  assert.equal(parseRepairArgs(["--ids="]).ids,"")
  assert.throws(()=>parseRepairArgs(["--ids"]))
  assert.throws(()=>parseRepairArgs(["--id=42"]))
})
