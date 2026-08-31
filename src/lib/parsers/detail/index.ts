/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 (REQ-CRAWLER-003) — detail parser routing.
 *
 * The 18 Cafe24-family SPEC sites now route through ONE implementation
 * (RegistryDetailParser) + 18 declarative registry entries
 * (./selector-registry.ts) instead of 18 copy-paste modules.
 *
 * The original 18 *-parser.ts modules are kept on disk for rollback
 * safety (SPEC Acceptance "롤백 전략"); they are no longer imported here.
 * Their named-class exports below are preserved as registry-backed shims
 * so existing call sites (and the frozen characterization test, which
 * imports the classes by name) drive the registry implementation.
 *
 * triplestore-parser.ts is NOT a SPEC site — it keeps its own original
 * parser and is left fully untouched. BaseDetailParser remains exported
 * unchanged as the unknown-site fallback.
 */

export type {DetailData, IDetailParser} from "./types"
export {BaseDetailParser} from "./base-detail-parser"
export {TriplestoreDetailParser} from "./triplestore-parser"
export {RegistryDetailParser} from "./registry-detail-parser"

import type {IDetailParser} from "./types"
import {BaseDetailParser} from "./base-detail-parser"
import {RegistryDetailParser} from "./registry-detail-parser"

// Registry-backed shims. Each preserves the original exported class name
// (call sites + frozen characterization test depend on these names) but
// delegates to the single registry-driven parser with its site key baked
// in. The 18 original *-parser.ts files remain on disk, unreferenced.
export class BlankroomDetailParser extends RegistryDetailParser {
  constructor() {
    super("blankroom")
  }
}
export class VisualalidDetailParser extends RegistryDetailParser {
  constructor() {
    super("visualaid")
  }
}
export class AdekuverDetailParser extends RegistryDetailParser {
  constructor() {
    super("adekuver")
  }
}
export class SwallowloungeDetailParser extends RegistryDetailParser {
  constructor() {
    super("swallowlounge")
  }
}
export class RoughsideDetailParser extends RegistryDetailParser {
  constructor() {
    super("roughside")
  }
}
export class SculpstoreDetailParser extends RegistryDetailParser {
  constructor() {
    super("sculpstore")
  }
}
export class Fr8ightDetailParser extends RegistryDetailParser {
  constructor() {
    super("fr8ight")
  }
}
export class EtcseoulDetailParser extends RegistryDetailParser {
  constructor() {
    super("etcseoul")
  }
}
export class HavatiDetailParser extends RegistryDetailParser {
  constructor() {
    super("havati")
  }
}
export class EightDivisionDetailParser extends RegistryDetailParser {
  constructor() {
    super("8division")
  }
}
export class SlowsteadyclubDetailParser extends RegistryDetailParser {
  constructor() {
    super("slowsteadyclub")
  }
}
export class TakeastreetDetailParser extends RegistryDetailParser {
  constructor() {
    super("takeastreet")
  }
}
export class AnotherofficeDetailParser extends RegistryDetailParser {
  constructor() {
    super("anotheroffice")
  }
}
export class EastlogueDetailParser extends RegistryDetailParser {
  constructor() {
    super("eastlogue")
  }
}
export class ChanceclothingDetailParser extends RegistryDetailParser {
  constructor() {
    super("chanceclothing")
  }
}
export class ShopamomentoDetailParser extends RegistryDetailParser {
  constructor() {
    super("shopamomento")
  }
}
export class BastongDetailParser extends RegistryDetailParser {
  constructor() {
    super("bastong")
  }
}
export class SienneboutiqueDetailParser extends RegistryDetailParser {
  constructor() {
    super("sienneboutique")
  }
}
export class OjosDetailParser extends RegistryDetailParser {
  constructor() {
    super("ojos")
  }
}
export class GoyowearDetailParser extends RegistryDetailParser {
  constructor() {
    super("goyowear")
  }
}
export class TaatsDetailParser extends RegistryDetailParser {
  constructor() {
    super("taats")
  }
}

// EMIS keeps its textual product details in the first accordion panel. The
// generic Cafe24 selectors only see image/spec containers on this theme.
class EmisDetailParser extends BaseDetailParser {
  protected descriptionSelectors = [".accordion-list:first-child .accordion-content"]
}

import {TriplestoreDetailParser} from "./triplestore-parser"

const DETAIL_PARSERS: Record<string, () => IDetailParser> = {
  blankroom: () => new BlankroomDetailParser(),
  visualaid: () => new VisualalidDetailParser(),
  adekuver: () => new AdekuverDetailParser(),
  swallowlounge: () => new SwallowloungeDetailParser(),
  roughside: () => new RoughsideDetailParser(),
  sculpstore: () => new SculpstoreDetailParser(),
  fr8ight: () => new Fr8ightDetailParser(),
  etcseoul: () => new EtcseoulDetailParser(),
  havati: () => new HavatiDetailParser(),
  "8division": () => new EightDivisionDetailParser(),
  slowsteadyclub: () => new SlowsteadyclubDetailParser(),
  takeastreet: () => new TakeastreetDetailParser(),
  triplestore: () => new TriplestoreDetailParser(),
  anotheroffice: () => new AnotherofficeDetailParser(),
  eastlogue: () => new EastlogueDetailParser(),
  chanceclothing: () => new ChanceclothingDetailParser(),
  shopamomento: () => new ShopamomentoDetailParser(),
  bastong: () => new BastongDetailParser(),
  sienneboutique: () => new SienneboutiqueDetailParser(),
  ojos: () => new OjosDetailParser(),
  goyowear: () => new GoyowearDetailParser(),
  taats: () => new TaatsDetailParser(),
  emis: () => new EmisDetailParser(),
}

export function getDetailParser(platformKey: string): IDetailParser {
  const factory = DETAIL_PARSERS[platformKey]
  return factory ? factory() : new BaseDetailParser()
}
