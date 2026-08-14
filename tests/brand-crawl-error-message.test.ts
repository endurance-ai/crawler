import assert from "node:assert/strict"
import test from "node:test"

import {crawlErrorMessage} from "../src/brand-crawl"

test("crawlErrorMessage exposes a hidden fetch transport code", () => {
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND example.invalid"), {code: "ENOTFOUND"})
  const error = new TypeError("fetch failed", {cause})
  assert.equal(crawlErrorMessage(error), "fetch failed (ENOTFOUND)")
})

test("crawlErrorMessage preserves an ordinary error", () => {
  assert.equal(crawlErrorMessage(new Error("homepage is missing")), "homepage is missing")
})
