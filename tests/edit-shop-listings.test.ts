import {test} from "node:test"
import * as assert from "node:assert/strict"

import {getSiteConfig} from "../src/configs/platforms"
import {applyProductQcGate} from "../src/lib/product-qc/normalization"
import {
  collectCategoryListingSnapshots,
  extractWhat100ProductNos,
  validateWhat100ProductNos,
} from "../src/lib/edit-shop-listings"

test("Slow Steady Club is enabled with detail stock and all eleven source categories", () => {
  const config = getSiteConfig("slowsteadyclub")
  assert.ok(config)
  assert.notEqual(config.disabled, true)
  assert.equal(config.multiBrand, true)
  assert.equal(config.verifyStockFromDetail, true)
  assert.deepEqual(
    config.category?.categories?.map((item) => item.cateNo),
    [683, 742, 1020, 755, 774, 783, 1341, 798, 819, 674, 723],
  )
})

test("Cafe24 edit shops are multi-brand catalogs with trusted source taxonomy", () => {
  for (const platform of ["slowsteadyclub", "8division", "etcseoul", "fr8ight"]) {
    const config = getSiteConfig(platform)
    assert.ok(config)
    assert.equal(config.multiBrand, true)
    assert.equal(config.trustedCategory, true)
  }

  const config = getSiteConfig("etcseoul")!
  const products = applyProductQcGate(
    [{
      productUrl: "https://etcseoul.com/product/detail.html?product_no=1",
      name: "Source-taxonomy product",
      brand: "Example",
      category: "Outer",
      gender: ["women"],
      genderSource: "engine",
    }],
    "etcseoul",
    {
      trustedCategory: config.trustedCategory,
      recordReport: false,
    },
  )

  assert.equal(products.length, 1)
  assert.equal(products[0]?.category, "outerwear")
  assert.deepEqual(products[0]?.gender, ["women"])
})

test("What100 extraction keeps source order and removes repeated card links", () => {
  const html = `
    <a href="/product/a/31/?cate_no=1&amp;display_group=9&amp;product_no=31">image</a>
    <a href="/product/a/31/?display_group=9&amp;product_no=31">name</a>
    <a href="/product/b/22/?display_group=9&amp;product_no=22">image</a>
    <a href="/product/ignored/99/?display_group=1&amp;product_no=99">other group</a>
  `
  assert.deepEqual(extractWhat100ProductNos(html), [31, 22])
})

test("What100 publication rejects partial and duplicate snapshots", () => {
  assert.throws(() => validateWhat100ProductNos(Array.from({length: 99}, (_, index) => index + 1)), /expected 100/)
  assert.throws(() => validateWhat100ProductNos(Array.from({length: 100}, () => 1)), /expected 100/)
  assert.doesNotThrow(() => validateWhat100ProductNos(Array.from({length: 100}, (_, index) => index + 1)))
})

test("category placements survive product dedup without compressing source ranks", () => {
  const capturedAt = "2026-09-15T00:00:00.000Z"
  const snapshots = collectCategoryListingSnapshots([
    {
      productUrl: "https://slowsteadyclub.com/product/item/100/category/683/display/1/",
      listingPlacements: [
        {listType: "category", listKey: "683", displayName: "Outer", sourceRank: 2, capturedAt},
        {listType: "category", listKey: "742", displayName: "Top", sourceRank: 1, capturedAt},
      ],
    },
    {
      productUrl: "https://slowsteadyclub.com/product/item/101/category/683/display/1/",
      listingPlacements: [
        {listType: "category", listKey: "683", displayName: "Outer", sourceRank: 1, capturedAt},
      ],
    },
    {
      productUrl: "https://slowsteadyclub.com/product/item/100/category/683/display/1/",
      listingPlacements: [
        {listType: "category", listKey: "683", displayName: "Outer", sourceRank: 4, capturedAt},
      ],
    },
    {
      productUrl: "https://slowsteadyclub.com/product/item/102/category/683/display/1/",
      listingPlacements: [
        {listType: "category", listKey: "683", displayName: "Outer", sourceRank: 4, capturedAt},
      ],
    },
  ])

  assert.deepEqual(snapshots, [
    {
      listKey: "683",
      displayName: "Outer",
      capturedAt,
      items: [
        {product_no: 101, source_rank: 1},
        {product_no: 100, source_rank: 2},
        {product_no: 102, source_rank: 4},
      ],
    },
    {
      listKey: "742",
      displayName: "Top",
      capturedAt,
      items: [{product_no: 100, source_rank: 1}],
    },
  ])
})
