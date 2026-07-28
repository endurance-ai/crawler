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

test("representativeImage: embed_products.py 와 같은 규칙", () => {
  assert.equal(
    representativeImage({images: ["https://cdn/a.jpg"], image_url: "https://cdn/b.jpg"}),
    "https://cdn/a.jpg",
    "images[0] 우선",
  )
  assert.equal(
    representativeImage({images: [], image_url: "https://cdn/b.jpg"}),
    "https://cdn/b.jpg",
    "images 가 비면 image_url",
  )
  assert.equal(
    representativeImage({images: null, image_url: "https://cdn/b.jpg"}),
    "https://cdn/b.jpg",
    "images 가 NULL 인 행이 3만4천개 있다 — image_url 로 폴백해야 한다",
  )
  assert.equal(
    representativeImage({images: [""], image_url: "https://cdn/b.jpg"}),
    "https://cdn/b.jpg",
    "빈 문자열인 첫 원소는 무시 (py 쪽 `imgs and imgs[0]` 가드와 동일)",
  )
  assert.equal(representativeImage({images: [], image_url: null}), null)
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

test("normalizeImageUrl: 각도별 파일명(_top/_back/_front/_side)도 같은 이미지로 본다", () => {
  // 2026-07-28 파일럿 032c 실측: "32_00245-2_top.jpg" vs "32_00245-2.jpg" 가
  // 변경 비율 20% 경보를 넘겨 임베딩 무효화가 자동 보류됐다.
  assert.equal(
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/1018/1547/files/32_00245-2_top.jpg"),
    normalizeImageUrl("https://cdn.shopify.com/s/files/1/1018/1547/files/32_00245-2.jpg"),
  )
  for (const angle of ["bottom", "back", "front", "side", "detail", "alt", "flat"]) {
    assert.equal(
      normalizeImageUrl(`https://cdn.shopify.com/s/files/1/shirt_${angle}.jpg`),
      normalizeImageUrl("https://cdn.shopify.com/s/files/1/shirt.jpg"),
      `_${angle} 접미사도 동일 상품 사진으로 취급해야 한다`,
    )
  }
  assert.equal(normalizeImageUrl("not a url"), "not a url", "파싱 실패는 원문 유지 — 같은 값끼리는 같다고 판정된다")
})

test("diffImageSnapshots: 실제로 바뀐 행만 무효화 대상", () => {
  const before: ImageSnapshotRow[] = [
    {id: 1, images: ["https://cdn/a.jpg?v=1"], image_url: null},
    {id: 2, images: ["https://cdn/b.jpg"], image_url: null},
    {id: 3, images: null, image_url: null},
    {id: 4, images: ["https://cdn/d.jpg"], image_url: null},
  ]
  const after: ImageSnapshotRow[] = [
    {id: 1, images: ["https://cdn/a.jpg?v=2"], image_url: null}, // unchanged (캐시버스터만 다름)
    {id: 2, images: ["https://cdn/b2.jpg"], image_url: null}, // changed
    {id: 3, images: ["https://cdn/c.jpg"], image_url: null}, // was_null_now_set
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
    [2, 3],
    "changed 와 was_null_now_set 만 지운다",
  )
})

test("diffImageSnapshots: 대표 이미지가 사라진 행은 지우지 않는다", () => {
  // 새로 임베딩할 원본이 없으므로 지우면 검색에서 그냥 사라진다.
  // 옛 벡터라도 남겨두고, 지울지는 사람이 따로 판단한다.
  const summary = diffImageSnapshots(
    [{id: 1, images: ["https://cdn/a.jpg"], image_url: null}],
    [{id: 1, images: [], image_url: null}],
  )
  assert.equal(summary.byBucket.was_set_now_null, 1)
  assert.deepEqual(summary.invalidateIds, [])
})

test("diffImageSnapshots: 신규 행은 임베딩이 없으므로 대상이 아니다", () => {
  const summary = diffImageSnapshots([], [{id: 9, images: ["https://cdn/z.jpg"], image_url: null}])
  assert.equal(summary.byBucket.new_row, 1)
  assert.deepEqual(summary.invalidateIds, [])
})

test("diffImageSnapshots: 사라진 행도 대상이 아니다", () => {
  const summary = diffImageSnapshots([{id: 1, images: ["https://cdn/a.jpg"], image_url: null}], [])
  assert.equal(summary.byBucket.missing_row, 1)
  assert.deepEqual(summary.invalidateIds, [])
})

test("changeRatio: 정규화가 CDN 패턴을 놓치면 비율이 튄다 (경보의 근거)", () => {
  const before: ImageSnapshotRow[] = Array.from({length: 100}, (_, i) => ({
    id: i,
    images: [`https://cdn.shopify.com/s/files/1/p${i}.jpg?v=1`],
    image_url: null,
  }))
  // 캐시버스터만 바뀐 경우 — 정규화가 제대로면 0%
  const onlyCacheBust: ImageSnapshotRow[] = before.map((row) => ({
    ...row,
    images: [row.images![0]!.replace("v=1", "v=2")],
  }))
  assert.equal(changeRatio(diffImageSnapshots(before, onlyCacheBust)), 0)

  // 진짜로 절반이 바뀐 경우
  const halfChanged: ImageSnapshotRow[] = before.map((row, i) =>
    i < 50 ? {...row, images: [`https://cdn.shopify.com/s/files/1/new${i}.jpg`]} : row,
  )
  assert.equal(changeRatio(diffImageSnapshots(before, halfChanged)), 0.5)
})
