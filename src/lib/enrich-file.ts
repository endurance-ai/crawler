/**
 * 크롤 산출 JSON 을 LLM 보강할 때 쓰는 순수 로직 + 파일 I/O.
 * CLI 는 src/enrich-products-file.ts (repair-product-color.ts / color-repair.ts 와 같은 분리).
 */

import * as fs from "node:fs"
import * as path from "node:path"

import type {Product} from "./types"

/** 보강 대상 한 건 — 원본 배열에서의 위치를 들고 다녀야 제자리에 되쓸 수 있다. */
export interface EnrichTarget {
  product: Product
  index: number
}

/**
 * 재개 지점 계산. llmEnrichedAt 이 찍힌 항목은 이미 보강된 것이므로 건너뛴다.
 * 수천 건짜리 보강이 중간에 죽어도 처음부터 다시 돌지 않게 하는 핵심 —
 * 실패한 항목에는 마커를 안 찍으므로 다음 런에서 자동으로 재시도된다.
 */
export function selectEnrichTargets(
  products: readonly Product[],
  options: {force?: boolean; limit?: number} = {},
): EnrichTarget[] {
  const pending: EnrichTarget[] = []
  products.forEach((product, index) => {
    if (options.force || !product.llmEnrichedAt) pending.push({product, index})
  })
  return options.limit && options.limit > 0 ? pending.slice(0, options.limit) : pending
}

/**
 * 재시도할 만한 오류인지 판정한다. 429/5xx/네트워크 흔들림은 일시적이므로
 * 지수 백오프로 다시 시도하고, 스키마 위반이나 동일 출처 가드 위반처럼 다시
 * 해도 같은 결과인 오류는 즉시 실패로 넘긴다 — 만 건짜리 배치에서 후자를
 * 재시도하면 시간만 3배로 쓴다.
 */
export function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/host differs from source config/i.test(message)) return false
  return /\b(429|500|502|503|504)\b|rate.?limit|overloaded|ECONNRESET|ETIMEDOUT|timeout/i.test(message)
}

/** 지수 백오프 대기(ms). 상한 30초. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt)
}

export function readProductsFile(file: string): Product[] {
  const absolute = path.resolve(file)
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf-8")) as unknown
  if (!Array.isArray(parsed)) throw new Error(`최상위가 배열이 아님: ${absolute}`)
  return parsed as Product[]
}

/**
 * 같은 디렉터리에 임시 파일을 쓰고 rename 한다. 체크포인트 저장 도중 프로세스가
 * 죽어도 반쯤 쓰인 JSON 이 남지 않는다 — 그렇게 되면 재개 마커가 통째로 날아가고
 * 이미 돈 수천 건을 다시 돌아야 한다.
 */
export function writeProductsFile(file: string, products: readonly Product[]): void {
  const absolute = path.resolve(file)
  const tmp = `${absolute}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(products, null, 2), "utf-8")
  fs.renameSync(tmp, absolute)
}
