# Research: SPEC-PLATFORM-EXPANSION-006 — Farfetch KR luxury multi-brand crawler

Status: complete
Author: hansangho
Date: 2026-05-06
Reference SPECs: SPEC-PLATFORM-EXPANSION-001..005.

## §1 Live probe results (2026-05-06)

### §1.1 robots.txt — permissive for catalog

`https://www.farfetch.com/robots.txt`:
- Sitemap declared: `https://www.farfetch.com/sitemap.xml`
- Disallow: `*/experience-gateway`, `*/sst/`, `*/*?ffref=*`, country code prefixes only
- **No blanket `Disallow: /`**, **no `Disallow: /*?page=*`** (contrast: SSENSE blocks pagination)

robots-check pre-flight returns `{allowed: true}`.

### §1.2 ToS URL — Korean canonical

Footer extraction from `https://www.farfetch.com/`:
- `https://www.farfetch.com/kr/terms-and-conditions/` (primary, KR-routed)
- `https://www.farfetch.com/kr/privacy-policy/`

REQ-008 captures Korean ToS via Playwright `page.evaluate(() => document.body.innerText)`, scans bilingual keywords (`크롤러`, `크롤링`, `자동화`, `봇`, `로봇`, `스크래핑`, `자동 수집`, `자동화 도구`, `crawl`, `crawler`, `scrape`, `automated`, `bot`), classifies verdict, embeds verbatim clauses at `src/lib/farfetch-engine.ts` top-of-file. Pattern: SPEC-004 (29CM live capture) + SPEC-005 (bilingual scan).

### §1.3 Multi-navigation stability — passes 5/6

Six sequential navigations within single Playwright session (`channel:"chrome"`, KR-presenting IP):

| # | URL | HTTP | Cards | Notes |
|---|---|---|---|---|
| 1 | `/shopping/men/items.aspx` | 200 | 23 | Men landing |
| 2 | `/shopping/men/clothing-2/items.aspx` | 200 | 1595 | Korean locale auto |
| 3 | `/shopping/men/shoes-1/items.aspx` | 410 | 1 | Wrong slug; not anti-bot |
| 4 | `/shopping/women/items.aspx` | 200 | 212 | Women landing |
| 5 | `/shopping/women/clothing-1/items.aspx` | 200 | 2157 | Largest |
| 6 | `/shopping/women/items.aspx?page=2` | 400 | 202 | **400 + populated body** |

5/6 rendered real product DOM, no DataDome challenge. **SSENSE failed nav 2** with `title="Just a moment..."`. Farfetch is materially friendlier.

Card count selector `a[href*="/shopping/"]` is over-broad; Run-phase refines to `[data-component*="ProductCard"]` or `a[href*="-item-"]`.

### §1.4 Pagination quirk — HTTP 400 with populated body

`?page=2` → HTTP 400 BUT 202 cards in DOM. Edge cache classifies paginated requests as 4xx; SPA still hydrates. Engine MUST NOT abort on 4xx when `card count >= 10`. REQ-006 abort criteria extended.

Sitemap-derived URLs preferred (clean 200 status). REQ-009 makes Run-phase parse `sitemap.xml`, extract paginated catalog URLs, live-verify each.

### §1.5 Server-side geo-routing

Browser context `locale:"en-US"` + `timezoneId:"America/New_York"` was overridden by IP-based geo to KR locale (`title="의류 남성 컬렉션"`). Feature, not bug:
- Korean product names (no translation)
- KRW pricing (no FX)
- Localized taxonomy

Future en-US/en-UK SPECs require explicit `/uk/` or `/us/` path prefix.

### §1.6 Image host hypothesis

Candidates (lock at Run-phase ANALYZE): `cdn-images.farfetch-contents.com`, `cdn.farfetch.com`. Defensive fallback: any host ending `.farfetch-contents.com` or `.farfetch.com`.

### §1.7 Product URL pattern

Hypothesis: `^https:\/\/www\.farfetch\.com\/kr\/shopping\/[^"'\s]+-item-\d+\.aspx$`. Run-phase verifies across 50+ URLs.

## §2 Engine architecture — DOM-scrape

### §2.1 Why DOM-scrape (not XHR-interception)

ZARA SPA fetches product JSON lazily → XHR-interception works. Farfetch SSRs product cards in initial HTML (1500+ cards in raw DOM). No equivalent product-list JSON XHR observed.

→ Walk DOM via `page.evaluate`. Mirror Cafe24 engine pattern.

### §2.2 Hybrid lifecycle: ZARA Playwright + Cafe24 DOM

