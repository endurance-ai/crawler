import {test} from "node:test"
import assert from "node:assert/strict"
import {getSiteConfig} from "../src/configs/platforms"
import {inferExplicitProductGender, resolveProductGenderWithSource} from "../src/lib/product-gender"
import {sameProductPage} from "../src/lib/product-url-identity"

test("explicit official audiences override a conflicting category gender", () => {
  for (const [name, existing, expected] of [
    ["(woman) loose pants", "men", "women"],
    ["coat (womens)", "men", "women"],
    ["TRUCKER FOR MEN IN WHITE", "women", "men"],
    ["For Mens bracelet", "women", "men"],
  ]) {
    assert.deepEqual(resolveProductGenderWithSource([existing], {name}), {gender:[expected], source:"text"})
  }
  assert.equal(inferExplicitProductGender("Rework Men's Tee"), null)
  assert.equal(inferExplicitProductGender("STANDMAN&WOMAN Tee"), null)
})

test("explicit product audience does not override contradictory product URL evidence", () => {
  const result=resolveProductGenderWithSource(["men"], {name:"(woman) coat",productUrl:"https://shop.example.com/men/coat"})
  assert.deepEqual(result.gender, [])
  assert.deepEqual(result.conflict, {url:"men",text:"women"})
})

test("audited DRAE and MONDAY EDITION product lines override category defaults", () => {
  for (const [platform,name] of [["en-579","MENS STRAIGHT EFFECT JEAN_BLUE"],["en-5258","For Mens bracelet"]]) {
    const config=getSiteConfig(platform)
    assert.ok(config?.genderTextPatterns)
    assert.deepEqual(resolveProductGenderWithSource(["women"],{name},"engine", {genderTextPatterns:config.genderTextPatterns}), {gender:["men"],source:"text"})
  }
})

test("Cafe24 canonical identities match only their own product and host", () => {
  const target="https://shop.example.com/product/detail.html?product_no=12"
  assert.equal(sameProductPage("https://shop.example.com/product/coat/12/",target),true)
  assert.equal(sameProductPage("https://shop.example.com/product/coat/13/",target),false)
  assert.equal(sameProductPage("https://other.example.com/product/coat/12/",target),false)
})
