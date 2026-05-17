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

import type {Page} from "playwright"
import type {DetailData, IDetailParser} from "./types"
import {DETAIL_REGISTRY, type RegistryEntry} from "./selector-registry"
import {STRATEGIES} from "../field-extractors/strategies"

export class RegistryDetailParser implements IDetailParser {
  private readonly entry: RegistryEntry

  constructor(private readonly site: string) {
    const entry = DETAIL_REGISTRY[site]
    if (!entry) {
      throw new Error(`RegistryDetailParser: no registry entry for site "${site}"`)
    }
    this.entry = entry
  }

  async parse(page: Page, productUrl: string): Promise<DetailData> {
    const result: DetailData = {
      description: null,
      color: null,
      material: null,
      productCode: null,
    }

    try {
      const w = this.entry.wait
      if (w.kind === "dom") {
        await page.goto(productUrl, {waitUntil: "domcontentloaded", timeout: w.timeout})
        await page.waitForTimeout(w.pauseMs)
      } else if (w.kind === "dom-then-selector") {
        await page.goto(productUrl, {waitUntil: "domcontentloaded", timeout: w.timeout})
        await page
          .waitForSelector(w.selector, {timeout: w.selectorTimeout})
          .catch(() => null)
      } else {
        // commit-then-selector (shopamomento)
        await page.goto(productUrl, {waitUntil: "commit", timeout: w.timeout})
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
