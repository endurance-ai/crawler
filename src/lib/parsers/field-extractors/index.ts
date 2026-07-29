/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 — shared detail field-extractors barrel.
 *
 * The shared extraction algorithm that the 18 per-site detail parsers
 * previously duplicated, factored into composable primitives + a per-site
 * strategy dispatch table. Consumed by the single registry-driven parser
 * (../detail/registry-detail-parser.ts).
 */

export {baseMaterialFromDescription} from "./material"
export {baseProductCodeInPage} from "./productCode"
export {STRATEGIES} from "./strategies"
