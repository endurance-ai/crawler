import assert from "node:assert/strict"
import test from "node:test"

import {chunkByEncodedLength, chunkRowsByJsonSize} from "../src/lib/product-refresh"
import {
  backoffReason,
  backoffWaitMs,
  brandFromNamePrefix,
  buildPlatformRepairPlan,
  buildRefreshCandidateInputs,
  buildRefreshWorklist,
  candidateIdentity,
  computeFailureStreaks,
  matchExistingBrand,
  uniqueRefreshConfigs,
  type BrandLookupRow,
  type RefreshRunOutcome,
  type RefreshSourceState,
} from "../src/lib/refresh-source"
import type {SiteConfig} from "../src/lib/types"

const configs: SiteConfig[] = [
  {key: "kith", name: "Kith", type: "shopify", baseUrl: "https://kith.com"},
  {key: "browns", name: "Browns", type: "shopify", baseUrl: "https://www.brownsfashion.com"},
  {key: "zara-kr", name: "Zara KR", type: "zara", baseUrl: "https://www.zara.com/kr/ko"},
  {key: "zara-us", name: "Zara US", type: "zara", baseUrl: "https://www.zara.com/us/en"},
]

test("refresh 워크리스트는 brand status가 아니라 활성 config와 상품 수로 구성한다", () => {
  const states: RefreshSourceState[] = [
    {platform_key: "kith", last_attempted_at: "2026-07-20T00:00:00Z"},
    {platform_key: "browns", last_attempted_at: null},
  ]
  const result = buildRefreshWorklist({
    configs,
    sourceStates: states,
    productCounts: new Map([
      ["kith", 5814],
      ["browns", 11455],
      ["zara-kr", 3232],
    ]),
    types: new Set(["shopify", "zara"]),
  })

  assert.deepEqual(
    result.entries.map((entry) => [entry.platform_key, entry.product_count]),
    [
      ["browns", 11455],
      ["zara-kr", 3232],
      ["kith", 5814],
    ],
  )
  assert.ok(result.skipped.some((item) => item.includes("zara-us:no-products")))
})

test("excluded source는 워크리스트에서 빠지고 사유가 남는다", () => {
  const result = buildRefreshWorklist({
    configs,
    sourceStates: [],
    productCounts: new Map([
      ["kith", 5814],
      ["browns", 11455],
    ]),
    types: new Set(["shopify", "zara"]),
    excluded: new Set(["kith"]),
  })

  assert.deepEqual(
    result.entries.map((entry) => entry.platform_key),
    ["browns"],
  )
  assert.ok(result.skipped.includes("kith:excluded"))
})

test("excluded가 비어 있으면 워크리스트는 그대로다", () => {
  const args = {
    configs,
    sourceStates: [],
    productCounts: new Map([["browns", 11455]]),
    types: new Set(["shopify", "zara"]),
  }
  const withEmpty = buildRefreshWorklist({...args, excluded: new Set<string>()})

  assert.deepEqual(
    withEmpty.entries.map((entry) => entry.platform_key),
    buildRefreshWorklist(args).entries.map((entry) => entry.platform_key),
  )
})

test("refresh config는 동일 source 중복을 제거하고 충돌 키는 거부한다", () => {
  assert.equal(uniqueRefreshConfigs([...configs, {...configs[0]}]).length, configs.length)
  assert.throws(
    () =>
      uniqueRefreshConfigs([
        configs[0],
        {...configs[0], type: "cafe24", baseUrl: "https://other.test"},
      ]),
    /conflicting refresh config key kith/,
  )
})

test("platform 보정은 유일한 호스트만 바꾸고 공유 호스트는 거부한다", () => {
  const plan = buildPlatformRepairPlan(
    [
      {id: 1, platform: "shopify", product_url: "https://www.brownsfashion.com/products/a"},
      {id: 2, platform: "legacy", product_url: "https://www.zara.com/us/en/p/a"},
      {id: 3, platform: "kith", product_url: "https://kith.com/products/a"},
    ],
    configs,
  )

  assert.deepEqual(plan.changes, [
    {
      id: 1,
      product_url: "https://www.brownsfashion.com/products/a",
      before: "shopify",
      after: "browns",
    },
  ])
  assert.equal(plan.ambiguous.length, 1)
  assert.equal(plan.unchanged, 1)
})

test("신규상품 identity는 플랫폼 상품번호를 우선하고 URL로 폴백한다", () => {
  assert.equal(
    candidateIdentity(
      "kith",
      "https://x.com/product/skirt/878/category/50/display/1/",
    ),
    "kith:x.com#product_no=878",
  )
  assert.equal(
    candidateIdentity("kith", "https://kith.com/products/new-shirt?variant=1"),
    "kith:https://kith.com/products/new-shirt?variant=1",
  )
})

