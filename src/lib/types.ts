/**
 * 크롤러 공통 타입
 */

import type {GenderSource} from "./product-gender"

// ─── 통화 ─────────────────────────────────────────────

/**
 * 수집 대상 사이트에서 실제로 관측된 ISO-4217 코드.
 *
 * 열린 `string` 대신 유니온인 이유는 config 오타를 컴파일 타임에 잡기
 * 위해서다. 새 통화를 만나면 여기에 **추가**하고, 필요하면
 * `CURRENCY_TO_COUNTRY`/`CURRENCY_SYMBOL`(src/lib/fx.ts)에도 넣는다 —
 * 환율 자체는 런타임 테이블에서 오므로 여기 없다고 환산이 막히진 않는다.
 */
export type CurrencyCode =
  | "KRW"
  | "USD"
  | "EUR"
  | "GBP"
  | "JPY"
  | "CNY"
  | "HKD"
  | "TWD"
  | "SGD"
  | "THB"
  | "AUD"
  | "NZD"
  | "CAD"
  | "CHF"
  | "SEK"
  | "DKK"
  | "NOK"
  | "PLN"
  | "EGP"
  | "AED"
  | "INR"
  | "PHP"
  | "VND"
  | "MXN"
  | "BRL"

// ─── 상품 ─────────────────────────────────────────────

export interface Product {
  brand: string
  name: string
  category: string
  /**
   * 성별 태그 (men/women/unisex). 비어 있으면 **적재하지 않는다** —
   * 검색 RPC 가 unisex 를 남녀 양쪽에 노출시키므로 미확인을 unisex 로
   * 세탁하면 여성 상품이 남성 검색에 샌다. src/lib/product-gender.ts 참조.
   */
  gender: string[]
  /** 이 gender 가 어느 근거에서 왔는지 (products.gender_source). */
  genderSource?: GenderSource
  price: number | null
  originalPrice: number | null
  salePrice: number | null
  /**
   * 가격 쌍을 어떤 표면에서 확정했는지 나타내는 캐시 전용 관측 정보.
   *
   * version 2가 없는 과거 캐시는 `salePrice: null`을 "세일 아님"의 근거로
   * 사용할 수 없다. refresh/import가 오래된 파서의 null로 정상 세일가를
   * 지우지 않도록 명시적인 상태를 함께 운반한다.
   */
  pricingObservation?: PricingObservation
  priceFormatted: string
  imageUrl: string
  /** Crawler-provided primary URL before representative-image selection. */
  sourceImageUrl?: string
  productUrl: string
  inStock: boolean
  platform: string
  crawledAt: string
  // ── 상세 페이지 데이터 (Phase 2) ──
  /**
   * 상세 페이지를 실제로 방문해 파싱한 시각 (ISO). 재시작 스킵 마커다.
   *
   * 2026-07-29 이전에는 `color` 가 비어있지 않은지로 "상세 수집 완료"를
   * 판정했는데(crawl.ts loadExistingDetails), color 가 product_features(VLM)
   * 로 이관되면서 그 마커가 사라졌다. 암묵적 마커를 명시적 필드로 교체한다.
   */
  detailFetchedAt?: string
  material?: string
  subcategory?: string
  images?: string[]
  /** Version of the detail-image collector that produced `images`. */
  imageCollectionVersion?: string
  /** Local Apple Vision representative-image selection metadata. */
  imageSelection?: {
    kind: "model" | "product" | "fallback"
    score: number
    version: string
    candidateCount: number
    selectedAt: string
  }
  sizeInfo?: string
  tags?: string[]
  productCode?: string
  /** 원본 통화 ISO 코드 (해외 사이트용, 기본 KRW). price 필드는 KRW 환산값 */
  sourceCurrency?: CurrencyCode
  /** 원본 통화 기준 가격 (환산 전) */
  sourcePrice?: number
  // ── LLM 보강 provenance (src/enrich-products-file.ts) ──
  /**
   * enrichProductWithLlm 이 이 상품을 보강한 시각 (ISO-8601).
   *
   * 재개 마커를 겸한다 — 보강 스크립트는 이 값이 있는 항목을 건너뛰므로,
   * 수천 건짜리 보강이 중간에 죽어도 처음부터 다시 돌지 않는다. DB 적재
   * payload(import-products.ts)는 컬럼을 명시적으로 나열하므로 이 필드는
   * JSON 에만 남고 products 테이블로는 가지 않는다.
   */
  llmEnrichedAt?: string
  /** 보강에 사용된 모델 (배치 간 결과를 비교할 때 필요). */
  llmModel?: string
  /** 보강 입력이 달라졌는지 판정하는 SHA-256 체크포인트. */
  llmInputHash?: string
  // ── 리뷰 데이터 (Phase 3) ──
  reviewCount?: number
  reviews?: Array<{
    text: string
    author: string | null
    date: string | null
    photoUrls: string[]
    body: {
      height: string | null
      weight: string | null
      usualSize: string | null
      purchasedSize: string | null
      bodyType: string | null
    } | null
  }>
}

