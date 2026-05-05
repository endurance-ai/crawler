# SPEC Review Report: SPEC-PLATFORM-EXPANSION-001

Iteration: 1/3
Verdict: FAIL
Overall Score: 0.62

## Summary

The SPEC has strong EARS structure (all 7 REQs match canonical patterns) and clean traceability (every REQ has at least one AC; every AC traces to a valid REQ). However, the verdict is FAIL on two grounds. First, the YAML frontmatter (must-pass MP-3) omits the required `labels` field entirely and uses `created` instead of the required `created_at` field name — both are unambiguous frontmatter defects. Second, plan.md has not been kept in sync with the final spec.md: it asserts a 5-REQ scope while the SPEC ships 7 REQs, names a `crawlDelay` baseline of 1500 ms in two risk/decision rows while the REQs themselves use 1000 ms, and explicitly says "no UA randomization beyond a single realistic Mozilla string" while REQ-002 mandates a 5-element UA rotation. These are not cosmetic — an implementer reading plan.md as the source of truth would build the wrong thing. The audit also flags one logic gap (REQ-005 "consecutive" boundary undefined for the "non-consecutive but cumulative" failure mode) and one minor count statement in spec.md §Acceptance References.

Reasoning context ignored per M1 Context Isolation.

## Must-Pass Results

- [PASS] **MP-1 REQ number consistency**: REQ-001 through REQ-007 are sequential, no gaps, no duplicates, consistently zero-padded to 3 digits. Verified spec.md:L55, L61, L67, L73, L79, L85, L91 and spec-compact.md:L9, L13, L17, L21, L25, L29, L33.
- [PASS] **MP-2 EARS format compliance**: All 7 REQs match canonical EARS patterns. REQ-001 (Ubiquitous, "THE crawler SHALL register..." spec.md:L57), REQ-002 (Event-driven, "WHEN... THE crawler SHALL fetch..." spec.md:L63), REQ-003 (Event-driven, spec.md:L69), REQ-004 (State-driven, "WHILE... THE crawler SHALL fetch..." spec.md:L75), REQ-005 (Unwanted, "IF... THEN THE crawler SHALL abort..." spec.md:L81), REQ-006 (Ubiquitous, spec.md:L87), REQ-007 (Optional, "WHERE... THE crawler SHALL override..." spec.md:L93).
- [FAIL] **MP-3 YAML frontmatter validity**: Required field `labels` is absent (spec.md:L1-L10 — only `id`, `version`, `status`, `created`, `updated`, `author`, `priority`, `issue_number` appear). Required field `created_at` is also absent: the document uses `created: 2026-05-05` (spec.md:L5) which is not the same field name. Per audit checklist FC-4 and FC-6, both are required, and any single missing required field constitutes MP-3 FAIL.
- [N/A] **MP-4 Section 22 language neutrality**: This SPEC is scoped to a single web-crawler engine (Uniqlo KR). It does not touch multi-language LSP tooling. Auto-passes per audit rule.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 band — minor ambiguity | REQ-001 says `apiCategoryPaths: string[]` (mandatory) but spec.md:L110 and plan.md:L17 declare it `apiCategoryPaths?: string[]` (optional in the type). Reasonable engineers will resolve consistently (optional in the union type, mandatory for the Uniqlo entry), but the wording is ambiguous. REQ-001:L57 "etc." in sub-category list ("jackets, knitwear, T-shirts, pants, dresses, etc.") is not enumerable. |
| Completeness | 0.75 | 0.75 band — one section sparse, frontmatter incomplete | All major sections present: HISTORY (L12), Overview (L20), Goals (L26), Non-Goals/Exclusions (L34), Requirements (L51), Technical Approach (L97), Files Affected (L103), Acceptance References (L121), Open Risks (L125). Frontmatter missing two required fields. |
| Testability | 0.85 | between 0.75 and 1.0 | All 7 ACs are concrete and binary-testable except for one weasel phrase: AC-2 verification (acceptance.md:L61) hinges on "rate-limited request helper" being independently invocable — implementation-coupled. AC-6 verification (acceptance.md:L168) uses "approximately 500ms each" — softened by explicit 1500-1700ms band, so still binary. No "appropriate", "adequate", "reasonable" appear in normative AC text. |
| Traceability | 1.0 | 1.0 band | Every REQ-001..007 has at least one AC: REQ-001→AC-1, REQ-002→AC-2 + AC-7, REQ-003→AC-3, REQ-004→AC-4, REQ-005→AC-5, REQ-006→AC-2, REQ-007→AC-6. Every AC explicitly cites its REQ in the "Maps to" header (acceptance.md:L15, L40, L67, L94, L121, L148, L175). Spec-compact.md mirrors the mapping. |

