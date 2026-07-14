/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 (REQ-CRAWLER-003) — single registry-driven
 * detail parser.
 *
 * @MX:ANCHOR: [AUTO] Sole IDetailParser implementation for all 18
 * Cafe24-family SPEC sites. getDetailParser() returns site-keyed
 * subclasses of this class; the 18 original *-parser.ts modules are
 * retained on disk (rollback safety) but no longer wired into routing.
 * @MX:REASON: fan_in — every one of the 18 SPEC site keys plus the
 * named-class shims in index.ts route through parse(); a behavior change
 * here changes all 18 sites' collected product data simultaneously.
 * @MX:SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-003
 *
 * [HARD] Behavior-preserving: output MUST match the golden masters
 * byte-identically, including the documented bugs (preserve-findings.md).
 * This class only orchestrates page-load wait + strategy dispatch; the
 * extraction bodies live verbatim in ../field-extractors/strategies.ts.
 */

import type {Cafe24Page} from "../../cafe24-page"
import type {DetailData, IDetailParser} from "./types"
import {DETAIL_REGISTRY, type RegistryEntry} from "./selector-registry"
import {STRATEGIES} from "../field-extractors/strategies"

// 일시적 지연과 진짜 다운을 구분하기 위해 최초 goto 타임아웃 실패 시 1회만 더 긴
// 타임아웃(+15초)으로 재시도한다 (2026-07-06: hippiedippy/lossyrow 처럼 응답이
// 느린 사이트에서 기본 타임아웃 컷으로 색상/설명 데이터가 불필요하게 누락되던 문제).
// golden 픽스처는 page.route로 즉시 응답하는 정적 HTML이라 재시도 경로 자체가
// 트리거되지 않음 — 18-site 골든 마스터 byte-identical 보장에 영향 없음.
async function gotoWithRetry(
  page: Cafe24Page,
  url: string,
  waitUntil: "domcontentloaded" | "commit",
  timeout: number,
): Promise<void> {
  try {
    await page.goto(url, {waitUntil, timeout})
  } catch {
    await page.goto(url, {waitUntil, timeout: timeout + 15_000})
  }
}

export class RegistryDetailParser implements IDetailParser {
  private readonly entry: RegistryEntry

  constructor(private readonly site: string) {
    const entry = DETAIL_REGISTRY[site]
    if (!entry) {
      throw new Error(`RegistryDetailParser: no registry entry for site "${site}"`)
    }
    this.entry = entry
  }

  async parse(page: Cafe24Page, productUrl: string): Promise<DetailData> {
    const result: DetailData = {
      description: null,
      color: null,
      material: null,
      productCode: null,
    }

    try {
      const w = this.entry.wait
      if (w.kind === "dom") {
        await gotoWithRetry(page, productUrl, "domcontentloaded", w.timeout)
        await page.waitForTimeout(w.pauseMs)
      } else if (w.kind === "dom-then-selector") {
        await gotoWithRetry(page, productUrl, "domcontentloaded", w.timeout)
        await page
          .waitForSelector(w.selector, {timeout: w.selectorTimeout})
          .catch(() => null)
      } else {
        // commit-then-selector (shopamomento)
        await gotoWithRetry(page, productUrl, "commit", w.timeout)
        await page
          .waitForSelector(w.selector, {timeout: w.selectorTimeout})
          .catch(() => null)
        await page.waitForTimeout(w.pauseMs)
      }

      const strategy = STRATEGIES[this.entry.strategy]
      const extracted = await strategy(page, this.entry)
      result.description = extracted.description
      result.color = extracted.color
      result.material = extracted.material
      result.productCode = extracted.productCode
    } catch (err) {
      console.warn(`   ⚠️ 상세 파싱 실패: ${productUrl} — ${(err as Error).message}`)
    }

    return result
  }
}