export interface PricingObservation {
  state: "sale" | "regular" | "unknown"
  source: "variant" | "api" | "listing" | "detail"
  version: 2
}

// ─── 사이트 설정 ──────────────────────────────────────

export type PlatformType =
  | "cafe24"
  | "shopify"
  | "uniqlo"
  | "zara"
  | "farfetch"
  | "imweb"
  | "sixshop"
  | "structured"

export interface Cafe24ListingCursor {
  version: 1
  engine: "cafe24"
  configFingerprint: string
  categoryIndex: number
  page: number
}

export interface Cafe24Selectors {
  /** 상품 리스트 컨테이너 (기본: ul.thumbnail) */
  listContainer?: string
  /** 개별 상품 아이템 (기본: li[id^="anchorBoxId"]) */
  productItem?: string
  /** 상품명 (기본: .name) */
  productName?: string
  /** 가격 (기본: .price) */
  productPrice?: string
  /** 이미지 (기본: img.thumb-img, img) */
  productImage?: string
  /** 상품 링크 (기본: a[href*="product"]) */
  productLink?: string
}

export interface Cafe24DetailSelectors {
  /** 이미지 (기본: .product-detail img) */
  detailImages?: string
  /** 상품 코드 */
  productCode?: string
}

export interface CategoryConfig {
  /** 카테고리 자동 탐색 방식 */
  discovery: "auto" | "manual"
  /**
   * manual일 때: 고정 카테고리 번호 목록
   * auto일 때: 카테고리 링크를 찾을 CSS 셀렉터 (기본: a[href*="cate_no="])
   */
  categories?: { name: string; cateNo: number; gender?: string[]; url?: string }[]
  /** auto 탐색 시 시작 URL (기본: baseUrl) */
  discoveryUrl?: string
  /** auto 탐색 시 카테고리 링크 셀렉터 */
  discoverySelector?: string
  /** 무시할 카테고리명 패턴 */
  ignorePatterns?: string[]
}

