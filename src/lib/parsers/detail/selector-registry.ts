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

import {OptionColorMode} from "../field-extractors/color"

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
  /** Option-list color filter mode (shared colorFromOptionList). */
  optionColorMode?: OptionColorMode
  /** BaseDetailParser color/code/material params (base family). */
  colorSelectors?: string[]
  codeSelectors?: string[]
  materialPatternSrc?: string
  materialKeywords?: string[]
}

const DOM_DEFAULT: WaitStrategy = {kind: "dom", timeout: 15000, pauseMs: 800}

// BaseDetailParser default selectors — shared by base fallback / blankroom
// / visualaid. preserve-findings 유형 1: blankroom & visualaid inherit the
// material-pollution path; the only per-site difference is description
// selectors, captured here as data (genuine 3→1 collapse).
const BASE_COLOR_SELECTORS = [
  'select[name*="option1"] option',
  'select[id*="option1"] option',
  ".opt_list li",
  ".product-option li",
]
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
    colorSelectors: BASE_COLOR_SELECTORS,
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
  // blankroom: option1 = SIZE (not color). Color is in .color-name span (JS-rendered).
  // dom-then-selector waits up to 5s for the span; .catch(null) lets it fall through
  // to cafe24-engine name-based extraction when the span is absent.
  blankroom: {
    ...baseEntry([".product-description"]),
    colorSelectors: [".color-name"],
    wait: {kind: "dom-then-selector", timeout: 15000, selector: ".color-name", selectorTimeout: 5000},
  },
  visualaid: baseEntry([".tab_wrap"]),

  // 2026-07-02 온보딩: ojos/goyowear 둘 다 option1 = SIZE (색상 셀렉트 없음).
  // 실제 색상은 상품명에 있음 (ojos: "Name / Color", goyowear: "Name (COLOR)").
  // colorSelectors: [] → BaseDetailParser가 null 반환 → cafe24-engine.ts의
  // extractColorFromText 상품명 기반 폴백으로 자연스럽게 넘어감.
  ojos: {...baseEntry(BASE_DESCRIPTION_SELECTORS), colorSelectors: []},
  goyowear: {...baseEntry(BASE_DESCRIPTION_SELECTORS), colorSelectors: []},

  // 2026-07-06 검증: taats도 동일 패턴. option1 select에 SIZE만 있고(S/M/L/XL)
  // 별도 색상 옵션/스와치가 없음 — 색상별로 아예 다른 상품 페이지("Name (Color)",
  // 예: "Washed Cotton Pajama Set (Dark Navy)")로 분리되어 있다. colorSelectors: []
  // 로 option1(사이즈) 오염을 막고 cafe24-engine.ts의 extractColorFromText
  // 상품명 폴백으로 넘긴다. .xans-product-detaildesign은 텍스트 설명이 아니라
  // "판매가\n129,000원"만 담고 있어(실제 설명은 이미지 배너) description은
  // 개선 대상에서 제외 — 우선순위 낮음.
  taats: {...baseEntry(BASE_DESCRIPTION_SELECTORS), colorSelectors: []},

  // ── per-site algorithms (verbatim, selectors externalized) ──
  "8division": {strategy: "8division", wait: DOM_DEFAULT},
  adekuver: {strategy: "adekuver", wait: DOM_DEFAULT},
  anotheroffice: {
    strategy: "anotheroffice",
    wait: DOM_DEFAULT,
    optionColorMode: "anotheroffice",
  },
  bastong: {
    strategy: "bastong",
    wait: DOM_DEFAULT,
    descriptionSelectors: ["#prdDetail"],
    optionColorMode: "bastong",
  },
  chanceclothing: {
    strategy: "chanceclothing",
    wait: DOM_DEFAULT,
    optionColorMode: "chanceclothing",
  },
  eastlogue: {strategy: "eastlogue", wait: DOM_DEFAULT},
  etcseoul: {strategy: "etcseoul", wait: DOM_DEFAULT},
  fr8ight: {strategy: "fr8ight", wait: DOM_DEFAULT},
  havati: {strategy: "havati", wait: DOM_DEFAULT, optionColorMode: "havati"},
  roughside: {strategy: "roughside", wait: DOM_DEFAULT},
  sculpstore: {
    strategy: "sculpstore",
    wait: DOM_DEFAULT,
    optionColorMode: "swallowlounge", // sculpstore uses the same filter as swallowlounge
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
    optionColorMode: "slowsteadyclub",
  },
  swallowlounge: {
    strategy: "swallowlounge",
    wait: DOM_DEFAULT,
    optionColorMode: "swallowlounge",
  },
  // @MX:NOTE: [AUTO] takeastreet runs the MODEL SIZE description cut on
  // rawDesc BEFORE the color/material line scan also uses rawDesc; the
  // 컬러/소재 lines are present but the early structure of rawDesc means
  // they are not matched → color/material stay null.
  // @MX:REASON: preserve-findings.md 유형 3 (takeastreet color/material 누락).
  takeastreet: {strategy: "takeastreet", wait: DOM_DEFAULT},
}
