/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 (REQ-CRAWLER-003) — declarative selector
 * registry for the 18 Cafe24-family detail sites.
 *
 * This registry replaces the 18 copy-paste detail parser MODULES with one
 * registry-driven parser (registry-detail-parser.ts) + shared field
 * extractors (../field-extractors/). Each entry holds the per-site
 * selector sets, page-load wait strategy, and any quirk flags needed to
 * reproduce the CURRENT behavior byte-identically.
 *
 * [HARD] This is a behavior-PRESERVING extraction. The 18 golden masters
 * (tests/fixtures/detail/<site>.golden.json) — INCLUDING the documented
 * bugs in preserve-findings.md — must be reproduced byte-identically.
 * Quirk flags below encode each documented bug as an explicit, named
 * registry mechanism rather than abandoning the collapse.
 *
 * The original 18 *-parser.ts modules are intentionally kept on disk for
 * rollback safety (SPEC Acceptance "롤백 전략"); they become unreferenced
 * by index.ts but are NOT deleted in this phase.
 */


/** Page-load wait recipe (the only three variants the 18 sites use). */
export type WaitStrategy =
  | {kind: "dom"; timeout: number; pauseMs: number} // domcontentloaded + waitForTimeout
  | {
      kind: "dom-then-selector"
      timeout: number
      selector: string
      selectorTimeout: number
    } // sienneboutique
  | {
      kind: "commit-then-selector"
      timeout: number
      selector: string
      selectorTimeout: number
      pauseMs: number
    } // shopamomento

/**
 * Strategy id — selects which extraction algorithm the shared engine runs
 * for this site. `base` is the genuinely-shared BaseDetailParser family
 * (base fallback + blankroom + visualaid collapse to params only). The
 * remaining ids are per-site algorithms transcribed verbatim from the
 * original modules, externalizing only selectors/markers into this entry.
 */
export type StrategyId =
  | "base"
  | "8division"
  | "adekuver"
  | "anotheroffice"
  | "bastong"
  | "chanceclothing"
  | "eastlogue"
  | "etcseoul"
  | "fr8ight"
  | "havati"
  | "roughside"
  | "sculpstore"
  | "shopamomento"
  | "sienneboutique"
  | "slowsteadyclub"
  | "swallowlounge"
  | "takeastreet"

export interface RegistryEntry {
  strategy: StrategyId
  wait: WaitStrategy
  /** Description container selectors (base family + bastong/sienneboutique). */
  descriptionSelectors?: string[]
  /** BaseDetailParser code/material params (base family). */
  codeSelectors?: string[]
  materialPatternSrc?: string
  materialKeywords?: string[]
}

const DOM_DEFAULT: WaitStrategy = {kind: "dom", timeout: 15000, pauseMs: 800}

// BaseDetailParser default selectors — shared by base fallback / blankroom
// / visualaid. preserve-findings 유형 1: blankroom & visualaid inherit the
// material-pollution path; the only per-site difference is description
// selectors, captured here as data (genuine 3→1 collapse).
const BASE_CODE_SELECTORS = [".product_code", ".prd_code"]
const BASE_MATERIAL_PATTERN = String.raw`(?:소재|원단|Material|Fabric|Composition)\s*[:：]?\s*([^\n<]{3,80})`
const BASE_MATERIAL_KEYWORDS = [
  "소재",
  "원단",
  "Material",
  "Fabric",
  "Composition",
  "cotton",
  "polyester",
  "wool",
  "nylon",
  "linen",
  "면",
  "폴리에스터",
  "울",
  "나일론",
  "린넨",
  "실크",
  "캐시미어",
  "레이온",
  "비스코스",
]

function baseEntry(descriptionSelectors: string[]): RegistryEntry {
  return {
    strategy: "base",
    wait: DOM_DEFAULT,
    descriptionSelectors,
    codeSelectors: BASE_CODE_SELECTORS,
    materialPatternSrc: BASE_MATERIAL_PATTERN,
    materialKeywords: BASE_MATERIAL_KEYWORDS,
  }
}

