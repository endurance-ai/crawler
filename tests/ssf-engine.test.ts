import assert from "node:assert/strict"
import test from "node:test"

import {mergeSsfProductEvidence, parseSsfProductList, ssfTotalPages} from "../src/lib/ssf-engine"

const category = {
  path: "/JUUN-J/Shirts/list",
  dspCtgryNo: "SFMA42A02",
  category: "tops",
  gender: "men",
} as const

test("parses SSF listing evidence without guessing gender", () => {
  const html = `
    <input type="hidden" value="349" id="ctgryGodsListTotalRow" />
    <ul id="dspGood">
      <li data-prdno="GM001" view-godno="GM001" class="god-item">
        <a href="/JUUN-J/GM001/good?dspCtgryNo=SFMA42&amp;brandShopNo=BDMA07A11">
          <div class="god-img"><img src="https://img.ssfshop.com/goods/a.jpg" alt="shirt" /></div>
          <div class="god-info">
            <span class="name">Grid &amp; Needle Shirt</span>
            <span class="price"><del>690,000<span>원</span></del><em class="sale">5%</em>655,500<span>원</span></span>
          </div>
        </a>
      </li>
    </ul>`

  const products = parseSsfProductList(
    html,
    {baseUrl: "https://www.ssfshop.com", brand: "Juun.J", key: "juunj"},
    category,
  )

  assert.equal(products.length, 1)
  assert.deepEqual(products[0]?.gender, ["men"])
  assert.equal(products[0]?.genderSource, "engine")
  assert.equal(products[0]?.category, "tops")
  assert.equal(products[0]?.price, 655_500)
  assert.equal(products[0]?.originalPrice, 690_000)
  assert.equal(products[0]?.salePrice, 655_500)
  assert.equal(products[0]?.productCode, "GM001")
  assert.equal(products[0]?.productUrl, "https://www.ssfshop.com/JUUN-J/GM001/good")
  assert.equal(ssfTotalPages(html), 6)
})

test("the same SKU in official men and women departments is explicit unisex evidence", () => {
  const base = {
    brand: "Juun.J", name: "Shared", category: "tops", genderSource: "engine" as const,
    price: 1, originalPrice: null, salePrice: null, priceFormatted: "1원",
    imageUrl: "https://img.ssfshop.com/a.jpg", productUrl: "https://www.ssfshop.com/a",
    inStock: true, platform: "juunj", crawledAt: new Date(0).toISOString(), productCode: "A",
  }
  const merged = mergeSsfProductEvidence(
    {...base, gender: ["men"]},
    {...base, gender: ["women"]},
  )
  assert.deepEqual(merged.gender, ["unisex"])
  assert.equal(merged.genderSource, "engine")
})
