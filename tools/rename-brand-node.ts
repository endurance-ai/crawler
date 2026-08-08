#!/usr/bin/env npx tsx
/**
 * brand_nodes 의 브랜드명을 바꾸고 같은 이름을 쓰는 products.brand 를 함께 갱신한다.
 *
 * 기본은 dry-run 이다. `--apply` 일 때만 DB 를 수정한다.
 * `brand_name_normalized`(유니크 키)는 `brand_name.toLowerCase().trim()` 규칙으로
 * 다시 계산하며, 다른 노드와 충돌하면 실행을 중단한다.
 * `wiki->>brand_name` 은 같은 이름의 사본이므로 값이 있으면 함께 갱신한다.
 *
 *   npx dotenv -e .env.local -- npx tsx tools/rename-brand-node.ts --rename="그레일즈=GRAILZ"
 *   npx dotenv -e .env.local -- npx tsx tools/rename-brand-node.ts --rename="그레일즈=GRAILZ" --apply
 *
 * `--rename` 은 여러 번 줄 수 있다. `platforms.ts` / `platforms.generated.ts` 의
 * `name`/`brand` 도 함께 고쳐야 다음 크롤에서 옛 이름이 되돌아오지 않는다.
 */

import {createProductCollectionClient, type ProductCollectionClient} from "../src/lib/product-collection"

const APPLY = process.argv.includes("--apply")

interface Rename {
  from: string
  to: string
}

interface BrandNodeRow {
  id: number
  brand_name: string
  brand_name_normalized: string | null
  wiki: Record<string, unknown> | null
}

function parseRenames(): Rename[] {
  const renames = process.argv
    .filter((arg) => arg.startsWith("--rename="))
    .map((arg) => arg.slice("--rename=".length))
    .map((pair) => {
      const index = pair.indexOf("=")
      if (index <= 0 || index === pair.length - 1) {
        throw new Error(`--rename 형식은 "옛이름=새이름" 이어야 한다: ${pair}`)
      }
      return {from: pair.slice(0, index).trim(), to: pair.slice(index + 1).trim()}
    })
  if (renames.length === 0) throw new Error('--rename="옛이름=새이름" 을 최소 하나 지정하세요.')
  return renames
}

function normalizeBrand(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ")
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function loadNode(db: ProductCollectionClient, brandName: string): Promise<BrandNodeRow> {
  const {data, error} = await db
    .from("brand_nodes")
    .select("id,brand_name,brand_name_normalized,wiki")
    .eq("brand_name", brandName)
  if (error) throw new Error(`brand_nodes 조회 실패 (${brandName}): ${error.message}`)
  const rows = (data ?? []) as BrandNodeRow[]
  if (rows.length === 0) throw new Error(`brand_nodes 에 없음: ${brandName}`)
  if (rows.length > 1) {
    throw new Error(`brand_nodes 중복 (${brandName}): id=${rows.map((row) => row.id).join(",")}`)
  }
  return rows[0]
}

async function assertNoCollision(
  db: ProductCollectionClient,
  rename: Rename,
  nodeId: number,
): Promise<void> {
  const normalized = normalizeBrand(rename.to)
  const {data, error} = await db
    .from("brand_nodes")
    .select("id,brand_name,brand_name_normalized")
    .or(`brand_name.eq.${rename.to},brand_name_normalized.eq.${normalized}`)
  if (error) throw new Error(`중복 확인 실패 (${rename.to}): ${error.message}`)
  const others = ((data ?? []) as BrandNodeRow[]).filter((row) => row.id !== nodeId)
  if (others.length > 0) {
    throw new Error(
      `이미 같은 이름의 brand_node 가 있음 (${rename.to}): ` +
      others.map((row) => `id=${row.id} ${row.brand_name}`).join(", "),
    )
  }
}

async function loadProductIds(
  db: ProductCollectionClient,
  brandName: string,
): Promise<Array<{id: string | number; brand_node_id: number | null; platform: string | null}>> {
  const pageSize = 1000
  const rows: Array<{id: string | number; brand_node_id: number | null; platform: string | null}> = []
  for (let offset = 0; ; offset += pageSize) {
    const {data, error} = await db
      .from("products")
      .select("id,brand_node_id,platform")
      .eq("brand", brandName)
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`products 조회 실패 (${brandName}): ${error.message}`)
    const page = (data ?? []) as typeof rows
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

async function main(): Promise<void> {
  const db = createProductCollectionClient()
  const renames = parseRenames()

  console.log(`\n=== brand_node 이름 변경 — ${APPLY ? "APPLY" : "DRY-RUN"} ===`)

  for (const rename of renames) {
    const node = await loadNode(db, rename.from)
    await assertNoCollision(db, rename, node.id)
    const products = await loadProductIds(db, rename.from)

    const byPlatform = new Map<string, number>()
    for (const row of products) {
      const key = `${row.platform ?? "(null)"}|node=${row.brand_node_id ?? "null"}`
      byPlatform.set(key, (byPlatform.get(key) ?? 0) + 1)
    }

    console.log(
      `\n${rename.from} → ${rename.to}` +
      `\n  brand_node_id=${node.id}` +
      ` / normalized ${JSON.stringify(node.brand_name_normalized)} → ${JSON.stringify(normalizeBrand(rename.to))}` +
      `\n  products: ${products.length}건 (${[...byPlatform].map(([k, v]) => `${k} ${v}건`).join(", ") || "없음"})`,
    )
    const wikiName = (node.wiki ?? {})["brand_name"]
    if (typeof wikiName === "string") {
      console.log(`  wiki.brand_name: ${JSON.stringify(wikiName)} → ${JSON.stringify(rename.to)}`)
    }

    if (!APPLY) continue

    const wiki = node.wiki && typeof wikiName === "string"
      ? {...node.wiki, brand_name: rename.to}
      : node.wiki
    const {error: nodeError} = await db
      .from("brand_nodes")
      .update({
        brand_name: rename.to,
        brand_name_normalized: normalizeBrand(rename.to),
        ...(wiki === node.wiki ? {} : {wiki}),
      })
      .eq("id", node.id)
    if (nodeError) throw new Error(`brand_nodes 갱신 실패 (${rename.from}): ${nodeError.message}`)

    let updated = 0
    for (const idChunk of chunks(products.map((row) => row.id), 250)) {
      const {data, error} = await db
        .from("products")
        .update({brand: rename.to})
        .in("id", idChunk)
        .select("id")
      if (error) throw new Error(`products 갱신 실패 (${rename.from}): ${error.message}`)
      updated += data?.length ?? 0
    }
    if (updated !== products.length) {
      throw new Error(`갱신 수 불일치 (${rename.from}): expected=${products.length}, updated=${updated}`)
    }
    console.log(`  ✅ brand_node 1건 + products ${updated}건 반영 완료`)
  }

  if (!APPLY) console.log("\n실제 반영하려면 --apply 를 붙여 재실행하세요.")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