export interface SiteConfig {
  /** 고유 키 (파일명, DB platform 필드에 사용) */
  key: string
  /** 플랫폼 한글명 */
  name: string
  /** 플랫폼 타입 */
  type: PlatformType
  /** 사이트 기본 URL */
  baseUrl: string
  /** 단일브랜드 자사몰의 하우스 브랜드명 (DOM에서 브랜드 추출 실패 시 폴백) */
  brand?: string
  /**
   * 멀티브랜드 편집샵 표시. 상품마다 브랜드가 다르며 상품명에 "[BRAND] 제품명"
   * 형태로 박혀 있는 편집샵(예: 8division, visualaid). true 이면:
   *  - 브랜드를 플랫폼명(config.name)으로 폴백하지 않는다(platform-as-brand 오염 방지).
   *  - 온보딩 LLM 분류가 상품별 실제 브랜드를 추출하고, import 는 --no-new-brands 로
   *    기존 KR brand_nodes 에 매칭되는 상품만 적재한다(해외 브랜드 자동 제외).
   * 직접 크롤(Path A)이 아니라 온보딩 파이프라인(Path B)으로 수집해야 한다.
   */
  multiBrand?: boolean
  /**
   * 상품명이 "[BRAND] 제품명" 형식인 편집샵에서 브랜드를 상품명 프리픽스로 추출한다.
   * `multiBrand` 와 함께 켜는 것이 정상 조합 — DOM 브랜드 추출이 아무것도 못 주워
   * 후보가 전량 brand_unmatched 로 파킹되는 것을 막는다(havati 실측 1,669건).
   */
  brandFromNamePrefix?: boolean
  /**
   * 사이트 전역 기본 성별. 상품 단위 근거(engine/url/text)가 전혀 없을 때만
   * 쓰이는 최후 폴백이며 `genderSource: "config_default"` 로 기록된다.
   * 하우스브랜드 자사몰(멘즈웨어 전문 등)에서 URL·상품명에 성별 신호가 없어
   * 상품이 전량 드랍되는 것을 막는 장치다.
   */
  defaultGender?: string[]
  /**
   * 공식 사이트에서 전 상품군의 남녀공용 범위를 확인한 경우에만 켠다.
   * 일반적인 `defaultGender: ["unisex"]`는 미확인을 공용으로 세탁할 수 있어
   * 결의 단계에서 버리지만, 이 플래그가 있으면 검증된 사이트 기본값으로 허용한다.
   */
  verifiedUnisexDefault?: boolean
  /**
   * Trust an explicitly verified site category over conflicting product-name
   * heuristics. Canonical category folding still applies.
   */
  trustedCategory?: boolean
  /** Shopify의 사이트별 구조화 성별 부서 태그 prefix. */
  genderDepartmentTagPrefixes?: {men: string[]; women: string[]; unisex?: string[]}
  /**
   * Shopify 공식 성별 컬렉션 handle. `/products.json`이 컬렉션 정보를 주지
   * 않는 사이트에서 컬렉션별 products endpoint를 함께 읽어 상품 단위 성별
   * 근거로 사용한다. 공식몰에서 직접 확인한 handle만 등록한다.
   */
  shopifyGenderCollections?: {men?: string[]; women?: string[]; unisex?: string[]}
  /** Shopify tags that identify product families outside the supported adult taxonomy. */
  shopifyExcludedTags?: string[]
  /** Exact Shopify product handles for non-merchandise records such as shipping add-ons. */
  shopifyExcludedHandles?: string[]
  /** 공식몰에서 검증한 사이트별 상품명/카테고리 성별 표기. */
  genderTextPatterns?: {men?: RegExp[]; women?: RegExp[]; unisex?: RegExp[]}
  /**
   * Cafe24 목록의 남녀 부서가 서로 중복될 때 category 파라미터를 제거한 상세의
   * 공식 카테고리 계층으로 성별을 최종 확정한다.
   */
  cafe24CanonicalDetailGender?: boolean
  /** Shopify 상품 설명의 명시적 Male:/Female: 모델 라벨을 성별 근거로 사용한다. */
  genderFromModelDescription?: boolean
  /** kids 가드에서만 제거할 사이트별 캠페인명/색상명 노이즈. */
  kidsGenderNoisePatterns?: RegExp[]
  /** Cafe24 셀렉터 오버라이드 */
  selectors?: Cafe24Selectors
  /** Cafe24 목록의 품절 표시가 부정확한 사이트에서 상세 옵션 재고로 최종 판정한다. */
  verifyStockFromDetail?: boolean
  /** 카테고리 탐색 설정 */
  category?: CategoryConfig
  /** 단일 상품군 스토어에서 목록이 카테고리명을 제공하지 않을 때 쓰는 검증된 기본 대분류. */
  defaultCategory?: string
  /** 단일 상품군 스토어에서 공식 상세로 검증한 기본 소분류. */
  defaultSubcategory?: string
  /** 가격 파싱 정규식 (기본: /[\d,]+/ — KRW, ₩, 숫자만 등 다양한 포맷 대응) */
  pricePattern?: RegExp
  /** 가격 통화 접두사 (기본: ₩) */
  priceCurrency?: string
  /** 페이지네이션 지원 여부 */
  paginate?: boolean
  /** 최대 페이지 수 (기본: 10) */
  maxPages?: number
  /**
   * 원본 통화. 미지정 시 KRW로 간주 (Shopify/해외 멀티샵 Cafe24 등).
   *
   * Shopify 사이트는 이 값이 `?country=` 마켓 선택까지 좌우한다 —
   * `CURRENCY_TO_COUNTRY[sourceCurrency]` 가 크롤 대상 마켓이므로, 한국
   * 마켓을 지원하는 스토어는 KRW 로 두어야 현지 원화가를 그대로 받는다.
   * 실제 통화는 크롤 시점에 재검증되며(`detectShopifyActiveCurrency`),
   * 스토어가 이 통화를 내주지 않으면 관측된 통화로 덮어쓴다.
   */
  sourceCurrency?: CurrencyCode
  /** 요청 간 딜레이 ms (기본: 2000) */
  crawlDelay?: number
  /**
   * Uniqlo-specific: list of category `path` query values consumed by
   * `crawlUniqlo` against `/kr/api/commerce/v5/ko/products`. Each entry is
   * a 4-position comma-separated string `<L1>,<L2>,<L3>,<L4>` (gender,
   * class, category, subcategory). URL-encoding is handled by the engine.
   * Only consumed when `type === "uniqlo"`.
   */
  apiCategoryPaths?: string[]
  /**
   * Region selector for engines that ship a single shared module across
   * multiple storefronts. Drives engine-specific dials (API path, locale,
   * timezone, source currency, price-formatter symbol). Defaults to "KR"
   * for backward compat if absent. Consumed when `type === "uniqlo"`
   * (SPEC-PLATFORM-EXPANSION-002) and when `type === "zara"`
   * (SPEC-PLATFORM-EXPANSION-005); ignored for other platform types.
   * SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-002, SPEC-PLATFORM-EXPANSION-005 REQ-002
   */
  region?: "KR" | "US"
  /**
   * ZARA-specific: full category landing-page URLs (including the
   * `/kr/ko/...-lNNN.html` slug). The engine navigates to each URL,
   * intercepts the AJAX `/category/{id}/products?ajax=true` response,
   * and parses the embedded product JSON. Only consumed when
   * `type === "zara"`.
   * SPEC: SPEC-PLATFORM-EXPANSION-003 REQ-001
   *
   * Also consumed when `type === "imweb"` (custom-brand pilot, 2026-07):
   * full category page URLs to crawl. When absent the imweb engine
   * auto-discovers categories by visiting nav links and keeping pages
   * that render `.shop-item` widgets.
   */
  categoryUrls?: string[]
  /** Sixshop storefront product URL prefix; older themes use /product, newer themes /products. */
  sixshopProductPath?: "product" | "products"
  /** 비활성화 */
  disabled?: boolean
  /** 메모 */
  notes?: string
  /** Cafe24 상세 페이지 셀렉터 오버라이드 */
  detailSelectors?: Cafe24DetailSelectors
  /**
   * 상세 페이지 크롤링 활성화.
   *
   * cafe24/imweb 엔진에서는 **미설정이 곧 켬**이고, 끄려면 명시적 `false` 를
   * 넣어야 한다. 리스트 페이지가 주는 이미지는 상품당 썸네일 1장뿐이고
   * 갤러리는 PDP 에만 있어서, 꺼두면 대표컷 선별에 쓸 후보가 없다.
   * 그 외 엔진(shopify 등)은 리스트 응답에 이미지 배열이 이미 들어 있어
   * 이 값을 보지 않는다.
   */
  crawlDetails?: boolean
  /** 리뷰 크롤링 활성화 (기본: false, crawlDetails가 true일 때만 동작) */
  crawlReviews?: boolean
}

