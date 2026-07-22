#!/usr/bin/env npx tsx
/**
 * 오늘(2026-07-22) 세션의 daily-onboard 스킬용 선정 스크립트.
 *
 * product_crawl_brands 에서 status='tech_detected'(homepage_url 있음, 아직 크롤/적재 전)
 * 또는 status='qc_failed'(전에 시도했으나 QC 통과율이 낮아 재시도가 필요한 브랜드,
 * import-products.ts의 MIN_QC_PASS_RATE 다운그레이드 참조)인 브랜드를 status_updated_at
 * 최신순으로 limit개 뽑아 onboard-batch.sh --configs 에 넣을 SiteConfig[] JSON을 만든다.
 *
 * qc_failed 재시도는 product_crawl_runs(stage='import')에서 이미 몇 번 시도했는지 세어
 * MAX_IMPORT_RETRIES 이상이면 건너뛴다 — 영구히 깨진 사이트(셀렉터가 안 맞는 등)에
 * LLM 비용/시간을 무한정 태우지 않기 위함.
 *
 * 각 후보는 반드시 platforms.ts/platforms.generated.ts 에 이미 등록돼 있어야 한다
 * (tools/generate-platform-configs.ts 를 먼저 돌려서 최신 상태로 만들어둘 것) —
 * getSiteConfig()로 완전한 config를 그대로 가져온다. 부분(key만 있는) config를
 * onboard-batch.sh 의 POC_EXTRA_BRANDS 로 넘기면 getSiteConfig()보다 우선 적용되어
 * type/baseUrl 등이 비어버리는 사고가 난다(2026-07-21 실측) — 그래서 절대 stub을
 * 만들지 않고 항상 getSiteConfig() 결과를 그대로 복사한다.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx tools/select-onboard-batch.ts --limit=5 --out=path.json
 */
import * as fs from "fs"
import {createProductCollectionClient} from "../src/lib/product-collection"
import {getSiteConfig} from "../src/configs/platforms"

const MAX_IMPORT_RETRIES = 3

function flag(name: string, fallback?: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.slice(name.length + 3) : fallback
}

async function main() {
  const limit = Number(flag("limit", "5"))
  const outPath = flag("out")
  if (!outPath) throw new Error("--out=<path.json> is required")

  // disabled/config-누락/재시도-소진 후보를 걸러내고도 limit개를 채울 수 있도록 넉넉히
  // 뽑는다 (10배, 최소 50) — 이 뷰는 소량이라 과다조회 비용이 무시할 만한 수준이다.
  const fetchSize = Math.max(limit * 10, 50)
  const db = createProductCollectionClient()
  const {data, error} = await db
    .from("product_crawl_brands")
    .select("brand_node_id,brand_name,platform_key,platform_type,homepage_url,status,status_updated_at")
    .in("status", ["tech_detected", "qc_failed"])
    .in("platform_type", ["cafe24", "shopify"])
    .not("homepage_url", "is", null)
    .order("status_updated_at", {ascending: false, nullsFirst: false})
    .limit(fetchSize)
  if (error) throw new Error(`select failed: ${error.message}`)

  const rows = data ?? []
  const configs: unknown[] = []
  const missing: string[] = []
  const disabled: string[] = []
  const retriesExhausted: string[] = []
  for (const row of rows) {
    if (configs.length >= limit) break
    const key = (row as {platform_key: string | null}).platform_key
    const status = (row as {status: string}).status
    const brandNodeId = (row as {brand_node_id: number}).brand_node_id
    if (!key) continue

    if (status === "qc_failed") {
      const {count, error: runsError} = await db
        .from("product_crawl_runs")
        .select("id", {count: "exact", head: true})
        .eq("brand_node_id", brandNodeId)
        .eq("stage", "import")
      if (runsError) throw new Error(`retry count check failed for ${key}: ${runsError.message}`)
      if ((count ?? 0) >= MAX_IMPORT_RETRIES) {
        retriesExhausted.push(key)
        continue
      }
    }

    const cfg = getSiteConfig(key)
    if (!cfg) {
      missing.push(key)
      continue
    }
    // product-extraction-poc.ts는 config.disabled를 전혀 확인하지 않는다 — disabled
    // config(감지 실패/통화 미확인 등으로 이미 비활성화된 사이트)를 그대로 넘기면
    // 오늘 하루 종일 고친 것과 같은 통화 오탐/0건 크롤 사고가 신규 브랜드에서
    // 재현된다 (2026-07-22 실측). 여기서 걸러낸다.
    if (cfg.disabled) {
      disabled.push(key)
      continue
    }
    configs.push(cfg)
  }

  fs.writeFileSync(outPath, JSON.stringify(configs, null, 2))
  console.log(`selected ${configs.length}/${limit} (검토 ${rows.length}건 중) -> ${outPath}`)
  if (missing.length > 0) {
    console.warn(
      `⚠️  ${missing.length}개는 platforms.ts에 config가 없어 건너뜀 (먼저 generate-platform-configs.ts 실행 필요): ${missing.join(", ")}`,
    )
  }
  if (disabled.length > 0) {
    console.warn(`⚠️  ${disabled.length}개는 disabled config라 건너뜀: ${disabled.join(", ")}`)
  }
  if (retriesExhausted.length > 0) {
    console.warn(
      `⚠️  ${retriesExhausted.length}개는 import 재시도 ${MAX_IMPORT_RETRIES}회를 소진해 건너뜀 (수동 확인 필요): ${retriesExhausted.join(", ")}`,
    )
  }
  if (configs.length === 0) {
    console.warn("⚠️  선정된 브랜드 없음 — tech_detected/qc_failed 후보가 소진됐거나 전부 config 누락/disabled/재시도 소진")
  } else if (configs.length < limit) {
    console.warn(`⚠️  목표 ${limit}개 중 ${configs.length}개만 확보 (검토 범위를 늘리려면 fetchSize 로직 참고)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
