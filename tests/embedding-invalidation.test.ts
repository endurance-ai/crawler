/**
 * 재수집 후 임베딩 무효화 판정.
 *
 * product_embeddings 에는 무효화 트리거도 이미지 해시도 없다 —
 * embed_products.py 의 pending 판정이 순수 "행 없음" 안티조인이라, 행을 지우는
 * 것이 유일한 무효화 수단이다. 그래서 두 방향의 오류가 다 비싸다:
 *   - 과소 판정 → 이미지가 바뀐 상품이 옛 벡터로 영원히 검색된다.
 *   - 과대 판정 → 6만 건을 통째로 재임베딩한다.
 * 정규화가 CDN 캐시버스터를 못 걸러내면 곧바로 후자가 된다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  changeRatio,
  diffImageSnapshots,
  normalizeImageUrl,
  representativeImage,
  type ImageSnapshotRow,
} from "../src/lib/embedding-invalidation"

test("representativeImage: image_url 이 canonical representative", () => {
  assert.equal(
    representativeImage({images: ["https://cdn/a.jpg"], image_url: "https://cdn/b.jpg"}),
    "https://cdn/b.jpg",
    "images[0] 이 달라도 image_url 우선",
  )
  assert.equal(
    representativeImage({images: [], image_url: "https://cdn/b.jpg"}),
    "https://cdn/b.jpg",
    "images 배열과 무관",
  )
  assert.equal(
    representativeImage({images: null, image_url: "https://cdn/b.jpg"}),
    "https://cdn/b.jpg",
    "images 가 NULL 이어도 image_url",
  )
  assert.equal(
    representativeImage({images: [""], image_url: "https://cdn/b.jpg"}),
    "https://cdn/b.jpg",
    "빈 images[0] 도 대표 판정에 영향 없음",
  )
  assert.equal(
    representativeImage({images: ["https://cdn/a.jpg"], image_url: null}),
    null,
    "image_url 이 없으면 대표 이미지도 없음",
  )
})

test("normalizeImageUrl: 캐시버스터와 리사이즈 접미사를 같은 이미지로 본다", () => {
  const a = normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt.jpg?v=1699999999&width=1024")
  const b = normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt.jpg?v=1700000000&width=512")
  assert.equal(a, b, "쿼리스트링(버전/사이즈)은 이미지 변경이 아니다")

  assert.equal(
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt_1024x1024.jpg"),
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt.jpg"),
    "Shopify 사이즈 접미사 _1024x1024 는 같은 원본의 리사이즈본",
  )
  assert.equal(
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt_800x.jpg"),
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt.jpg"),
    "_800x 형태도 동일",
  )

  assert.equal(
    normalizeImageUrl("http://WWW.Example.com/a.jpg"),
    normalizeImageUrl("https://example.com/a.jpg"),
    "스킴/대소문자/www 는 변경이 아니다",
  )

  assert.notEqual(
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt.jpg"),
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/coat.jpg"),
    "파일명이 다르면 진짜 변경",
  )

  assert.equal(normalizeImageUrl(null), null)
  assert.equal(normalizeImageUrl("   "), null)
})

test("normalizeImageUrl: 각도별 대표 이미지는 다른 임베딩 입력으로 본다", () => {
  assert.notEqual(
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/1018/1547/files/32_00245-2_top.jpg"),
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/1018/1547/files/32_00245-2.jpg"),
  )
  for (const angle of ["bottom", "back", "front", "side", "detail", "alt", "flat"]) {
    assert.notEqual(
      normalizeImageUrl(`https://cdn.shopify.com/s/files/1/shirt_${angle}.jpg`),
      normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt.jpg"),
      `_${angle} 대표 이미지 변경은 임베딩을 무효화해야 한다`,
    )
  }
  assert.equal(normalizeImageUrl("not a url"), "not a url", "파싱 실패는 원문 유지 — 같은 값끼리는 같다고 판정된다")
})

test("diffImageSnapshots: 실제로 바뀐 행만 무효화 대상", () => {
  const before: ImageSnapshotRow[] = [
    {id: 1, images: ["https://cdn/a.jpg?v=1"], image_url: "https://cdn/a.jpg?v=1"},
    {id: 2, images: ["https://cdn/b.jpg"], image_url: "https://cdn/b.jpg"},
    {id: 3, images: null, image_url: null},
    {id: 4, images: ["https://cdn/d.jpg"], image_url: "https://cdn/d.jpg"},
  ]
  const after: ImageSnapshotRow[] = [
    {id: 1, images: ["https://cdn/a.jpg?v=2"], image_url: "https://cdn/a.jpg?v=2"}, // unchanged
    {id: 2, images: ["https://cdn/b2.jpg"], image_url: "https://cdn/b2.jpg"}, // changed
    {id: 3, images: ["https://cdn/c.jpg"], image_url: "https://cdn/c.jpg"}, // was_null_now_set
    {id: 4, images: [], image_url: null}, // was_set_now_null
    {id: 5, images: ["https://cdn/e.jpg"], image_url: null}, // new_row
  ]

  const summary = diffImageSnapshots(before, after)
  assert.equal(summary.byBucket.unchanged, 1)
  assert.equal(summary.byBucket.changed, 1)
  assert.equal(summary.byBucket.was_null_now_set, 1)
  assert.equal(summary.byBucket.was_set_now_null, 1)
  assert.equal(summary.byBucket.new_row, 1)

  assert.deepEqual(
    summary.invalidateIds.sort((a, b) => a - b),
    [2, 3, 4],
    "변경·신규 대표·대표 소실을 모두 무효화한다",
  )
})

test("diffImageSnapshots: 대표 이미지가 사라진 행도 옛 임베딩을 지운다", () => {
  const summary = diffImageSnapshots(
    [{id: 1, images: ["https://cdn/a.jpg"], image_url: "https://cdn/a.jpg"}],
    [{id: 1, images: [], image_url: null}],
  )
  assert.equal(summary.byBucket.was_set_now_null, 1)
  assert.deepEqual(summary.invalidateIds, [1])
})

test("diffImageSnapshots: 신규 행은 임베딩이 없으므로 대상이 아니다", () => {
  const summary = diffImageSnapshots([], [
    {id: 9, images: ["https://cdn/z.jpg"], image_url: "https://cdn/z.jpg"},
  ])
  assert.equal(summary.byBucket.new_row, 1)
  assert.deepEqual(summary.invalidateIds, [])
})

test("diffImageSnapshots: 사라진 행도 대상이 아니다", () => {
  const summary = diffImageSnapshots(
    [{id: 1, images: ["https://cdn/a.jpg"], image_url: "https://cdn/a.jpg"}],
    [],
  )
  assert.equal(summary.byBucket.missing_row, 1)
  assert.deepEqual(summary.invalidateIds, [])
})

test("changeRatio: 정규화가 CDN 패턴을 놓치면 비율이 튄다 (경보의 근거)", () => {
  const before: ImageSnapshotRow[] = Array.from({length: 100}, (_, i) => ({
    id: i,
    images: [`https://cdn.shopify.com/s/files/1/p${i}.jpg?v=1`],
    image_url: `https://cdn.shopify.com/s/files/1/p${i}.jpg?v=1`,
  }))
  // 캐시버스터만 바뀐 경우 — 정규화가 제대로면 0%
  const onlyCacheBust: ImageSnapshotRow[] = before.map((row) => ({
    ...row,
    images: [row.images![0]!.replace("v=1", "v=2")],
    image_url: row.image_url!.replace("v=1", "v=2"),
  }))
  assert.equal(changeRatio(diffImageSnapshots(before, onlyCacheBust)), 0)

  // 진짜로 절반이 바뀐 경우
  const halfChanged: ImageSnapshotRow[] = before.map((row, i) =>
    i < 50
      ? {
          ...row,
          images: [`https://cdn.shopify.com/s/files/1/new${i}.jpg`],
          image_url: `https://cdn.shopify.com/s/files/1/new${i}.jpg`,
        }
      : row,
  )
  assert.equal(changeRatio(diffImageSnapshots(before, halfChanged)), 0.5)
})