```
ZARA engine                       Farfetch engine
──────────────                    ───────────────
chromium.launch                ─→ chromium.launch (channel:"chrome")
context.locale: ko-KR/en-US    ─→ minimal context — let server geo-route
page.on("response") XHR        ─→ NOT USED (DOM-only)
parseProductsFromXhr(json)     ─→ parseProductsFromDom(page)
abort-on-3-consecutive         ─→ abort-on-3 (extended: 4xx-with-body OK)
robots-check pre-flight        ─→ robots-check (reuse SPEC-001)
ToS verbatim top-of-file       ─→ ToS verbatim (KR primary)
image-host whitelist           ─→ image-host whitelist
5-UA rotation per context      ─→ 5-UA rotation per context
crawlDelay 2 sec               ─→ crawlDelay 3+ sec (more conservative)
```

### §2.3 Why new module, not extend ZARA

XHR-interception vs DOM-scrape are different extraction strategies. Folding both into one module conflates concerns. Future shared `playwright-lifecycle.ts` extraction is out-of-scope here.

## §3 Selector candidates and image hosts

### §3.1 Card selector candidates

| Candidate | Specificity | Notes |
|---|---|---|
| `[data-component*="ProductCard"]` | High | React component naming |
| `[data-testid*="product"]` | High | E2E selector leak |
| `a[href*="-item-"]` | Medium | Product URL pattern marker |
| `a[href*="/shopping/"]` | Too broad | Used in recon (false positives) |

### §3.2 Image host whitelist

Hypothesis: `cdn-images.farfetch-contents.com`, `cdn.farfetch.com`. Lock at PRESERVE.

### §3.3 productUrl regex

Hypothesis: `^https:\/\/www\.farfetch\.com\/kr\/shopping\/[^"'\s]+-item-\d+\.aspx$`.

## §4 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DataDome / anti-bot escalation at scale | Medium | High | REQ-007 8+ nav HARD precondition. 3+ sec pacing. Sitemap-derived URLs reduce probe noise. Rollback: per-category browser session reset |
| ToS contains anti-scraping clause naming "크롤러" verbatim (like 29CM) | Unknown | Critical | REQ-008 live capture. If FORBIDS, `disabled: true` + escalate per HARD rule #1 |
| HTTP 400 pagination breaks status-based abort | Already observed | Medium | REQ-006 extended: 4xx + cards>=10 is NOT error. Engine reads DOM count BEFORE status |
| Card selector drifts after re-skin | Medium | Medium | Characterization fixture (REQ-010) catches drift. 3 fallback candidates §3.1 |
| KR locale instability (server ABA-tests English fallback) | Low | Low | Engine asserts Hangul in product names. Drift caught immediately |
| Farfetch C&D | Low | Critical | `disabled: true` toggle. KR engine independent of future US/UK |
| Sitemap drift — stale categoryUrls | Medium | Low | 90-day refresh cadence; refresh on first failure |
| Image host insufficient (3rd-party CDN) | Low | Low | PRESERVE inspects 50+ live `<img src>`. Document additions |
| 4xx → 5xx escalation at scale | Low | High | Sitemap-only fallback. REQ-009 already prefers sitemap |

## §5 References

### §5.1 Sibling SPECs

- SPEC-005 (ZARA US): primary structural template — Run-phase HARD gates, ToS verbatim, parameterized fixture, abort-on-3, image-host whitelist.
- SPEC-004 (29CM KR): live Playwright ToS capture pattern.
- SPEC-003 (ZARA KR): Playwright lifecycle, `channel:"chrome"`, 5-UA rotation, top-of-file ToS comment.
- SPEC-001 (Uniqlo KR baseline): robots-check, abort-on-3, fixture pattern, `--rate=N`.

### §5.2 Existing engines

- `src/lib/zara-engine.ts`: Playwright lifecycle template. Borrow `crawlOneCategory` wrapper, replace XHR with DOM evaluation.
- `src/lib/cafe24-engine.ts`: DOM-scrape pattern. Adapt to React DOM.
- `src/lib/29cm-engine.ts`: verbatim ToS embedding contract with bilingual support.
- `src/lib/types.ts`: extend `PlatformType` with `"farfetch"` (1 LOC).

### §5.3 Live recon artifacts (2026-05-06)

- `https://www.farfetch.com/robots.txt`
- `https://www.farfetch.com/sitemap.xml` (Run-phase entry point)
- 6 `page.goto` probes (Men/Women top + Clothing/Shoes L2 + ?page=2)
- Footer ToS link extraction

## §6 Open questions for Run-phase

1. Card selector primary lock among `[data-component*="ProductCard"]`, `[data-testid*="product"]`, `a[href*="-item-"]`
2. Image host whitelist exact set
3. Sitemap structure (index file? per-category split?)
4. `?page=N` ceiling
5. Korean ToS keyword vocabulary expansion (`자동 수집`, `자동화 도구`, `봇 차단`, `프로그램`, `소프트웨어 이용`)

---

Version: 1.0
SPEC: SPEC-PLATFORM-EXPANSION-006