## Defects Found

**D1. spec.md:L1-L10 — Missing `labels` frontmatter field — Severity: BLOCKER (MP-3)**
The frontmatter declares `id`, `version`, `status`, `created`, `updated`, `author`, `priority`, `issue_number` but not `labels`. Audit checklist FC-6 requires `labels` (array or string). Any single missing required field is an automatic MP-3 FAIL.

**D2. spec.md:L5 — Frontmatter uses `created` instead of `created_at` — Severity: BLOCKER (MP-3)**
The audit checklist FC-4 specifies `created_at` (ISO date string). The document writes `created: 2026-05-05`. Strict reading: the required field name is absent. If the project schema actually canonicalizes on `created`, this needs to be reconciled at the harness/schema layer, but the audit must report against the documented checklist.

**D3. plan.md:L71 vs spec.md:L51-L93 — Plan declares 5-REQ scope but SPEC ships 7 REQs — Severity: MAJOR**
Plan.md:L71 reads: "Five requirements is intentional and minimal. Adding more would risk implementation creep beyond the Uniqlo scope." Plan.md:L73 reads: "Requirement IDs renumber as REQ-PE-001..005 in spec.md once the SPEC is finalized." The shipped spec.md has 7 REQs (REQ-001..007) and uses the unprefixed REQ-NNN scheme. plan.md was not refreshed when REQ-006 (test suite) and REQ-007 (--rate flag) were added. An implementer using plan.md as the contract will under-build the SPEC by two requirements.

**D4. plan.md:L124 vs spec.md:L63, spec-compact.md:L15, plan.md:L85 — `crawlDelay` baseline contradicts itself — Severity: MAJOR**
Plan.md:L124 (Risk row 2) writes `crawlDelay: 1500` ms. Plan.md:L139 (Q5 recommendation) writes "start at 1500 ms". Plan.md:L96 (Q5 verification box) writes "Q5 resolved — rate limit is 1 req/sec (1000ms) baseline". Plan.md:L85 (Files table) writes `crawlDelay: 1000`. Spec.md:L63 (REQ-002), spec-compact.md:L15, and acceptance.md:L153 all write 1000 ms. Plan.md is the only artifact carrying 1500 ms, and it carries both values. This is internally contradictory and the older 1500 ms text was not purged after Q5 was resolved.

**D5. plan.md:L124 vs spec.md:L63, spec-compact.md:L15 — UA strategy contradicts itself — Severity: MAJOR**
Plan.md:L124 (Risk row 2) writes "no UA randomization beyond a single realistic Mozilla string." Spec.md:L63 (REQ-002) writes "rotate through a hardcoded list of 5 realistic Mozilla User-Agent strings (one UA per request, round-robin)." Plan.md:L81 (Files table) actually agrees with the SPEC ("UA rotation list of 5 strings"), so plan.md contradicts itself within the same file as well as contradicting the SPEC. An implementer skimming the risk table will build the wrong UA strategy.

