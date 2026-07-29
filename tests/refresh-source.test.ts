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

test("brand_name_normalized 가 공백·구두점 제거형이어도 매칭된다 (2026-07-29 회귀)", () => {
  // 실물 brand_nodes 는 normalized 를 공백·구두점을 **제거한** 형태로 저장한다.
  // 위 테스트의 "maison margiela"(공백 유지)는 실제 저장 형태가 아니라서 이
  // 버그를 잡지 못했다 — 실측상 6,668건이 이 사유로 brand_unmatched 파킹됐다.
  const brands: BrandLookupRow[] = [
    {id: 735, brand_name: "032c READYTOWEAR", brand_name_normalized: "032creadytowear"},
    {id: 1743, brand_name: "Drakes - UK/ROW", brand_name_normalized: "drakesukrow"},
    {id: 5614, brand_name: "The Epel", brand_name_normalized: "theepel"},
  ]
  assert.equal(matchExistingBrand("032c READYTOWEAR", brands)?.id, 735)
  assert.equal(matchExistingBrand("Drakes - UK/ROW", brands)?.id, 1743)
  assert.equal(matchExistingBrand("the epel", brands)?.id, 5614)
  assert.equal(matchExistingBrand("전혀 다른 브랜드", brands), null)
})

test("구두점 제거로 두 브랜드가 같은 키로 접히면 모호 처리해 파킹한다", () => {
  const brands: BrandLookupRow[] = [
    {id: 1, brand_name: "A.P.C.", brand_name_normalized: "apc"},
    {id: 2, brand_name: "APC", brand_name_normalized: "apc"},
  ]
  assert.equal(matchExistingBrand("A.P.C.", brands), null)
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
      // 2026-07-29: 이 플래그가 vendor 우선의 조건이다. 예전엔 상품 brand 가
      // 무조건 먼저라 플래그 없이도 통과했는데, 그 동작이 자사몰에서
      // DOM 오인식(상품명·공백문자)을 브랜드로 승격시키는 원인이었다.
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

test("자사몰(multiBrand 아님)은 config.brand 가 상품 brand 오인식을 이긴다", () => {
  // 실측 회귀: brand-4cb9 는 상품 1,866건이 서로 다른 "브랜드"(실제로는 상품명)를
  // 들고 왔고, glowny 는 1,345건이 brand="ㅤ"(U+3164) 였다. 둘 다 config.brand 가
  // 설정된 단일브랜드 자사몰이라 하우스 브랜드가 이겨야 한다
  // (CLAUDE.md "Brand Name Fixing").
  const rows = buildRefreshCandidateInputs(
    [
      {productUrl: "https://own.test/products/a", brand: "카듄 뒷밴딩 포켓 미니 스커트 (4color)"},
      {productUrl: "https://own.test/products/b", brand: "ㅤ"},
      {productUrl: "https://own.test/products/c"},
    ],
    {
      key: "own",
      name: "Own Store",
      type: "cafe24",
      baseUrl: "https://own.test",
      brand: "the pink",
    },
    [{id: 30, brand_name: "the pink", brand_name_normalized: "thepink"}],
  )

  for (const row of rows) {
    assert.equal(row.detected_brand, "the pink")
    assert.equal(row.matched_brand_node_id, 30)
    assert.equal(row.status, "discovered")
  }
})
