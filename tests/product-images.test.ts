import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  collectProductImagesFromHtml,
  extractShopifyProductImages,
  isProductImageUtilityAsset,
  mergeProductImages,
  normalizeProductImageUrl,
  sanitizeProductImageFields,
} from "../src/lib/product-images"

test("mergeProductImages keeps representative first and deduplicates normalized URLs", () => {
  assert.deepEqual(
    mergeProductImages(
      "/images/main.jpg#hero",
      "https://shop.example.com/products/1",
      ["https://shop.example.com/images/a.jpg", "/images/main.jpg"],
      ["https://shop.example.com/images/a.jpg", "/images/b.jpg"],
    ),
    [
      "https://shop.example.com/images/main.jpg",
      "https://shop.example.com/images/a.jpg",
      "https://shop.example.com/images/b.jpg",
    ],
  )
})

test("normalizeProductImageUrl rejects utility, template, and non-image assets", () => {
  const page = "https://shop.example.com/products/1"
  assert.equal(normalizeProductImageUrl("/web/upload/icon_badge.png", page), null)
  assert.equal(
    normalizeProductImageUrl(
      "https://img.echosting.cafe24.com/skin/base_ko_KR/common/ico_tip_title.gif",
      page,
    ),
    null,
  )
  assert.equal(
    normalizeProductImageUrl(
      "https://img.echosting.cafe24.com/design/skin/admin/ko_KR/ico_product_point.gif",
      page,
    ),
    null,
  )
  assert.equal(normalizeProductImageUrl("/images/size-guide.jpg", page), null)
  assert.equal(normalizeProductImageUrl("${imageUrl}", page), null)
  assert.equal(normalizeProductImageUrl("javascript:alert(1)", page), null)
  assert.equal(normalizeProductImageUrl("/assets/product?id=1", page), "https://shop.example.com/assets/product?id=1")
  assert.equal(
    normalizeProductImageUrl("/products/block-logo-tee-black.jpg", page),
    "https://shop.example.com/products/block-logo-tee-black.jpg",
  )
})

test("isProductImageUtilityAsset distinguishes UI assets from product names", () => {
  const page = "https://shop.example.com/products/1"
  assert.equal(isProductImageUtilityAsset("/common/ico_tip_title.gif", page), true)
  assert.equal(isProductImageUtilityAsset("/images/button_other_04.png", page), true)
  assert.equal(isProductImageUtilityAsset("/products/block-logo-tee-black.jpg", page), false)
})

test("sanitizeProductImageFields promotes a real candidate over a utility representative", () => {
  const utility = "https://img.echosting.cafe24.com/skin/base_ko_KR/common/ico_tip_title.gif"
  assert.deepEqual(
    sanitizeProductImageFields({
      productUrl: "https://shop.example.com/products/1",
      imageUrl: utility,
      sourceImageUrl: utility,
      images: [utility, "/images/product.jpg"],
    }),
    {
      imageUrl: "https://shop.example.com/images/product.jpg",
      sourceImageUrl: "https://shop.example.com/images/product.jpg",
      images: ["https://shop.example.com/images/product.jpg"],
    },
  )
})

test("collectProductImagesFromHtml uses structured and product-hinted images only", () => {
  const html = `
    <script type="application/ld+json">{
      "@type":"Product",
      "name":"Coat",
      "image":["https://cdn.example.com/main.jpg","https://cdn.example.com/back.jpg"]
    }</script>
    <img class="product-gallery" src="/small.jpg" srcset="/medium.jpg 800w, /large.jpg 1600w">
    <img class="recommended" src="https://cdn.example.com/other-product.jpg">
    <img src="/layout/header.jpg">
  `
  assert.deepEqual(
    collectProductImagesFromHtml(html, "https://shop.example.com/products/1"),
    [
      "https://cdn.example.com/main.jpg",
      "https://cdn.example.com/back.jpg",
      "https://shop.example.com/large.jpg",
      "https://shop.example.com/small.jpg",
    ],
  )
})

test("mergeProductImages remains unbounded", () => {
  const discovered = Array.from({length: 25}, (_, i) => `https://cdn.example.com/${i}.jpg`)
  assert.equal(mergeProductImages(discovered[0], discovered[0], discovered).length, 25)
})

test("extractShopifyProductImages covers images, media, and variants", () => {
  assert.deepEqual(
    extractShopifyProductImages({
      images: ["https://cdn.example/front.jpg", {src: "https://cdn.example/back.jpg"}],
      featured_image: "https://cdn.example/hero.jpg",
      media: [{preview_image: {src: "https://cdn.example/detail.jpg"}}],
      variants: [{featured_image: {src: "https://cdn.example/blue.jpg"}}],
    }),
    [
      "https://cdn.example/front.jpg",
      "https://cdn.example/back.jpg",
      "https://cdn.example/hero.jpg",
      "https://cdn.example/detail.jpg",
      "https://cdn.example/blue.jpg",
    ],
  )
})
