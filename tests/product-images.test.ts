import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  collectProductImagesFromHtml,
  extractShopifyProductImages,
  isProductImageUtilityAsset,
  isLowResolutionProductVariant,
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
  assert.equal(normalizeProductImageUrl("/web/main/nb03.jpg", page), null)
  assert.equal(normalizeProductImageUrl("/MD/a/campaign-LOGO.jpg", page), null)
  assert.equal(normalizeProductImageUrl("/product/txt_naver.gif", page), null)
  assert.equal(normalizeProductImageUrl("/images/color-swatch-red.png", page), null)
  assert.equal(normalizeProductImageUrl("/web/product/big/img_product_big.gif", page), null)
  assert.equal(normalizeProductImageUrl("${imageUrl}", page), null)
  assert.equal(normalizeProductImageUrl("javascript:alert(1)", page), null)
  assert.equal(normalizeProductImageUrl("/assets/product?id=1", page), "https://shop.example.com/assets/product?id=1")
  assert.equal(
    normalizeProductImageUrl("/products/block-logo-tee-black.jpg", page),
    "https://shop.example.com/products/block-logo-tee-black.jpg",
  )
})

test("normalizeProductImageUrl upgrades cleartext URLs to https", () => {
  const page = "https://shop.example.com/products/1"
  // iOS ATS blocks http:// outright, so a stored cleartext URL is a dead image
  // in the app even when the host redirects to https.
  assert.equal(
    normalizeProductImageUrl("http://shop.example.com/cdn/shop/files/tee.jpg?v=1", page),
    "https://shop.example.com/cdn/shop/files/tee.jpg?v=1",
  )
  // Protocol-relative URLs resolved against an http page get upgraded too.
  assert.equal(
    normalizeProductImageUrl("//cdn.shopify.com/s/files/tee.jpg", "http://shop.example.com/products/1"),
    "https://cdn.shopify.com/s/files/tee.jpg",
  )
  // The upgrade collapses http/https duplicates of the same asset.
  assert.deepEqual(
    mergeProductImages("http://shop.example.com/a.jpg", page, ["https://shop.example.com/a.jpg"]),
    ["https://shop.example.com/a.jpg"],
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

test("collectProductImagesFromHtml merges structured and product-hinted gallery images", () => {
  const html = `
    <script type="application/ld+json">{
      "@type":"Product",
      "name":"Coat",
      "image":["https://cdn.example.com/main.jpg","https://cdn.example.com/back.jpg"]
    }</script>
    <img class="product-gallery" src="/small.jpg" srcset="/medium.jpg 800w, /large.jpg 1600w">
    <img class="color-swatch" src="/red-swatch.jpg" width="40" height="40">
    <img id="option-image" src="/option-red.jpg" width="500" height="500">
    <img class="product-gallery" src="/tiny-gallery.jpg" width="64" height="64">
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

test("small product variants are retained only when no larger variant exists", () => {
  const page = "https://shop.example.com/products/1"
  assert.equal(isLowResolutionProductVariant("/web/product/small/2025/a.jpg", page), true)
  assert.equal(isLowResolutionProductVariant("/web/product/medium/2025/a.jpg", page), false)
  assert.deepEqual(
    collectProductImagesFromHtml(
      '<img class="product-gallery" src="/web/product/small/2025/a.jpg"><img class="product-gallery" src="/web/product/medium/2025/a.jpg">',
      page,
    ),
    ["https://shop.example.com/web/product/medium/2025/a.jpg"],
  )
  assert.deepEqual(
    collectProductImagesFromHtml('<img class="product-gallery" src="/web/product/small/2025/a.jpg">', page),
    ["https://shop.example.com/web/product/small/2025/a.jpg"],
  )
})

test("8division product data excludes global campaigns and unrelated product cards", () => {
  const html = `
    <script type="application/ld+json">{
      "@type":"Product",
      "name":"Bandana - Rectangle (Eggplant)",
      "image":[
        "https://www.8division.com/web/product/big/202605/9aa367a19dea094159269f58cc6504e8.jpg",
        "https://www.8division.com/web/product/extra/big/202605/one.jpg"
      ]
    }</script>
    <img class="main-banner" src="/web/main/nb03.jpg">
    <div class="xans-product-list"><img class="product-image" src="/web/product/medium/unrelated-shirt.png"></div>
  `
  assert.deepEqual(
    collectProductImagesFromHtml(html, "https://www.8division.com/product/bandana/1"),
    [
      "https://www.8division.com/web/product/big/202605/9aa367a19dea094159269f58cc6504e8.jpg",
      "https://www.8division.com/web/product/extra/big/202605/one.jpg",
    ],
  )
})

test("HTML fallback accepts only explicit galleries, not generic product cards", () => {
  const html = `
    <img class="product-image" src="/unowned-card.jpg">
    <img class="product-gallery-image" src="/owned-front.jpg">
    <img class="recommended product-gallery-image" src="/unowned-recommendation.jpg">
  `
  assert.deepEqual(
    collectProductImagesFromHtml(html, "https://shop.example.com/products/1"),
    ["https://shop.example.com/owned-front.jpg"],
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
