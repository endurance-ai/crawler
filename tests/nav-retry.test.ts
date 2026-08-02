import assert from "node:assert/strict"
import test from "node:test"

import {gotoWithRetry, type NavigablePage} from "../src/lib/nav-retry"

/** goto 결과를 시나리오대로 흉내내는 가짜 페이지. */
function fakePage(outcomes: Array<"ok" | string>): NavigablePage & {calls: number; timeouts: number[]} {
  const state = {
    calls: 0,
    timeouts: [] as number[],
    goto: async (_url: string, options: {waitUntil: "domcontentloaded"; timeout: number}) => {
      const outcome = outcomes[state.calls] ?? "ok"
      state.calls += 1
      state.timeouts.push(options.timeout)
      if (outcome !== "ok") throw new Error(outcome)
      return null
    },
  }
  return state
}

const noSleep = async () => {}

test("첫 시도에 성공하면 재시도하지 않는다", async () => {
  const page = fakePage(["ok"])
  const result = await gotoWithRetry(page, "https://x.test/", {sleep: noSleep})
  assert.deepEqual(result, {ok: true, attempts: 1, error: null})
  assert.equal(page.calls, 1)
})

test("일시적 타임아웃은 재시도로 흡수한다", async () => {
  // 실측 근거: DNS 지연은 간헐적이라 한 번 더 두드리면 대개 붙는다.
  const page = fakePage(["page.goto: Timeout 60000ms exceeded.", "ok"])
  const retries: number[] = []
  const result = await gotoWithRetry(page, "https://x.test/", {
    sleep: noSleep,
    onRetry: (attempt) => retries.push(attempt),
  })
  assert.equal(result.ok, true)
  assert.equal(result.attempts, 2)
  assert.deepEqual(retries, [1])
})

test("모든 시도가 실패하면 마지막 사유를 첫 줄만 담아 돌려준다", async () => {
  const page = fakePage([
    "page.goto: Timeout 60000ms exceeded.\nCall log:\n  - navigating to ...",
    "net::ERR_NAME_NOT_RESOLVED",
    "net::ERR_NAME_NOT_RESOLVED",
  ])
  const result = await gotoWithRetry(page, "https://x.test/", {sleep: noSleep})
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 3)
  assert.equal(result.error, "net::ERR_NAME_NOT_RESOLVED")
  assert.equal(page.calls, 3)
})

test("여러 줄 오류 메시지는 첫 줄만 남긴다", async () => {
  const page = fakePage(["page.goto: Timeout 60000ms exceeded.\nCall log:\n  - navigating"])
  const result = await gotoWithRetry(page, "https://x.test/", {attempts: 1, sleep: noSleep})
  assert.equal(result.error, "page.goto: Timeout 60000ms exceeded.")
})

test("타임아웃은 종전 60초를 유지하고 시도마다 동일하게 적용된다", async () => {
  const page = fakePage(["fail", "fail", "ok"])
  await gotoWithRetry(page, "https://x.test/", {sleep: noSleep})
  assert.deepEqual(page.timeouts, [60_000, 60_000, 60_000])
})

test("attempts=1 이면 재시도하지 않는다", async () => {
  const page = fakePage(["fail", "ok"])
  const result = await gotoWithRetry(page, "https://x.test/", {attempts: 1, sleep: noSleep})
  assert.equal(result.ok, false)
  assert.equal(page.calls, 1)
})

test("백오프는 1.5초 → 4초로 늘어난다", async () => {
  const page = fakePage(["fail", "fail", "fail"])
  const waited: number[] = []
  await gotoWithRetry(page, "https://x.test/", {
    sleep: async (ms) => {
      waited.push(ms)
    },
  })
  assert.deepEqual(waited, [1_500, 4_000])
})