test("신규상품은 기존 브랜드가 정확히 하나일 때만 매칭한다", () => {
  const brands: BrandLookupRow[] = [
    {id: 10, brand_name: "Maison Margiela", brand_name_normalized: "maison margiela"},
    {id: 11, brand_name: "KITH", brand_name_normalized: "kith"},
  ]
  assert.equal(matchExistingBrand(" Maison   Margiela ", brands)?.id, 10)
  assert.equal(matchExistingBrand("new unknown brand", brands), null)
  assert.equal(
    matchExistingBrand("kith", [
      ...brands,
      {id: 12, brand_name: "Kith", brand_name_normalized: "kith"},
    ]),
    null,
  )
})

test("신규상품 후보는 미등록 브랜드를 brand_unmatched로 격리한다", () => {
  const rows = buildRefreshCandidateInputs(
    [
      {productUrl: "https://kith.com/products/a", brand: "KITH", name: "A"},
      {productUrl: "https://kith.com/products/b", brand: "Unknown", name: "B"},
    ],
    configs[0],
    [{id: 11, brand_name: "KITH", brand_name_normalized: "kith"}],
  )
  assert.deepEqual(
    rows.map((row) => [row.status, row.matched_brand_node_id]),
    [
      ["discovered", 11],
      ["brand_unmatched", null],
    ],
  )
})

test("멀티브랜드 상품의 vendor가 source fallback brand보다 우선한다", () => {
  const rows = buildRefreshCandidateInputs(
    [{productUrl: "https://multi.test/products/a", brand: "Maison Margiela"}],
    {
      key: "multi",
      name: "Multi Store",
      type: "shopify",
      baseUrl: "https://multi.test",
      brand: "Store Operator",
      multiBrand: true,
    },
    [
      {id: 10, brand_name: "Maison Margiela", brand_name_normalized: "maison margiela"},
      {id: 20, brand_name: "Store Operator", brand_name_normalized: "store operator"},
    ],
  )

  assert.equal(rows[0].matched_brand_node_id, 10)
  assert.equal(rows[0].detected_brand, "Maison Margiela")
})

test("단일브랜드 자사몰은 DOM 오인식 brand보다 config.brand가 우선한다", () => {
  // 2026-07-29 버그 수정: 자사몰(multiBrand 아님)에서 DOM 브랜드 추출이
  // 상품명/채움문자 등을 브랜드로 잘못 주워도 config.brand 가 이긴다.
  const rows = buildRefreshCandidateInputs(
    [{productUrl: "https://house.test/products/a", brand: "카듄 뒷밴딩 포켓 미니 스커트"}],
    {
      key: "house",
      name: "House Brand",
      type: "shopify",
      baseUrl: "https://house.test",
      brand: "House Operator",
    },
    [{id: 30, brand_name: "House Operator", brand_name_normalized: "houseoperator"}],
  )

  assert.equal(rows[0].matched_brand_node_id, 30)
  assert.equal(rows[0].detected_brand, "House Operator")
})

// ── C5 서킷브레이커 ──────────────────────────────────────────────────────────

const run = (
  platform_key: string,
  status: string,
  started_at: string | null,
): RefreshRunOutcome => ({platform_key, status, started_at})

test("연속 실패는 마지막 성공 이후만 센다", () => {
  const streaks = computeFailureStreaks([
    run("a", "failed", "2026-07-29T03:00:00Z"),
    run("a", "failed", "2026-07-29T02:00:00Z"),
    run("a", "success", "2026-07-29T01:00:00Z"),
    run("a", "failed", "2026-07-28T00:00:00Z"), // 성공 이전 — 세지 않는다
  ])
  assert.deepEqual(streaks.get("a"), {failures: 2, lastFailedAt: "2026-07-29T03:00:00Z"})
})

test("성공 기록이 없으면 전체 실패가 연쇄가 된다", () => {
  // 실측 2026-07-29: 연쇄 중인 49개 소스 대부분이 한 번도 성공한 적 없다.
  const streaks = computeFailureStreaks([
    run("kith", "failed", "2026-07-29T03:00:00Z"),
    run("kith", "failed", "2026-07-29T02:00:00Z"),
    run("kith", "failed", "2026-07-29T01:00:00Z"),
  ])
  assert.equal(streaks.get("kith")?.failures, 3)
})

test("성공만 있는 소스는 연쇄가 잡히지 않고 running/skipped는 연쇄를 바꾸지 않는다", () => {
  const streaks = computeFailureStreaks([
    run("ok", "success", "2026-07-29T01:00:00Z"),
    run("mid", "running", "2026-07-29T03:00:00Z"),
    run("mid", "failed", "2026-07-29T02:00:00Z"),
    run("mid", "success", "2026-07-29T01:00:00Z"),
  ])
  assert.equal(streaks.has("ok"), false)
  assert.equal(streaks.get("mid")?.failures, 1)
})

