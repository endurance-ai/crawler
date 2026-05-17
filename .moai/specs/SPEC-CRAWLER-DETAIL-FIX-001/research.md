# SPEC-CRAWLER-DETAIL-FIX-001 — Research (per-site bug analysis)

> Repo: `endurance-ai/crawler` (local `/Users/hansangho/Desktop/kikoai/crawler`). All
> paths are crawler-repo-root-relative. Branch: `fix/spec-crawler-detail-fix-001`
> off `dev`.
>
> This is the deferred follow-up that SPEC-ARCH-CRAWLER-001 explicitly carved out.
> During that SPEC's PRESERVE phase, policy A intentionally froze 8 Cafe24
> detail-parser bugs byte-identically into the golden master (commit `be9bb53`,
> goldens last touched in `45cfac4`). This SPEC **reverses** that for those 8
> sites: it CORRECTS behaviour and transitions their goldens from
> "bug-preserved" to "corrected expected values". This is an intentional
> behaviour CHANGE, not preservation.
>
> Authoritative basis: `.moai/specs/SPEC-ARCH-CRAWLER-001/preserve-findings.md`
> (8-bug inventory, "별도 후속 SPEC" deferral). Architecture basis: Phase 2/3 of
> SPEC-ARCH-CRAWLER-001 is merged to `dev` (PR #11, #12) — the 18 `*-parser.ts`
> modules were deleted; detail parsing now flows through the registry.

## Post-Phase-2 architecture (where the fix lives)

The corrected behaviour MUST be implemented in the registry path, NOT in any
deleted `*-parser.ts` file:

| File | Role | Touched by this SPEC |
|---|---|---|
| `src/lib/parsers/detail/registry-detail-parser.ts` | Sole `IDetailParser`; page-load wait + strategy dispatch | NO (orchestration only — no per-site logic here) |
| `src/lib/parsers/detail/selector-registry.ts` | Per-site `RegistryEntry` (selectors, wait recipe, quirk params) | Maybe (only `materialPatternSrc`/keyword params if the corrected base extractor needs new params; no wait-recipe change) |
| `src/lib/parsers/field-extractors/strategies.ts` | Per-site extraction strategy fns (verbatim copies of old parsers) | YES — `eightDivisionStrategy`, `chanceclothingStrategy`, `slowsteadyclubStrategy`, `shopamomentoStrategy`, `takeastreetStrategy`, `adekuverStrategy` |
| `src/lib/parsers/field-extractors/material.ts` | `baseMaterialFromDescription` shared primitive (base family) | YES — shared Type-1 root-cause fix (blankroom/visualaid path) |
| `src/lib/parsers/field-extractors/description.ts` / `color.ts` | shared base primitives | Read-only reference; no change expected |
| `src/lib/parsers/detail/base-detail-parser.ts` | `BaseDetailParser` unknown-site fallback (NOT used by the 18 SPEC sites — they route through `RegistryDetailParser` shims in `index.ts`) | NO (the 18 sites no longer execute this class; the base-family material defect now lives in `baseStrategy` in `strategies.ts` + `material.ts`) |
| `tests/fixtures/detail/<site>.golden.json` (8 sites) | golden master | YES — corrected expected values (the behaviour-change deliverable) |
| `tests/detail-parsers.characterization.test.ts` | golden assertion harness | NO source edits; its assertions for the 8 sites flip from "preserve bug" to "assert corrected" purely by the golden file change (test reads goldens from disk; no test code change required) |

Important correction to a likely assumption from preserve-findings.md: it says
blankroom/visualaid are "thin `BaseDetailParser` subclasses". Post-Phase-2 that
is no longer literally true — `index.ts` makes `BlankroomDetailParser` /
`VisualalidDetailParser` `RegistryDetailParser` shims whose entries use
`strategy: "base"` (`baseEntry([...])` in `selector-registry.ts`). The
material-pollution defect now lives in `baseStrategy` (inline in
`strategies.ts`, lines ~92-111) and its factored twin
`baseMaterialFromDescription` (`material.ts`). **The shared-root-cause fix
target is therefore `field-extractors/material.ts` + the `baseStrategy`
material block, not `base-detail-parser.ts`.** `base-detail-parser.ts` keeps its
buggy code as the unknown-site fallback and is OUT OF SCOPE (no SPEC site
executes it; changing it would be scope creep with no golden coverage).

## Why innerText collapse is the single common mechanism

Every one of the 8 bugs has the same physical root cause. The fixtures put
section text on separate **source lines** inside one `<div>` text node. Browser
`innerText` collapses literal source newlines + surrounding whitespace into
single spaces (no `<br>` / block children), so the value the extractor receives
is **one space-joined line**. Every buggy extractor assumes the newlines
survived — via `split("\n")`, exact line-equality (`l === "소재"`), or
`\n`-anchored / `^`-line-anchored regexes — so it either over-captures
(material pollution) or fails entirely (null).

**Reference for "correct": `eastlogueStrategy`.** eastlogue produces a
byte-identical-correct golden because it does NOT assume `\n` survived — it
splits on `/[-\n]/` (the bullet "- " delimiter that IS present in the collapsed
text) and then anchors on `^Outshell`. eastlogue's golden:

```
material: "Outshell_1 : 100% Cotton / Outshell_2 : 70% Cotton / 30% Poly"   (correct, byte-identical, MUST NOT change)
```

The corrected extractors for the 8 sites adopt eastlogue's principle: segment
on the delimiter that actually exists after innerText collapse (bullet `- `
and/or known section labels), with whitespace-tolerant separators, instead of
relying on `\n`.

---

## Type 1 — `material` pollution (description prose leaks into `material`)

Shared root cause (verified, not assumed): the base-family material extractor
(`material.ts` `baseMaterialFromDescription` and the identical inline block in
`baseStrategy`) uses regex `(?:소재|원단|Material|Fabric|Composition)\s*[:：]?\s*([^\n<]{3,80})`.
The capture group `([^\n<]{3,80})` terminates only at a newline or `<` or 80
chars. On a newline-collapsed single line the composition is mid-sentence, so
the group greedily swallows the trailing Korean marketing prose. `8division`
uses its own `eightDivisionStrategy` but exhibits the **same structural
defect**: `description.split("\n")` yields one line (no `\n`), and the
`/\d+%\s/` line test then matches the entire space-joined blob, so the whole
description becomes `material`.

Shared-fix finding: a single corrected composition-extraction primitive in
`field-extractors/material.ts` — locate the composition anchor
(`소재`/`원단`/`Material`/`Fabric`/`Composition` label OR a `<pct>% <Fiber>`
token) then capture ONLY the composition expression (a run of
`<pct>% <Fiber>` segments, comma/slash separated) and STOP at the first token
that is not part of a composition (Korean particle such as `으로`/`의`,
sentence boundary, or non-fiber word) — resolves `blankroom` and `visualaid`
together (both flow through `baseStrategy` → the shared primitive). `8division`
needs the same RULE applied inside `eightDivisionStrategy`'s material line scan
(its description segmentation is site-specific). So Type 1 = one shared
primitive fix + one site-local application of the same rule.

| Site | Strategy / path | Fixture evidence (`tests/fixtures/detail/<site>.html`) | Current buggy golden `material` | Corrected target `material` | Extraction rule |
|---|---|---|---|---|---|
| `8division` | `eightDivisionStrategy` (strategies.ts) | `div.product-addinfo`; between `제품정보` and `매장 이용안내`: `- 클래식한 실루엣의 캡입니다. / - 70% Acrylic, 30% Wool / - 데일리하게 착용 가능합니다.` (innerText-collapsed to one line) | `클래식한 실루엣의 캡입니다. - 70% Acrylic, 30% Wool - 데일리하게 착용 가능합니다.` | `70% Acrylic, 30% Wool` | Within the description segment, extract only the composition run (`<pct>% <Fiber>`, comma-separated); ignore non-composition bullet text |
| `blankroom` | `baseStrategy` → `material.ts` `baseMaterialFromDescription` (shared) | `.product-description`: `블랭크룸 오버사이즈 코트입니다. Material: Wool 80%, Nylon 20% 으로 제작되었습니다. 차분한 톤으로 다양한 코디에 활용할 수 있습니다.` | `Wool 80%, Nylon 20% 으로 제작되었습니다. 차분한 톤으로 다양한 코디에` (80-char cap of trailing prose) | `Wool 80%, Nylon 20%` | After `Material:` anchor, capture composition run only; STOP at first Korean particle / non-fiber token (`으로`) |
| `visualaid` | `baseStrategy` → `material.ts` `baseMaterialFromDescription` (shared) | `.tab_wrap`: `비주얼에이드 그래픽 티셔츠입니다. Fabric: Cotton 100% 의 부드러운 원단을 사용했습니다. 시그니처 그래픽이 프린트되어 있습니다.` | `Cotton 100% 의 부드러운 원단을 사용했습니다. 시그니처 그래픽이 프린트되어 있습니다.` | `Cotton 100%` | After `Fabric:` anchor, capture composition run only; STOP at `의` / sentence boundary |

`description` for all three Type-1 sites is already acceptable and MUST stay
byte-identical (only `material` changes). `color`/`productCode` for all three
stay byte-identical.

eastlogue cross-check: eastlogue's `material` = `Outshell_1 : 100% Cotton / Outshell_2 : 70% Cotton / 30% Poly`
is composition-only with no trailing prose — exactly the post-fix shape the 3
Type-1 sites should converge toward (composition-only string).

---

## Type 2 — extraction-failure `null` (newline-collapse defeats `\n` regex)

| Site | Strategy | Fixture evidence | Current buggy golden | Corrected target | Extraction rule |
|---|---|---|---|---|---|
| `chanceclothing` | `chanceclothingStrategy` | `.xans-product-additional` collapsed: `... 소재 Cotton 100% 원산지 대한민국 상품 설명 챈스클로딩 데님 자켓입니다. 빈티지한 워싱이 적용되어 있습니다. 더보기 ...` | `description: null`, `material: null` (`color: "INDIGO, BLACK"`, `productCode: "CC-DNM-2024"` already correct) | `description: "챈스클로딩 데님 자켓입니다. 빈티지한 워싱이 적용되어 있습니다."`, `material: "Cotton 100%"` | Whitespace-tolerant section segmentation: `소재\s+(value)` bounded by next label `원산지`; `상품\s*설명\s+(value)` bounded by `더보기`. (Original code required literal `\n` after the label — never matches collapsed innerText.) `color`/`productCode` unchanged |
| `slowsteadyclub` | `slowsteadyclubStrategy` | `.xans-product-additional` collapsed: `시즌정보 2024 SS 소재 겉감 - 면 100% 안감 - 폴리에스터 100% 원산지 대한민국 사이즈 S / M / L 상세설명 슬로우스테디클럽 셋업 자켓입니다. 클래식한 테일러링이 적용되었습니다.` | `description: null`, `material: null` (`color: "NAVY, BEIGE"` already correct) | `material: "겉감 - 면 100% 안감 - 폴리에스터 100%"`, `description: "슬로우스테디클럽 셋업 자켓입니다. 클래식한 테일러링이 적용되었습니다."` | Segment the additional blob by known labels (`시즌정보`/`소재`/`원산지`/`사이즈`/`상세설명`) using whitespace boundaries, not `split("\n")` + exact `l === "소재"` line-equality (which never matches a single-line blob). `color` unchanged |
| `shopamomento` | `shopamomentoStrategy` | `.xans-product-additional` collapsed: `Product Note 샵어모멘토 린넨 셔츠입니다. 자연스러운 구김이 매력적인 제품입니다. Made In Korea Composition Linen 100% Size Measurement S / M / L` | all 4 `null` (heaviest) | `description: "샵어모멘토 린넨 셔츠입니다. 자연스러운 구김이 매력적인 제품입니다."`, `material: "Linen 100%"`, `color: null`, `productCode: null` | `Product Note\s+(value)` bounded by `Made In`/`Composition`; `Composition\s+(value)` bounded by `Size Measurement`/end. `color`/`productCode` STAY `null` — the fixture has no `<select>` / no product code, so these are genuine absences, NOT bugs (do not invent values) |

shopamomento note: its registry entry uses a `commit-then-selector` wait
recipe. The characterization harness fulfills `page.route` instantly so the
selector is present — the wait recipe is NOT the null cause; the `\n`-anchored
regex is. **Do not change the wait recipe** (out of scope; only the strategy
regex changes).

eastlogue cross-check: eastlogue's description correctly cuts at `제조원 :`
using a whitespace-tolerant `search()` (not a `\n`-anchored capture) — the same
tolerance principle the Type-2 fixes apply to their section boundaries.

---

## Type 3 — line-isolation bug: `color`/`material` null despite being present

preserve-findings.md attributes takeastreet to "MODEL SIZE cut runs before line
scan". Verified mechanism is more precise: the `MODEL SIZE` description cut
works fine; the actual defect is `rawDesc.split("\n")` + `^`-line-anchored
`/^컬러\s*[:：]/` / `/^소재\s*[:：]/`. After innerText collapse `rawDesc` is ONE
line beginning with the product sentence, so the labels are mid-line and never
line-start-anchored. Same family as adekuver.

| Site | Strategy | Fixture evidence | Current buggy golden | Corrected target | Extraction rule |
|---|---|---|---|---|---|
| `takeastreet` | `takeastreetStrategy` | `div.detail_left` collapsed: `테이크어스트릿 카고 팬츠입니다. 스트리트 무드의 와이드 실루엣입니다. 컬러 : 블랙 소재 : 겉감 - 나일론 100% / 안감 - 폴리 100% MODEL SIZE 모델 착용 정보 175cm` | `color: null`, `material: null` (`description` already correct: text before `MODEL SIZE`) | `color: "블랙"`, `material: "겉감 - 나일론 100% / 안감 - 폴리 100%"` | Match `컬러\s*[:：]\s*(value)` bounded by next label `소재`; `소재\s*[:：]\s*(value)` bounded by `MODEL SIZE`/end — WITHOUT `split("\n")` / `^` line anchor. `description` unchanged |
| `adekuver` | `adekuverStrategy` | `.item.open .content` collapsed: `- 핑크 컬러 - 코튼 셔츠 - 클래식한 디테일의 셔츠입니다 - 100% CO - MADE IN KOREA ADK2024SH001 ADK2024SH002` | `color: null`, `material: null`, `productCode: null` (`description` already correct) | `color: "핑크"`, `material: "100% CO"`, `productCode: "ADK2024SH001, ADK2024SH002"` | Segment on the bullet delimiter `-\s` (eastlogue principle) instead of `\n`: `핑크 컬러` → strip `컬러` → `핑크`; `<pct>% <Fiber>` token → `100% CO`; `[A-Z0-9]{6,}` tokens → join `, ` (matches the original code's own `codes.join(", ")` intent). `description` unchanged |

eastlogue cross-check: this is the most direct one — eastlogue's
`rawDesc.split(/[-\n]/)` is exactly the segmentation Type-3 must adopt. The
Type-3 fix is essentially "make takeastreet/adekuver segment like eastlogue
already does".

---

## Per-site summary table (current → corrected)

Only the listed fields change; every other field of each site's golden, and
every other site's golden, stays byte-identical.

| Site | Type | Field | Current (buggy) | Corrected target |
|---|---|---|---|---|
| `8division` | 1 | material | `클래식한 실루엣의 캡입니다. - 70% Acrylic, 30% Wool - 데일리하게 착용 가능합니다.` | `70% Acrylic, 30% Wool` |
| `blankroom` | 1 | material | `Wool 80%, Nylon 20% 으로 제작되었습니다. 차분한 톤으로 다양한 코디에` | `Wool 80%, Nylon 20%` |
| `visualaid` | 1 | material | `Cotton 100% 의 부드러운 원단을 사용했습니다. 시그니처 그래픽이 프린트되어 있습니다.` | `Cotton 100%` |
| `chanceclothing` | 2 | description | `null` | `챈스클로딩 데님 자켓입니다. 빈티지한 워싱이 적용되어 있습니다.` |
| `chanceclothing` | 2 | material | `null` | `Cotton 100%` |
| `slowsteadyclub` | 2 | description | `null` | `슬로우스테디클럽 셋업 자켓입니다. 클래식한 테일러링이 적용되었습니다.` |
| `slowsteadyclub` | 2 | material | `null` | `겉감 - 면 100% 안감 - 폴리에스터 100%` |
| `shopamomento` | 2 | description | `null` | `샵어모멘토 린넨 셔츠입니다. 자연스러운 구김이 매력적인 제품입니다.` |
| `shopamomento` | 2 | material | `null` | `Linen 100%` |
| `shopamomento` | 2 | color / productCode | `null` / `null` | `null` / `null` (genuine absence — unchanged) |
| `takeastreet` | 3 | color | `null` | `블랙` |
| `takeastreet` | 3 | material | `null` | `겉감 - 나일론 100% / 안감 - 폴리 100%` |
| `adekuver` | 3 | color | `null` | `핑크` |
| `adekuver` | 3 | material | `null` | `100% CO` |
| `adekuver` | 3 | productCode | `null` | `ADK2024SH001, ADK2024SH002` |

Exact final whitespace of each corrected string is whatever the unmodified
fixture innerText yields between the named anchors — derived deterministically
from the fixture, no live re-capture. The implementation phase (RUN) computes
each corrected golden by running the fixed extractor against the EXISTING
fixture HTML and committing the result with the old→new diff and the
fixture line that justifies it.

## Resolved string-form decisions (annotation CONFIRMED)

The three string-form judgement calls were resolved in the annotation cycle to
their recommended values. They are now CONFIRMED acceptance values — no value
changes were needed. Every per-site corrected golden above and below is
unambiguous and implementation-ready; no further user input is required.

1. **`slowsteadyclub` material form — CONFIRMED**: the innerText-collapsed raw
   substring `겉감 - 면 100% 안감 - 폴리에스터 100%` (space-joined, as the
   browser yields). No `/`-normalisation of the embedded `겉감/안감` structure
   — least transformation, matches eastlogue's "keep what's there" philosophy.
2. **`adekuver` productCode — CONFIRMED**: `ADK2024SH001, ADK2024SH002` (join
   both codes via `codes.join(", ")`, matching the original code's own intent).
   Not first-code-only.
3. **Type-2 description form — CONFIRMED**: the exact innerText substring
   between section anchors, trimmed only (no further whitespace/punctuation
   normalisation). Applies to chanceclothing / slowsteadyclub / shopamomento
   descriptions.

All corrected values are unambiguous from the fixture evidence.

## Disabled-platform note (scope boundary)

`src/configs/platforms.ts` currently has `disabled: true` for `slowsteadyclub`
(line 52, "재고 파서 미스") and `takeastreet` (line 404, "셀렉터 전면 실패").
A concurrent session set those. **Re-enabling is OUT OF SCOPE for this SPEC.**
This SPEC fixes the detail parser + corrects the golden only. The parser fix is
still valuable for those 2 sites and lands ahead of any re-enable decision
(re-enabling is a separate downstream call gated on the full-listing/stock
parser, not the detail parser). `platforms.ts` is not touched.

## Methodology

`quality.yaml` `development_mode: ddd`. This SPEC is the inverse of
SPEC-ARCH-CRAWLER-001's PRESERVE gate: corrected-characterization tests are
defined FIRST (the 8 goldens transition to corrected expected values), then the
per-type extractor fix makes them pass. Same gate shape as the parent SPEC, but
asserting CORRECTNESS instead of preservation.
