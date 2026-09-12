import assert from "node:assert/strict"
import test from "node:test"

import {applyCafe24ReviewData} from "../src/lib/cafe24-engine"
import type {Cafe24Page} from "../src/lib/cafe24-page"
import {BoardReviewParser} from "../src/lib/parsers/review/board-review-parser"
import {CompositeReviewParser} from "../src/lib/parsers/review/composite-review-parser"
import {NoopReviewParser} from "../src/lib/parsers/review/noop-review-parser"
import type {IReviewParser, ReviewData} from "../src/lib/parsers/review/types"
import type {Product} from "../src/lib/types"

function parser(result: ReviewData | Error): IReviewParser {
  return {parse: async () => { if (result instanceof Error) throw result; return result }}
}

const review = {text: "A complete sampled review", author: "Kim", date: "2026-09-01", photoUrls: [], body: null}

test("noop parser explicitly means not requested, never confirmed empty", async () => {
  const result = await new NoopReviewParser().parse({} as Cafe24Page, 10)
  assert.deepEqual(result.reviewCollection, {status: "not_requested", observedAt: null, confirmedEmpty: false})
})

test("authoritative board with zero rows produces confirmed empty", async () => {
  let evaluateCall = 0
  const page = {
    url: () => "https://example.com/product/1",
    goto: async () => null,
    waitForTimeout: async () => {},
    evaluate: async () => ++evaluateCall === 1
      ? {boardUrl: "/board/product/list.html?board_no=4&link_product_no=1", count: 0, countObserved: true}
      : [],
  } as unknown as Cafe24Page
  const result = await new BoardReviewParser().parse(page, 10)
  assert.equal(result.reviewCollection.status, "succeeded")
  assert.equal(result.reviewCollection.confirmedEmpty, true)
  assert.deepEqual(result.reviews, [])
})

test("bounded ten-review board sample is a successful complete sample", async () => {
  let evaluateCall = 0
  const rows = Array.from({length: 10}, (_, index) => ({author: `user-${index}`, date: null, text: `review text ${index}`, photoUrls: [], detailUrl: null}))
  const page = {
    url: () => "https://example.com/product/1",
    goto: async () => null,
    waitForTimeout: async () => {},
    evaluate: async () => ++evaluateCall === 1
      ? {boardUrl: "/board/product/list.html?board_no=4&link_product_no=1", count: 25, countObserved: true}
      : rows,
  } as unknown as Cafe24Page
  const result = await new BoardReviewParser().parse(page, 10)
  assert.equal(result.reviewCollection.status, "succeeded")
  assert.equal(result.reviewCollection.confirmedEmpty, false)
  assert.equal(result.reviews.length, 10)
  assert.equal(result.reviewCount, 25)
})

test("composite fallback can succeed after a failed strategy", async () => {
  const failed: ReviewData = {reviewCount: 0, reviews: [], reviewCollection: {status: "failed", observedAt: null, confirmedEmpty: false, error: "board failed"}}
  const succeeded: ReviewData = {reviewCount: 1, reviews: [review], reviewCollection: {status: "succeeded", observedAt: "2026-09-12T00:00:00Z", confirmedEmpty: false}}
  const page = {url: () => "https://example.com/product/1", goto: async () => null, waitForTimeout: async () => {}} as unknown as Cafe24Page
  const result = await new CompositeReviewParser([parser(failed), parser(succeeded)]).parse(page, 10)
  assert.deepEqual(result, succeeded)
})

test("composite preserves partial data when every fallback fails", async () => {
  const partial: ReviewData = {reviewCount: 2, reviews: [review], reviewCollection: {status: "partial", observedAt: "2026-09-12T00:00:00Z", confirmedEmpty: false, error: "one detail failed"}}
  const page = {url: () => "https://example.com/product/1", goto: async () => null, waitForTimeout: async () => {}} as unknown as Cafe24Page
  const result = await new CompositeReviewParser([parser(partial), parser(new Error("timeout"))]).parse(page, 10)
  assert.deepEqual(result, partial)
})

test("partial and failed attempts retain prior reviews while recording provenance", () => {
  const product = {reviewCount: 1, reviews: [review]} as Product
  applyCafe24ReviewData(product, {reviewCount: 0, reviews: [], reviewCollection: {status: "failed", observedAt: null, confirmedEmpty: false, error: "parse failed"}})
  assert.equal(product.reviewCount, 1)
  assert.deepEqual(product.reviews, [review])
  assert.equal(product.reviewCollection?.status, "failed")
  applyCafe24ReviewData(product, {reviewCount: 2, reviews: [review], reviewCollection: {status: "partial", observedAt: "2026-09-12T00:00:00Z", confirmedEmpty: false}})
  assert.equal(product.reviewCount, 1)
  assert.deepEqual(product.reviews, [review])
})

test("successful explicit empty replaces prior reviews", () => {
  const product = {reviewCount: 1, reviews: [review]} as Product
  applyCafe24ReviewData(product, {reviewCount: 0, reviews: [], reviewCollection: {status: "succeeded", observedAt: "2026-09-12T00:00:00Z", confirmedEmpty: true}})
  assert.equal(product.reviewCount, 0)
  assert.deepEqual(product.reviews, [])
})