test("backoff 계단은 2회까지 쉬지 않고 3회부터 늘어난다", () => {
  assert.equal(backoffWaitMs(0), 0)
  assert.equal(backoffWaitMs(2), 0)
  assert.equal(backoffWaitMs(3), 12 * 3_600_000)
  assert.equal(backoffWaitMs(4), 24 * 3_600_000)
  assert.equal(backoffWaitMs(99), 14 * 24 * 3_600_000)
})

test("backoff 잔여시간이 남았을 때만 스킵 사유를 돌려준다", () => {
  const streak = {failures: 4, lastFailedAt: "2026-07-29T00:00:00Z"}
  // 4회 → 24시간. 12시간 경과 시점에는 아직 대기.
  const during = backoffReason(streak, new Date("2026-07-29T12:00:00Z"))
  assert.match(String(during), /backoff\(4연속실패/)
  // 25시간 경과 시점에는 다시 시도 대상.
  assert.equal(backoffReason(streak, new Date("2026-07-30T01:00:00Z")), null)
  assert.equal(backoffReason(undefined, new Date()), null)
})

test("lastFailedAt 을 모르면 backoff 하지 않는다 (fail-open)", () => {
  // 언제부터 쉬어야 할지 계산할 수 없는데 스킵하면 소스가 영구히 사라진다.
  assert.equal(backoffReason({failures: 9, lastFailedAt: null}, new Date()), null)
  assert.equal(backoffReason({failures: 9, lastFailedAt: "not-a-date"}, new Date()), null)
})

test("워크리스트는 backoff 중인 소스를 사유와 함께 제외하고 --ignore-backoff 로 되돌린다", () => {
  const args = {
    configs,
    sourceStates: [] as RefreshSourceState[],
    productCounts: new Map([
      ["kith", 5814],
      ["browns", 11455],
    ]),
    types: new Set(["shopify", "zara"]),
    streaks: new Map([["kith", {failures: 4, lastFailedAt: "2026-07-29T00:00:00Z"}]]),
    now: new Date("2026-07-29T06:00:00Z"),
  }

  const gated = buildRefreshWorklist(args)
  assert.deepEqual(
    gated.entries.map((entry) => entry.platform_key),
    ["browns"],
  )
  assert.ok(gated.skipped.some((item) => item.startsWith("kith:backoff(4연속실패")))

  const forced = buildRefreshWorklist({...args, ignoreBackoff: true})
  assert.deepEqual(
    forced.entries.map((entry) => entry.platform_key).sort(),
    ["browns", "kith"],
  )
})

test("상품이 없는 소스는 backoff 가 아니라 no-products 로 보고한다", () => {
  // 사유가 겹치면 운영자가 원인을 잘못 짚는다.
  const result = buildRefreshWorklist({
    configs,
    sourceStates: [],
    productCounts: new Map([["browns", 11455]]),
    types: new Set(["shopify", "zara"]),
    streaks: new Map([["kith", {failures: 9, lastFailedAt: "2026-07-29T00:00:00Z"}]]),
    now: new Date("2026-07-29T01:00:00Z"),
  })
  assert.ok(result.skipped.includes("kith:no-products"))
  assert.equal(
    result.skipped.some((item) => item.startsWith("kith:backoff")),
    false,
  )
})

test("streaks 를 주지 않으면 종전대로 전부 시도한다", () => {
  const result = buildRefreshWorklist({
    configs,
    sourceStates: [],
    productCounts: new Map([
      ["kith", 5814],
      ["browns", 11455],
    ]),
    types: new Set(["shopify", "zara"]),
  })
  assert.deepEqual(
    result.entries.map((entry) => entry.platform_key).sort(),
    ["browns", "kith"],
  )
})

// ── C1 선행: last_seen_at PATCH 필터 청킹 ────────────────────────────────────

test("chunkByEncodedLength: 인코딩 길이 예산으로 자르고 순서를 보존한다", () => {
  // PostgREST 는 PATCH 필터를 쿼리스트링에 싣는다. 개수로 자르면 한글 슬러그가
  // 퍼센트 인코딩된 cafe24 rewrite URL 에서 예산을 넘긴다.
  const short = ["a", "b", "c", "d"]
  assert.deepEqual(chunkByEncodedLength(short, 100), [short])

  const chunks = chunkByEncodedLength(short, 8) // 개당 비용 1+3=4 → 청크당 2개
  assert.deepEqual(chunks, [["a", "b"], ["c", "d"]])
  assert.deepEqual(chunks.flat(), short)
})

test("chunkByEncodedLength: 예산을 혼자 넘기는 값도 버리지 않는다", () => {
  // 한 개만으로 예산 초과라도 반드시 한 청크로 나가야 한다 — 조용히 누락되면
  // 그 상품은 생존 확인이 안 돼 sweep 대상이 된다.
  const huge = "가".repeat(500)
  const chunks = chunkByEncodedLength([huge, "b"], 10)
  assert.deepEqual(chunks, [[huge], ["b"]])
})

test("chunkRowsByJsonSize: 본문 크기 예산으로 자르고 순서를 보존한다", () => {
  // 실측 사고 2026-08-01: browns 는 크롤이 807초 동안 정상이었는데 후보 upsert 를
  // 통째로 보내다 nginx 413 을 맞아 **후보가 한 건도 적재되지 않았다**(0건).
  const rows = [{a: 1}, {a: 2}, {a: 3}, {a: 4}]
  assert.deepEqual(chunkRowsByJsonSize(rows, 10_000), [rows])

  // JSON.stringify({a:1}) = 7B, +1 구분자 = 8B → 예산 16 이면 청크당 2개.
  const chunks = chunkRowsByJsonSize(rows, 16)
  assert.deepEqual(chunks, [[{a: 1}, {a: 2}], [{a: 3}, {a: 4}]])
  assert.deepEqual(chunks.flat(), rows)
})

test("chunkRowsByJsonSize: 예산을 혼자 넘기는 행도 버리지 않는다", () => {
  // 조용히 누락시키는 것보다 413 이 나는 편이 낫다 — 행 크기는 raw_product 의
  // 이미지 배열 길이에 따라 수 배로 벌어진다.
  const huge = {a: "x".repeat(500)}
  const chunks = chunkRowsByJsonSize([huge, {a: "b"}], 50)
  assert.equal(chunks.length, 2)
  assert.deepEqual(chunks[0], [huge])
})

test("chunkRowsByJsonSize: 멀티바이트를 바이트 단위로 센다", () => {
  // 한글 상품명이 raw_product 에 그대로 실린다. 문자 수로 세면 예산을 3배 초과한다.
  const row = {name: "가".repeat(10)} // 10자 = UTF-8 30B
  assert.ok(JSON.stringify(row).length < Buffer.byteLength(JSON.stringify(row), "utf8"))
  assert.equal(chunkRowsByJsonSize([row, row], 45).length, 2)
})

test("chunkRowsByJsonSize: 빈 입력은 빈 배열", () => {
  assert.deepEqual(chunkRowsByJsonSize([]), [])
})

test("chunkByEncodedLength: 빈 입력은 빈 배열", () => {
  assert.deepEqual(chunkByEncodedLength([], 100), [])
})

test("brandFromNamePrefix: '[BRAND] 제품명' 프리픽스만 브랜드로 인정한다", () => {
  assert.equal(brandFromNamePrefix("[HORLISUN] BAKER COZY PANTS (DARK GREEN)"), "HORLISUN")
  assert.equal(brandFromNamePrefix("  [ROUGH SIDE] Surplus Shirt"), "ROUGH SIDE")
  // 프리픽스가 없으면 빈 문자열 — 상품명을 브랜드로 오인하지 않는다
  assert.equal(brandFromNamePrefix("BAKER COZY PANTS"), "")
  // 프리픽스가 문자열 중간에 있으면 무시
  assert.equal(brandFromNamePrefix("BAKER [SALE] PANTS"), "")
  // 닫는 괄호 없음 / 40자 초과는 브랜드로 보지 않는다
  assert.equal(brandFromNamePrefix("[BAKER COZY PANTS"), "")
  assert.equal(brandFromNamePrefix(`[${"A".repeat(41)}] X`), "")
})

test("havati 같은 편집샵은 상품명 프리픽스로 기존 브랜드에 매칭된다", () => {
  const havati: SiteConfig = {
    key: "havati",
    name: "하바티",
    type: "cafe24",
    baseUrl: "https://havatishop.com",
    multiBrand: true,
    brandFromNamePrefix: true,
  }
  const rows = buildRefreshCandidateInputs(
    [
      {productUrl: "https://havatishop.com/product/detail.html?product_no=1", brand: "HORLISUN", name: "[HORLISUN] A"},
      {productUrl: "https://havatishop.com/product/detail.html?product_no=2", brand: "", name: "[NOBRAND] B"},
    ],
    havati,
    [{id: 77, brand_name: "HORLISUN", brand_name_normalized: "horlisun"}],
  )
  assert.deepEqual(
    rows.map((row) => [row.detected_brand, row.status, row.matched_brand_node_id]),
    [
      ["HORLISUN", "discovered", 77],
      // 엔진이 브랜드를 못 뽑은 상품은 종전대로 파킹 — 자동 생성하지 않는다
      [null, "brand_unmatched", null],
    ],
  )
})