**D6. plan.md:L73 — Requirement renumbering promise unfulfilled — Severity: MINOR**
Plan.md:L73: "Requirement IDs renumber as REQ-PE-001..005 in spec.md once the SPEC is finalized." Spec.md uses REQ-001..007 (no `PE-` prefix). Either the renumbering rule should be retracted from plan.md or the SPEC should adopt the prefixed form. Currently they disagree.

**D7. spec.md:L123 — Acceptance scenario count claim is off-by-one in phrasing — Severity: MINOR**
Spec.md:L123: "The acceptance suite contains seven scenarios covering all seven requirements (REQ-001 through REQ-007) plus one edge case (empty category response)." Reading this as "7 + 1 = 8 scenarios" overstates: acceptance.md has 7 ACs total, where AC-7 is itself the edge case. Rephrase as "seven scenarios covering all seven requirements (REQ-001 through REQ-007), one of which (AC-7) is an edge case for REQ-002."

**D8. spec.md:L57 — REQ-001 sub-category list is not closed — Severity: MINOR**
REQ-001 ends "...as path codes consumable by the `/kr/api/commerce/v5/ko/products?path=` query parameter" but the enumeration ends with "etc.": "WOMEN, MEN, KIDS top-level codes plus their direct sub-category codes (jackets, knitwear, T-shirts, pants, dresses, etc.)". The Uniqlo SiteConfig will be a literal string list — testers cannot decide PASS/FAIL on the "etc." portion. Either remove "etc." and freeze the list, or move the enumeration to a referenced sub-document.

**D9. spec.md:L81 + acceptance.md:L142 — REQ-005 "consecutive" semantics undefined for non-consecutive cumulative failures — Severity: MINOR**
REQ-005: "IF the Uniqlo API returns HTTP 4xx or 5xx for **3 consecutive** page requests..." AC-5 (acceptance.md:L142) tests strictly consecutive 503s. Unspecified behavior: 5xx → 200 → 5xx → 200 → 5xx (3 errors interleaved with successes). Does that abort? Probably no per literal reading, but no AC verifies this is the intended interpretation. An adversarial implementer could implement either way.

**D10. spec.md:L93 + acceptance.md:L164 — REQ-007 N=0 / negative / fractional rejection unspecified — Severity: NIT**
REQ-007 says "where N is a positive integer denoting requests per second" and rejects "N greater than 5". Unspecified: rejection of N=0, N=-3, N=2.5. AC-6 only tests N=10. The parser test should also assert N=0 and N=-1 are rejected.

**D11. plan.md:L97 — Open verification item never closed — Severity: NIT**
plan.md:L97: "[ ] Confirm whether `import-products.ts` `product_no` extraction regex needs a Uniqlo branch — research says null is acceptable, but a pre-flight assertion against the products schema is prudent. Currently treated as out-of-scope; revisit if the dry-run output shows `product_no: null` as a problem." This is the only unchecked item in §4 Verification, and it ships into Run phase as ambiguous. Either close it (resolve in/out of scope explicitly) or move it to Open Risks.

## Chain-of-Verification Pass

Second-pass re-verification of the items I treated quickly in pass 1:

- Re-read all 7 REQ headings line-by-line against the 5 EARS patterns: REQ-004's "WHILE registering a new platform OR starting a crawl" is a compound state condition. EARS ubiquity strict readers might object that two distinct states are merged into one State-driven REQ — arguably this should be split into REQ-004a (registration) and REQ-004b (crawl-start). I am leaving it as PASS for MP-2 because the SHALL-clause and condition are well-formed; the compound state is a clarity concern, already counted in the Clarity rubric (0.75 band).
- Re-walked the AC↔REQ mapping for every AC: confirmed none orphaned, none reference a missing REQ. AC-7's "Maps to: REQ-002 edge case" (acceptance.md:L177) is acceptable shorthand.
- Re-checked the Exclusions section for specificity: spec.md:L34-L49 and spec-compact.md:L110-L125 enumerate specific platforms (ZARA, 29CM, Musinsa, H&M, Inditex sub-brands, H&M Group sub-brands) and specific technical exclusions (schema migration, R2, FX API, linter, Vitest, IP rotation, etc.). All entries are specific, not vague. PASS for SC-6.
- Re-scanned spec-compact.md for divergence from spec.md: REQ wording is faithfully preserved (spec-compact.md trims source citations and prose but keeps the SHALL-clauses verbatim). The frontmatter defects in spec.md propagate by reference; spec-compact.md has no frontmatter of its own.
- Re-verified that plan.md's §4 file table matches spec.md's "Files Affected" table line-by-line: identical paths, actions, LOC estimates, and purposes. No divergence here.
- New defect surfaced in second pass: D11 (plan.md unchecked verification item).