// ─── 크롤 결과 ────────────────────────────────────────

export interface CrawlResult {
  platform: string
  products: Product[]
  stats: {
    totalProducts: number
    inStock: number
    outOfStock: number
    uniqueBrands: number
    avgPrice: number
    duration: number
    // ── 성능 계측 (선택) — 엔진이 채우지 않으면 undefined ──
    /** 리스트 아이템 셀렉터 대기에 쓴 누적 시간(ms). */
    listWaitMs?: number
    /** 상세 크롤 단계 전체 wall-time(ms). */
    detailMs?: number
    /** 상세 페이지 내비게이션 시도 횟수(증분 크롤이 제거할 대상 비용). */
    detailNavCount?: number
    /** Product cards seen again through another category in this slice. */
    duplicateProductObservations?: number
    /** Number of configured/discovered categories completed in this slice. */
    categoriesCompleted?: number
  }
  /** Present only when a listing slice stopped cleanly at a page boundary. */
  continuation?: Cafe24ListingCursor
  /** 크롤이 실패했거나 불완전하다는 신호 — 엔진/네트워크 오류. */
  errors: string[]
  /**
   * 크롤은 온전히 됐지만 **수집된 내용의 품질**이 낮다는 신호
   * (예: `price_missing_rate=100`, `generic_name_rate`).
   *
   * `errors` 와 분리한 이유: 갱신 경로의 완전성 가드는 "리스트가 끝까지 열렸는가"만
   * 봐야 하는데, 품질 경고가 `errors` 에 섞이면서 **가격을 못 읽는 것이 재고 이탈
   * 감지까지 막고** 런을 failed 로 만들어 성공 이력이 영구히 안 쌓였다
   * (실측 2026-07-30: 42개 소스가 이 경로로 갱신 불가 상태였다).
   * 온보딩(`crawl.ts`)은 품질 실패를 계속 qc_failed 로 봐야 하므로 그쪽에서는
   * `errors` 와 함께 판정한다.
   */
  qualityWarnings?: string[]
  /**
   * 사이트에 **닿지 못했다**는 신호 — 재시도까지 소진한 내비게이션 실패.
   *
   * `errors` 와 또 분리하는 이유는 `qualityWarnings` 를 분리했던 것과 같다.
   * 이건 사이트나 파서의 문제가 아니라 **우리 쪽 네트워크** 문제일 수 있는데
   * (실측 2026-08-02: curl 은 1초에 200, Playwright 만 60초 타임아웃, 호스트
   * DNS 실패율 20%), `errors` 에 넣으면 런이 failed 로 남아 백오프 사다리를
   * 타고 멀쩡한 소스가 최대 14일까지 워크리스트에서 사라진다.
   *
   * 완전성 가드는 `errors` 와 똑같이 취급해야 한다 — 리스트가 안 열렸으면
   * 사라진 상품을 품절 처리하면 안 된다. 다르게 취급하는 곳은 백오프뿐이다.
   */
  unreachable?: string[]
}
