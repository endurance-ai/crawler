import assert from "node:assert/strict"
import test from "node:test"

import {
  buildPlatformRepairPlan,
  buildRefreshCandidateInputs,
  buildRefreshWorklist,
  candidateIdentity,
  matchExistingBrand,
  uniqueRefreshConfigs,
  type BrandLookupRow,
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