/** BaseDetailParser default description selector list (fallback). */
export const BASE_DESCRIPTION_SELECTORS = [
  ".cont_detail",
  "#prdDetail",
  ".product-detail",
  ".xans-product-detaildesign",
  ".detail_cont",
  "#productDetail",
  ".item.open .content",
  ".prd_detail_box",
]

/**
 * Site key (matches SPEC REQ-CRAWLER-003) → declarative registry entry.
 * 18 entries replace 18 modules; one shared engine consumes them.
 */
export const DETAIL_REGISTRY: Record<string, RegistryEntry> = {
  // ── base family: genuine 3→1 collapse (params only) ──
  // blankroom/visualaid keep the BaseDetailParser material-pollution path.
  // blankroom 은 .color-name span(JS 렌더)을 기다리던 dom-then-selector 였다.
  // 색상 추출이 VLM 으로 이관되면서(2026-07-29) 그 대기 이유가 사라져 기본
  // DOM 대기로 되돌린다.
  blankroom: baseEntry([".product-description"]),
  visualaid: baseEntry([".tab_wrap"]),

  ojos: baseEntry(BASE_DESCRIPTION_SELECTORS),
  goyowear: baseEntry(BASE_DESCRIPTION_SELECTORS),

  // taats: .xans-product-detaildesign은 텍스트 설명이 아니라
  // "판매가\n129,000원"만 담고 있어(실제 설명은 이미지 배너) description은
  // 개선 대상에서 제외 — 우선순위 낮음.
  taats: baseEntry(BASE_DESCRIPTION_SELECTORS),

  // ── per-site algorithms (verbatim, selectors externalized) ──
  "8division": {strategy: "8division", wait: DOM_DEFAULT},
  adekuver: {strategy: "adekuver", wait: DOM_DEFAULT},
  anotheroffice: {
    strategy: "anotheroffice",
    wait: DOM_DEFAULT,
  },
  bastong: {
    strategy: "bastong",
    wait: DOM_DEFAULT,
    descriptionSelectors: ["#prdDetail"],
  },
  chanceclothing: {
    strategy: "chanceclothing",
    wait: DOM_DEFAULT,
  },
  eastlogue: {strategy: "eastlogue", wait: DOM_DEFAULT},
  etcseoul: {strategy: "etcseoul", wait: DOM_DEFAULT},
  fr8ight: {strategy: "fr8ight", wait: DOM_DEFAULT},
  havati: {strategy: "havati", wait: DOM_DEFAULT},
  roughside: {strategy: "roughside", wait: DOM_DEFAULT},
  sculpstore: {
    strategy: "sculpstore",
    wait: DOM_DEFAULT,
  },
  // @MX:NOTE: [AUTO] shopamomento uses commit-then-selector wait and
  // regexes that miss this site's structure → all 4 fields stay null.
  // @MX:REASON: preserve-findings.md 유형 2 (shopamomento detail 파싱 0).
  shopamomento: {
    strategy: "shopamomento",
    wait: {
      kind: "commit-then-selector",
      timeout: 15000,
      selector: ".xans-product-additional",
      selectorTimeout: 10000,
      pauseMs: 500,
    },
  },
  sienneboutique: {
    strategy: "sienneboutique",
    wait: {
      kind: "dom-then-selector",
      timeout: 30000,
      selector: ".product-tabs-detail",
      selectorTimeout: 8000,
    },
    descriptionSelectors: [".product-tabs-detail"],
  },
  slowsteadyclub: {
    strategy: "slowsteadyclub",
    wait: DOM_DEFAULT,
  },
  swallowlounge: {
    strategy: "swallowlounge",
    wait: DOM_DEFAULT,
  },
  // @MX:NOTE: [AUTO] takeastreet runs the MODEL SIZE description cut on
  // rawDesc BEFORE the color/material line scan also uses rawDesc; the
  // 컬러/소재 lines are present but the early structure of rawDesc means
  // they are not matched → color/material stay null.
  // @MX:REASON: preserve-findings.md 유형 3 (takeastreet color/material 누락).
  takeastreet: {strategy: "takeastreet", wait: DOM_DEFAULT},
}
