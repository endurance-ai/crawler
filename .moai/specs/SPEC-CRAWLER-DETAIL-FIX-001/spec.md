---
id: SPEC-CRAWLER-DETAIL-FIX-001
version: 0.1.0
status: draft
created: 2026-05-18
updated: 2026-05-18
author: MoAI orchestrator (manager-spec)
priority: high
issue_number: 0
---

# SPEC-CRAWLER-DETAIL-FIX-001 — Cafe24 Detail-Parser Bug Fix (8 sites, golden correction)

> **Repo boundary**: tracked in `endurance-ai/crawler` (local
> `/Users/hansangho/Desktop/kikoai/crawler`), separate from kiko.ai-app. All
> paths are crawler-repo-root-relative. Branch: `fix/spec-crawler-detail-fix-001`
> off `dev`.

## HISTORY

- 2026-05-18 v0.1.0: Initial draft. The deferred follow-up that
  SPEC-ARCH-CRAWLER-001 explicitly carved out (preserve-findings.md "별도 후속
  SPEC", and that SPEC's spec.md line 9 deferral). Reverses policy A's
  intentional byte-identical bug-preservation for 8 Cafe24 detail sites:
  CORRECTS behaviour and transitions their goldens from "bug-preserved" to
  "corrected expected values". Architecture grounded in post-Phase-2/3 real
  files (registry path; 18 `*-parser.ts` deleted in PR #12).

## Overview

SPEC-ARCH-CRAWLER-001 (Phases 1-3, merged to `dev`) restructured the crawler's
detail layer behaviour-preservingly. Its PRESERVE phase (policy A, 2026-05-17)
**intentionally** froze 8 known Cafe24 detail-parser bugs byte-identically into
the golden master so the registry collapse could be proven a pure refactor. The
parent SPEC explicitly deferred fixing those bugs to this SPEC and named
`.moai/specs/SPEC-ARCH-CRAWLER-001/preserve-findings.md` as the authoritative
inventory.

This SPEC is an **intentional behaviour CHANGE** (not preservation). For exactly
the 8 sites in preserve-findings.md it CORRECTS the detail extraction and
transitions each affected golden from the bug-preserved value to a corrected
expected value, derived semantically and deterministically from that site's
EXISTING hand-crafted PRESERVE fixture HTML (no live re-capture). The control
parser `eastlogue` (which already extracts correctly, byte-identical golden) is
the reference model for what "correct" extraction looks like.

The 8 bugs share one physical root cause: Playwright `innerText` collapses the
fixtures' source newlines into spaces, and every buggy extractor assumes the
newlines survived (`split("\n")`, exact line-equality, or `\n`/`^`-anchored
regexes), causing either material pollution (Type 1) or null extraction (Types
2-3). See `research.md` for the full per-site trace, fixture evidence, and the
shared-root-cause finding.

Out of the 8, `slowsteadyclub` and `takeastreet` are currently
`disabled: true` in `src/configs/platforms.ts` (set by a concurrent session).
The parser fix is still valuable and lands ahead of any re-enable decision;
re-enabling is explicitly out of scope (see Exclusions).

## Goals (EARS-format requirements)

### REQ-DFIX-001 (Event-driven) — Type 1: material is composition-only

**When** the detail page of `8division`, `blankroom`, or `visualaid` is parsed,
the crawler **shall** extract `material` containing only the fabric composition
string (the run of `<percentage>% <fiber>` segments), excluding description
prose and trailing marketing text.

Corrected targets (derived from each site's fixture HTML): `8division` →
`70% Acrylic, 30% Wool`; `blankroom` → `Wool 80%, Nylon 20%`; `visualaid` →
`Cotton 100%`. `description`, `color`, `productCode` for these three sites
**shall** remain byte-identical to their current goldens.

### REQ-DFIX-002 (Ubiquitous) — Type 1: shared-root-cause base fix

The crawler **shall** correct the shared base-family material extractor
(`src/lib/parsers/field-extractors/material.ts` `baseMaterialFromDescription`,
used by `baseStrategy` for the `blankroom`/`visualaid` registry entries) so the
composition is captured by anchoring on a material label
(`소재`/`원단`/`Material`/`Fabric`/`Composition`) **or** a `<pct>% <fiber>`
token and terminating at the first non-composition token (Korean particle,
sentence boundary, non-fiber word), rather than the current
`([^\n<]{3,80})` over-capture. Where `blankroom` and `visualaid` can be
satisfied by this single shared primitive, they **shall** converge on it;
`8division` (site-local `eightDivisionStrategy`) **shall** apply the same
extraction rule.

### REQ-DFIX-003 (Event-driven) — Type 2: recover present-but-null fields

**When** the detail page of `chanceclothing`, `slowsteadyclub`, or
`shopamomento` is parsed, the crawler **shall** extract the `description` and
`material` values that are demonstrably present in the fixture HTML, using
whitespace-tolerant section segmentation (treat space OR newline as the
label/value separator and bound each value at the next known section label)
instead of `\n`-anchored regexes or `split("\n")` exact line-equality.

Corrected targets: `chanceclothing` → description `챈스클로딩 데님 자켓입니다.
빈티지한 워싱이 적용되어 있습니다.`, material `Cotton 100%`; `slowsteadyclub`
→ description `슬로우스테디클럽 셋업 자켓입니다. 클래식한 테일러링이
적용되었습니다.`, material `겉감 - 면 100% 안감 - 폴리에스터 100%`;
`shopamomento` → description `샵어모멘토 린넨 셔츠입니다. 자연스러운 구김이
매력적인 제품입니다.`, material `Linen 100%`. `color`/`productCode` that are
already correct **shall** remain byte-identical.

### REQ-DFIX-004 (Unwanted) — do not invent absent values

**If** a field has no source data in the site's fixture HTML (e.g.
`shopamomento` `color`/`productCode` — no `<select>` and no product-code
element; `takeastreet` `productCode`), **then** the crawler **shall not**
synthesise a value, and that field **shall** remain `null` in the corrected
golden. Correction recovers only fields the fixture demonstrably contains.

### REQ-DFIX-005 (Event-driven) — Type 3: line-isolation fix

**When** the detail page of `takeastreet` or `adekuver` is parsed, the crawler
**shall** extract the `color`/`material`/`productCode` values that are present
in the description text by segmenting on the delimiter actually present after
innerText collapse (bullet `-\s` and/or whitespace-tolerant label anchors, the
same principle `eastlogueStrategy` already uses via `split(/[-\n]/)`), rather
than `split("\n")` + `^`-line-anchored regexes.

Corrected targets: `takeastreet` → color `블랙`, material
`겉감 - 나일론 100% / 안감 - 폴리 100%`; `adekuver` → color `핑크`, material
`100% CO`, productCode `ADK2024SH001, ADK2024SH002`. `description` for both
**shall** remain byte-identical.

### REQ-DFIX-006 (Ubiquitous) — non-perturbation of correct sites

The crawler **shall** leave every non-buggy site's detail extraction unchanged:
all goldens other than the 8 listed sites' affected fields — including the
control `eastlogue` golden, all other Cafe24-family goldens, the uniqlo/shopify
USD+KRW goldens, and Phase 1 validator tests — **shall** remain byte-identical.
The full test suite **shall** stay green.

### REQ-DFIX-007 (Ubiquitous) — auditable golden transition

For each affected site, the crawler change **shall** make the golden-value
change explicit and auditable: the PR that lands a site states, per site, the
old (bug-preserved) value, the new (corrected) value, the extraction rule, and
the specific fixture line that justifies the new value. The corrected golden
**shall** be the deterministic output of the fixed extractor run against the
EXISTING fixture (no live re-capture, no fixture HTML edits).

### REQ-DFIX-008 (State-driven) — corrected-characterization precedes fix

**While** development_mode is `ddd`, for each PR the corrected golden values
**shall** be written first (the affected goldens transition from bug-preserved
to corrected, flipping the relevant
`tests/detail-parsers.characterization.test.ts` assertions from "preserve bug"
to "assert corrected"), and only then **shall** the per-type extractor fix be
implemented until those corrected-characterization assertions pass. This is the
analogue of SPEC-ARCH-CRAWLER-001's characterization gate, asserting
correctness instead of preservation. (No source edit to the characterization
test file is required — its per-site assertions read the goldens from disk; the
golden file change alone flips them.)

## Acceptance Criteria

Detailed Given-When-Then scenarios are produced in `acceptance.md` (Plan
workflow follow-up). Acceptance is grouped by the 3 PR types.

### Group A — Type 1 (PR-1: material pollution + shared base fix)

- [HARD] `tests/fixtures/detail/8division.golden.json` `material` =
  `70% Acrylic, 30% Wool`; `blankroom.golden.json` `material` =
  `Wool 80%, Nylon 20%`; `visualaid.golden.json` `material` = `Cotton 100%`.
  All other fields of these 3 goldens byte-identical to pre-fix.
- [HARD] Shared root cause addressed in `field-extractors/material.ts`
  (`baseMaterialFromDescription`) such that `blankroom`/`visualaid` converge on
  the corrected shared primitive; `8division` applies the same rule in
  `eightDivisionStrategy`. research.md shared-cause finding reflected.
- [HARD] `eastlogue.golden.json` unchanged (control); composition-only shape of
  the 3 corrected `material` values is consistent with eastlogue's
  composition-only `material`.

### Group B — Type 2 (PR-2: null-extraction recovery)

- [HARD] `chanceclothing.golden.json`: description =
  `챈스클로딩 데님 자켓입니다. 빈티지한 워싱이 적용되어 있습니다.`, material =
  `Cotton 100%`; `color`/`productCode` byte-identical to pre-fix.
- [HARD] `slowsteadyclub.golden.json`: description =
  `슬로우스테디클럽 셋업 자켓입니다. 클래식한 테일러링이 적용되었습니다.`,
  material = `겉감 - 면 100% 안감 - 폴리에스터 100%`; `color` byte-identical.
- [HARD] `shopamomento.golden.json`: description =
  `샵어모멘토 린넨 셔츠입니다. 자연스러운 구김이 매력적인 제품입니다.`,
  material = `Linen 100%`; `color` = `null`, `productCode` = `null`
  (genuine absence — REQ-DFIX-004).
- shopamomento `commit-then-selector` wait recipe in `selector-registry.ts`
  unchanged (the wait is not the null cause; only the strategy regex changes).

### Group C — Type 3 (PR-3: line-isolation fix)

- [HARD] `takeastreet.golden.json`: color = `블랙`, material =
  `겉감 - 나일론 100% / 안감 - 폴리 100%`; `description`/`productCode`
  byte-identical to pre-fix (`productCode` stays `null` — REQ-DFIX-004).
- [HARD] `adekuver.golden.json`: color = `핑크`, material = `100% CO`,
  productCode = `ADK2024SH001, ADK2024SH002`; `description` byte-identical.

### Cross-group regression gate (all 3 PRs)

- [HARD] Every golden NOT listed above (including `eastlogue` and all other
  non-buggy Cafe24-family sites) is byte-identical. The
  `tests/detail-parsers.characterization.test.ts` "18 sites have fixture +
  golden" / "DetailData 4-field shape" guards still pass. uniqlo/shopify
  characterization and Phase 1 `product-validator` / `parser-strategy` tests
  untouched. `pnpm test` fully green at the end of each PR.
- [HARD] Each PR's commit message states per-site old→new golden value + the
  extraction rule + the justifying fixture line (REQ-DFIX-007).

### Target file layout (post-Phase-2 real paths, crawler-repo-root-relative)

- `src/lib/parsers/field-extractors/strategies.ts` — corrected
  `eightDivisionStrategy` (PR-1), `chanceclothingStrategy`,
  `slowsteadyclubStrategy`, `shopamomentoStrategy` (PR-2),
  `takeastreetStrategy`, `adekuverStrategy` (PR-3).
- `src/lib/parsers/field-extractors/material.ts` — corrected
  `baseMaterialFromDescription` shared primitive (PR-1, Type-1 shared root
  cause; `blankroom`/`visualaid` path via `baseStrategy`).
- `src/lib/parsers/detail/selector-registry.ts` — only if the corrected base
  extractor needs new/changed `materialPatternSrc`/keyword params for the
  base-family entries (no wait-recipe change anywhere).
- `tests/fixtures/detail/{8division,blankroom,visualaid}.golden.json` (PR-1),
  `{chanceclothing,slowsteadyclub,shopamomento}.golden.json` (PR-2),
  `{takeastreet,adekuver}.golden.json` (PR-3) — corrected expected values.
- NOT touched: `registry-detail-parser.ts`, `base-detail-parser.ts`,
  `description.ts`, `color.ts`, `index.ts`, the characterization test source,
  `src/configs/platforms.ts`, any other site's golden/fixture, any fixture
  HTML.

## Dependency Ordering & Rollback (3 independent PRs by bug type)

One SPEC document; implementation/rollout split into 3 independent PRs grouped
by bug type. The PRs touch disjoint golden subsets; PR-2 and PR-3 touch only
their own strategy fns; only PR-1 touches the shared `material.ts`.

| PR | Type | Sites | Golden files | Source files | Revertable independently |
|---|---|---|---|---|---|
| PR-1 | 1 | `8division`, `blankroom`, `visualaid` | those 3 goldens | `strategies.ts` (`eightDivisionStrategy`, `baseStrategy` material block), `material.ts`, maybe base-family entries in `selector-registry.ts` | Yes — revert restores Type-1 bug-preserved goldens + base extractor |
| PR-2 | 2 | `chanceclothing`, `slowsteadyclub`, `shopamomento` | those 3 goldens | `strategies.ts` (those 3 strategy fns only) | Yes — disjoint from PR-1/PR-3 |
| PR-3 | 3 | `takeastreet`, `adekuver` | those 2 goldens | `strategies.ts` (those 2 strategy fns only) | Yes — disjoint from PR-1/PR-2 |

- **Ordering**: PR-1 → PR-2 → PR-3 recommended (PR-1 carries the shared base
  fix and is the highest-leverage; PR-2 heaviest single bug `shopamomento`;
  PR-3 lowest blast radius). No hard inter-PR dependency — each can merge and
  revert alone because golden subsets are disjoint and only PR-1 edits the
  shared primitive.
- **Rollback**: `git revert` of any single PR restores exactly that type's
  bug-preserved goldens + extractor state, leaving the other two types'
  corrections intact. The full suite stays green after any single revert
  because each PR's golden subset matches its source subset.
- Each PR independently keeps `pnpm test` green at merge.

## What NOT to Build (Exclusions / NOT in scope)

- **No live re-capture.** Corrected goldens are derived deterministically from
  the EXISTING `tests/fixtures/detail/<site>.html` PRESERVE fixtures. No
  network, no re-recording, no fixture HTML edits.
- **No `src/configs/platforms.ts` changes.** `slowsteadyclub`/`takeastreet`
  stay `disabled: true`. Re-enabling is a separate downstream decision gated on
  their listing/stock parsers, not this detail-parser fix.
- **No new fields / no DB schema change.** Only the existing 4 `DetailData`
  fields (`description`/`color`/`material`/`productCode`) for the 8 sites.
- **No scope beyond the 8 sites' detail extraction.** The other 10 SPEC sites,
  `eastlogue` control, review parsers (`src/lib/parsers/review/`), Shopify/
  uniqlo engines, Phase 1 validator — all untouched.
- **No change to the registry collapse / strategy DI structure.** Only per-site
  extraction correctness *within* the existing structure. No
  `registry-detail-parser.ts` orchestration change, no wait-recipe change
  (including shopamomento's `commit-then-selector`), no `index.ts` change, no
  characterization-test source change.
- **No `base-detail-parser.ts` change.** The 18 SPEC sites no longer execute
  that class (they route through `RegistryDetailParser` shims); the Type-1
  shared fix lives in `field-extractors/material.ts` + `baseStrategy`. Touching
  the unknown-site fallback would be uncovered scope creep.
- **No drive-by refactor** of correctly-working strategy fns or shared helpers.

## Traceability

- **Authoritative basis**: `.moai/specs/SPEC-ARCH-CRAWLER-001/preserve-findings.md`
  (8-bug inventory, expected-value column, "후속 SPEC 진입 조건"). This SPEC
  consumes that document as its requirement source; corrected targets match its
  "기대값" column for Type 1 and recover the present values it documents for
  Types 2-3.
- **Parent SPEC**: SPEC-ARCH-CRAWLER-001 (this SPEC fulfils its line-9 / line-48
  deferral: "버그 수정은 별도 후속 SPEC ... 그 SPEC 진입 시 본 문서를 근거
  인벤토리로 사용"; and "수정 시 각 사이트 골든값을 기대값으로 의도적 갱신 +
  갱신 사유를 커밋에 명시").
- **Control reference**: `eastlogue` (preserve-findings 대조군) — its
  byte-identical-correct golden and `split(/[-\n]/)` segmentation are the
  "correct extraction" model and a regression anchor (must stay byte-identical).
- **Methodology**: `quality.yaml` `development_mode: ddd` — corrected-
  characterization-precedes-fix gate (REQ-DFIX-008).
- **Per-site evidence and resolved string-form decisions**: `research.md`
  (sibling) — all three annotation judgement calls CONFIRMED to recommended
  values; every per-site corrected golden is unambiguous and
  implementation-ready.