No new BLOCKER or MAJOR defects discovered in second pass.

## Recommendation

To reach PASS on iteration 2, manager-spec must address all BLOCKER and MAJOR defects. Numbered fix list:

1. **Add `labels` to spec.md frontmatter (D1)**: Insert a `labels:` line in the YAML block (e.g., `labels: [crawler, platform, uniqlo]`). Required by MP-3.
2. **Rename `created` → `created_at` in spec.md frontmatter (D2)**: Change line 5 from `created: 2026-05-05` to `created_at: "2026-05-05"`. Required by MP-3. Optionally retain `created` as an alias if the project schema accepts it, but `created_at` MUST be present.
3. **Reconcile plan.md REQ count with spec.md (D3)**: Update plan.md §3 to enumerate REQ-001..007 (drop the "Five requirements is intentional" claim and remove L73's REQ-PE renumbering note). Plan.md must declare the same scope as spec.md.
4. **Purge stale 1500ms references from plan.md (D4)**: Edit plan.md:L124 (Risk row 2) and L139 (Q5 recommendation) to read 1000 ms. The Files table at L85 and the Q5 verification box at L96 already say 1000 ms — bring §7 and §8 into agreement.
5. **Correct UA strategy in plan.md risk row (D5)**: Edit plan.md:L124 from "no UA randomization beyond a single realistic Mozilla string" to "5-element UA rotation list, no IP rotation, no fingerprint randomization beyond UA." This is the only place plan.md disagrees with REQ-002.
6. **Remove or implement the REQ-PE renumbering (D6)**: Either delete plan.md:L73 entirely or rename spec.md REQs to REQ-PE-001..007. Recommend deletion since REQ-001..007 is already shipped and traceable across all four files.
7. **Fix scenario-count phrasing (D7)**: Edit spec.md:L123 to read "seven scenarios covering all seven requirements (REQ-001 through REQ-007), of which AC-7 is an edge case for REQ-002."
8. **Close the sub-category enumeration (D8)**: In spec.md:L57 and spec-compact.md:L11, replace "(jackets, knitwear, T-shirts, pants, dresses, etc.)" with the literal list that will appear in `platforms.ts`, OR add a sub-document reference like "see §Files Affected for the canonical list which mirrors `src/configs/platforms.ts`."
9. **Disambiguate REQ-005 "consecutive" (D9)**: Add one sentence to REQ-005 stating "Consecutive means without an intervening 2xx response on the same category path; non-consecutive errors do not trigger abort." Mirror the addition into AC-5's Then clause.
10. **Tighten REQ-007 boundary cases (D10)**: Add to REQ-007: "Values of N <= 0 or non-integer N SHALL also be rejected at command-parse time with a clear error." Add a corresponding AC-6 verification line.
11. **Resolve plan.md:L97 open item (D11)**: Either mark as `[x] Confirmed: out-of-scope per research.md §3.5` or move into Open Risks with a Run-phase verification step.

After fixes 1-2 (the BLOCKERs) and 3-5 (the MAJORs) land, the SPEC will pass MP-3 and consistency checks. Fixes 6-11 are recommended for clean PASS but are not strictly blocking.
