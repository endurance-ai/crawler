import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  collectImageCandidatesFromHtml,
  rankImageCandidates,
  type ImageCandidateAnalysis,
} from "../src/lib/product-image-selection"
import {isPublicIp} from "../src/lib/safe-remote-image"

function candidate(
  url: string,
  patch: Partial<ImageCandidateAnalysis> = {},
): ImageCandidateAnalysis {
  return {
    url,
    width: 1200,
    height: 1600,
    byteLength: 300_000,
    mimeType: "image/jpeg",
    decoded: true,
    isAnimated: false,
    isUtility: false,
    aestheticsScore: 0.2,
    textCoverage: 0,
    humanConfidence: 0,
    humanAreaRatio: 0,
    humanCenterDistance: 1,
    poseJointCount: 0,
    foregroundAreaRatio: 0.5,
    foregroundCenterDistance: 0.1,
    ...patch,
  }
}

test("collectImageCandidatesFromHtml merges structured data, srcset, and gallery images", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@type": "Product",
        "name": "Jacket",
        "image": [
          "https://cdn.example.com/model.jpg",
          "https://cdn.example.com/product.jpg"
        ]
      }
    </script>
    <div class="xans-product-image">
      <img src="/web/product/small/thumb.jpg"
           srcset="/web/product/medium/look.jpg 800w, /web/product/big/look.jpg 1600w">
    </div>
    <img src="/web/upload/icon_badge.png">
  `

  assert.deepEqual(
    collectImageCandidatesFromHtml(html, "https://shop.example.com/product/jacket/1"),
    [
      "https://cdn.example.com/model.jpg",
      "https://cdn.example.com/product.jpg",
      "https://shop.example.com/web/product/big/look.jpg",
      "https://shop.example.com/web/product/medium/look.jpg",
      "https://shop.example.com/web/product/small/thumb.jpg",
    ],
  )
})

test("collectImageCandidatesFromHtml keeps current image first without truncating candidates", () => {
  const tags = Array.from(
    {length: 14},
    (_, i) => `<img src="https://cdn.example.com/${i}.jpg">`,
  ).join("")

  const result = collectImageCandidatesFromHtml(
    tags,
    "https://shop.example.com/p/1",
    ["https://cdn.example.com/current.jpg"],
  )

  assert.equal(result.length, 15)
  assert.equal(result[0], "https://cdn.example.com/current.jpg")
})

test("rankImageCandidates prefers an eligible prominent model shot", () => {
  const product = candidate("https://cdn.example.com/product.jpg", {
    aestheticsScore: 0.8,
    foregroundAreaRatio: 0.7,
  })
  const model = candidate("https://cdn.example.com/model.jpg", {
    humanConfidence: 0.9,
    humanAreaRatio: 0.55,
    humanCenterDistance: 0.08,
    poseJointCount: 10,
    aestheticsScore: 0.1,
  })

  const result = rankImageCandidates([product, model], product.url)
  assert.equal(result.selected.url, model.url)
  assert.equal(result.kind, "model")
  assert.deepEqual(result.ordered.map((item) => item.url), [model.url, product.url])
})

test("rankImageCandidates rejects tiny or utility model shots", () => {
  const product = candidate("https://cdn.example.com/product.jpg")
  const tinyModel = candidate("https://cdn.example.com/tiny-model.jpg", {
    width: 300,
    height: 400,
    humanConfidence: 0.95,
    humanAreaRatio: 0.5,
    poseJointCount: 12,
  })
  const sizeChart = candidate("https://cdn.example.com/chart.jpg", {
    humanConfidence: 0.9,
    humanAreaRatio: 0.5,
    poseJointCount: 8,
    isUtility: true,
    textCoverage: 0.7,
  })

  const result = rankImageCandidates([tinyModel, sizeChart, product], product.url)
  assert.equal(result.selected.url, product.url)
  assert.equal(result.kind, "product")
})

test("rankImageCandidates falls back to the current image when every candidate is invalid", () => {
  const current = candidate("https://cdn.example.com/current.jpg", {decoded: false})
  const broken = candidate("https://cdn.example.com/broken.jpg", {decoded: false})

  const result = rankImageCandidates([broken, current], current.url)
  assert.equal(result.selected.url, current.url)
  assert.equal(result.kind, "fallback")
  assert.equal(result.score, 0)
})

test("rankImageCandidates is deterministic for tied candidates", () => {
  const first = candidate("https://cdn.example.com/a.jpg")
  const second = candidate("https://cdn.example.com/b.jpg")

  const one = rankImageCandidates([first, second], first.url)
  const two = rankImageCandidates([first, second], first.url)

  assert.deepEqual(one, two)
  assert.equal(one.selected.url, first.url)
})

test("remote image guard rejects private, loopback, and documentation addresses", () => {
  assert.equal(isPublicIp("8.8.8.8"), true)
  assert.equal(isPublicIp("10.0.0.1"), false)
  assert.equal(isPublicIp("127.0.0.1"), false)
  assert.equal(isPublicIp("169.254.169.254"), false)
  assert.equal(isPublicIp("192.168.0.2"), false)
  assert.equal(isPublicIp("203.0.113.9"), false)
  assert.equal(isPublicIp("::1"), false)
  assert.equal(isPublicIp("fc00::1"), false)
  assert.equal(isPublicIp("2001:4860:4860::8888"), true)
})
