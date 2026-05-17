/**
 * SPEC-ARCH-CRAWLER-001 Phase 3 (REQ-CRAWLER-004) — Pluggable parser
 * strategy + dependency-injection container.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this layer, adding crawl platform #33 meant copy-pasting a whole
 * module and wiring it by hand into the dispatch switch. REQ-CRAWLER-004
 * makes a new platform reduce to: (1) write one `Parser` strategy (a thin
 * adapter around the platform's parse function) and (2) register it in the
 * container by key. The shared `field-extractors/` primitives (Phase 2)
 * remain the single source of extraction logic — the cafe24 strategy
 * routes THROUGH them via the Phase 2 registry, it does not duplicate them.
 *
 * [HARD] BEHAVIOR-PRESERVING WIRING ONLY (policy A).
 * Every adapter here is a verbatim pass-through to an already-existing
 * parse function. No adapter reshapes, filters, reorders, or reformats
 * input or output. The emitted `Product[]` / `DetailData` is byte-identical
 * to calling the wrapped function directly — this is provable because:
 *   - shopify  -> wraps `parseShopifyProducts` (locked by
 *     tests/fixtures/shopify-parse.golden.json + .krw.golden.json)
 *   - uniqlo   -> wraps `parseProducts` (locked by
 *     tests/fixtures/uniqlo-kr-parse.golden.json)
 *   - cafe24   -> wraps `getDetailParser(site).parse` i.e. the Phase 2
 *     RegistryDetailParser path (locked by the 18
 *     tests/fixtures/detail/*.golden.json characterization goldens)
 * The new tests/parser-strategy.test.ts additionally asserts each adapter
 * delegates with zero drift against the wrapped function directly.
 *
 * CALL-SITE STATUS (intentionally left on the legacy direct path):
 *   src/crawl.ts L482 `crawlUniqlo(config)`,  L598 `crawlShopify(config)`,
 *   L631-633 `getDetailParser(config.key)` + `crawlCafe24(...)`.
 * These three sites invoke the LIVE crawl orchestrators. The pure parse
 * seams this layer wraps live *inside* those orchestrators (shopify/uniqlo)
 * or are the detail-parser injected into the live cafe24 crawl. Routing
 * crawl.ts through the container would either require live fetch inside a
 * strategy (out of REQ-004 scope and NOT provable by the pure-mapping
 * goldens) or add a behavior-neutral 1-line swap to a concurrently-owned
 * file (src/crawl.ts / src/lib/cafe24-engine.ts) with no output delta.
 * Per SPEC ("call sites either keep working unchanged OR route through the
 * container with identical output ... Document any call site intentionally
 * left on the legacy direct path") all three are documented here as
 * deliberately legacy. The container + registered strategies form the
 * resolution seam; a future SPEC may cut the live orchestrators over once
 * a live-fetch strategy contract is in scope.
 *
 * @MX:SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-004
 */

import type {Page} from "playwright"

import type {Product} from "../types"
import type {DetailData, IDetailParser} from "./detail"
import {getDetailParser} from "./detail"
import {parseShopifyProducts} from "../shopify-engine"
import {parseProducts as parseUniqloProducts} from "../uniqlo-engine"

/**
 * @MX:ANCHOR: [AUTO] Universal parser-strategy contract. Every crawl
 * platform's parse path is reachable through this single generic shape:
 * a stable `platform` key + a `parse(input)` that yields the platform's
 * native output (`Product[]` for list engines, `DetailData` for the
 * cafe24 detail layer).
 * @MX:REASON: fan_in — the DI container, all three platform adapters, the
 * new strategy unit tests, and any future site #33 adapter depend on this
 * interface. Widening or reshaping it changes every platform's wiring at
 * once, so it is a frozen structural contract (output stays byte-identical
 * to the wrapped functions — policy A).
 * @MX:SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-004
 *
 * `TInput` and `TOutput` are intentionally per-platform: the three live
 * platforms have irreducibly different parse shapes (Shopify JSON,
 * Uniqlo JSON, cafe24 live detail page). The contract unifies the
 * *resolution + invocation* protocol, not the payload types — forcing a
 * single payload type would be lossy generalization (TRUST: simplicity).
 */
export interface Parser<TInput, TOutput> {
  /** Stable registry key this strategy is resolved by. */
  readonly platform: string
  /** Verbatim delegation to the wrapped platform parse function. */
  parse(input: TInput): TOutput | Promise<TOutput>
}

// --- Per-platform input payloads -------------------------------------
// Tuple types are derived from the wrapped functions via `Parameters<>`
// so the adapter signatures stay in exact lockstep with the source of
// truth (zero drift) WITHOUT forcing new named-type exports onto
// shopify-engine.ts / uniqlo-engine.ts (concurrently-owned, out of scope).

type ShopifyParams = Parameters<typeof parseShopifyProducts>
type UniqloParams = Parameters<typeof parseUniqloProducts>

export interface ShopifyParseInput {
  productsJson: ShopifyParams[0]
  baseUrl: ShopifyParams[1]
  platformKey: ShopifyParams[2]
  /** Optional; omitted -> `parseShopifyProducts` default `{}` (unchanged). */
  options?: ShopifyParams[3]
}

export interface UniqloParseInput {
  json: UniqloParams[0]
  baseUrl: UniqloParams[1]
  platformKey: UniqloParams[2]
  /** Optional; omitted -> `parseProducts` default `"KR"` (unchanged). */
  region?: UniqloParams[3]
}

export interface Cafe24DetailInput {
  /** Site key, exactly as passed to `getDetailParser` today. */
  site: string
  page: Page
  productUrl: string
}

// --- Adapter strategies (verbatim pass-through) ----------------------

/**
 * @MX:NOTE: [AUTO] Byte-identical wrap of `parseShopifyProducts`. Calls it
 * with the same positional args the live `crawlShopify()` inline loop does
 * (option default preserved by passing `undefined` when absent -> the
 * function's `= {}` default fires unchanged). Output equals
 * `parseShopifyProducts(...)` exactly; the Stage-0 golden masters
 * (shopify-parse.golden.json + .krw.golden.json) lock that contract.
 */
export class ShopifyParserStrategy implements Parser<ShopifyParseInput, Product[]> {
  readonly platform = "shopify"

  parse(input: ShopifyParseInput): Product[] {
    return parseShopifyProducts(
      input.productsJson,
      input.baseUrl,
      input.platformKey,
      input.options,
    )
  }
}

/**
 * @MX:NOTE: [AUTO] Byte-identical wrap of uniqlo `parseProducts`. Same
 * positional args the live `crawlUniqlo()` uses; omitted `region` lets the
 * wrapped function's `= "KR"` default fire unchanged. Output equals
 * `parseProducts(...)` exactly; uniqlo-kr-parse.golden.json locks it.
 */
export class UniqloParserStrategy implements Parser<UniqloParseInput, Product[]> {
  readonly platform = "uniqlo"

  parse(input: UniqloParseInput): Product[] {
    return parseUniqloProducts(
      input.json,
      input.baseUrl,
      input.platformKey,
      input.region,
    )
  }
}

/**
 * @MX:NOTE: [AUTO] Thin adapter over the Phase 2 cafe24 detail path. It
 * resolves the per-site `IDetailParser` via `getDetailParser(site)` and
 * calls `.parse(page, url)` — the EXACT two calls (and order) that the
 * live `crawlCafe24()` makes today through src/crawl.ts. cafe24-engine.ts
 * internals are NOT touched: this adapter integrates only via the existing
 * exported `getDetailParser` entry point, so it is collision-free with the
 * concurrently-owned engine. Routing through `getDetailParser` means the
 * shared Phase 2 `field-extractors/` primitives stay the single extraction
 * implementation (no duplication). The 18 detail goldens lock the output.
 */
export class Cafe24DetailParserStrategy
  implements Parser<Cafe24DetailInput, Promise<DetailData>>
{
  readonly platform = "cafe24-detail"

  /** Exposed for tests/diagnostics: the underlying Phase 2 parser for a
   *  site, identical to what `getDetailParser(site)` returns. */
  resolveDetailParser(site: string): IDetailParser {
    return getDetailParser(site)
  }

  parse(input: Cafe24DetailInput): Promise<DetailData> {
    return this.resolveDetailParser(input.site).parse(input.page, input.productUrl)
  }
}

// --- Dependency-injection container -----------------------------------

type AnyParserFactory = () => Parser<unknown, unknown>

/**
 * @MX:ANCHOR: [AUTO] Parser-strategy DI container. Sole resolution seam
 * for crawl-platform parse strategies: `register(key, factory)` +
 * `resolve(key)`. Adding platform #33 = register one strategy here, no
 * dispatch-switch surgery (REQ-CRAWLER-004 extension point).
 * @MX:REASON: fan_in — `defaultParserRegistry` (the shared instance), the
 * three platform registrations, the strategy unit tests, and every future
 * site adapter depend on this class. Unknown-key resolution throws by
 * design (mirrors RegistryDetailParser's explicit-failure contract) so a
 * mis-keyed lookup fails loud, never silently mis-parses.
 * @MX:SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-004
 */
export class ParserRegistry {
  private readonly factories = new Map<string, AnyParserFactory>()

  /** Register (or override) the strategy factory for a platform key. */
  register<I, O>(key: string, factory: () => Parser<I, O>): this {
    this.factories.set(key, factory as AnyParserFactory)
    return this
  }

  has(key: string): boolean {
    return this.factories.has(key)
  }

  keys(): string[] {
    return [...this.factories.keys()]
  }

  /**
   * Resolve a fresh strategy instance for `key`. Throws on unknown key —
   * an unregistered platform must fail loudly, never fall back to a
   * wrong parser (policy A: no silent behavior change).
   */
  resolve<I, O>(key: string): Parser<I, O> {
    const factory = this.factories.get(key)
    if (!factory) {
      throw new Error(
        `ParserRegistry: no strategy registered for platform key "${key}". ` +
          `Registered: [${this.keys().join(", ")}].`,
      )
    }
    return factory() as Parser<I, O>
  }
}

/**
 * Shared container pre-populated with the three live platform strategies.
 * Platform #33 onboarding: `defaultParserRegistry.register("newsite", () =>
 * new NewSiteParserStrategy())` + a selector-registry entry (Phase 2) —
 * no copy-pasted module (REQ-CRAWLER-004).
 */
export const defaultParserRegistry = new ParserRegistry()
  .register("shopify", () => new ShopifyParserStrategy())
  .register("uniqlo", () => new UniqloParserStrategy())
  .register("cafe24-detail", () => new Cafe24DetailParserStrategy())
