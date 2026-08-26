/**
 * 크롤링 대상 플랫폼 설정
 *
 * 새 사이트 추가: 이 배열에 SiteConfig 객체만 추가하면 됨
 * Cafe24 사이트는 대부분 기본 셀렉터로 동작 — 안 되면 selectors 오버라이드
 */

import type {SiteConfig} from "../lib/types"
import type {ProductGender} from "../lib/product-gender"
import {SITE_GENDER_DEFAULTS} from "./gender-defaults"
import {GENERATED_PLATFORMS} from "./platforms.generated"

export const MANUAL_PLATFORMS: SiteConfig[] = [
  {
    key: "humanity",
    name: "999HUMANITY",
    type: "cafe24",
    baseUrl: "https://999humanity.kr",
    brand: "999HUMANITY",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 상세 페이지의 원본 상품 부서 선택값. VIEW ALL(43/49)의 상위 루트다.
        {name: "MEN ROOT", cateNo: 42, gender: ["men"]},
        {name: "MEN", cateNo: 43, gender: ["men"]},
        {name: "MEN OUTER", cateNo: 45, gender: ["men"]},
        {name: "MEN TOP", cateNo: 59, gender: ["men"]},
        {name: "MEN T-SHIRTS", cateNo: 245, gender: ["men"]},
        {name: "MEN PANTS", cateNo: 47, gender: ["men"]},
        {name: "MEN BAGS", cateNo: 180, gender: ["men"]},
        {name: "MEN ACC", cateNo: 66, gender: ["men"]},
        {name: "WOMEN ROOT", cateNo: 23, gender: ["women"]},
        {name: "WOMEN", cateNo: 49, gender: ["women"]},
        {name: "WOMEN OUTER", cateNo: 55, gender: ["women"]},
        {name: "WOMEN TOP", cateNo: 51, gender: ["women"]},
        {name: "WOMEN T-SHIRTS", cateNo: 244, gender: ["women"]},
        {name: "WOMEN PANTS", cateNo: 52, gender: ["women"]},
        {name: "WOMEN SKIRTS", cateNo: 243, gender: ["women"]},
        {name: "WOMEN BAGS", cateNo: 67, gender: ["women"]},
        {name: "WOMEN ACC", cateNo: 69, gender: ["women"]},
      ],
    },
    notes: "공식 SHOP의 MEN/WOMEN VIEW ALL 상위 목록을 상품 성별 근거로 사용한다.",
  },
  {
    key: "en-1111",
    name: "COOR",
    type: "cafe24",
    baseUrl: "https://en.coor.kr",
    brand: "COOR",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "MEN", cateNo: 75, gender: ["men"], url: "/category/men/75/"},
        {name: "MEN NEW", cateNo: 94, gender: ["men"]},
        {name: "MEN OUTER", cateNo: 95, gender: ["men"]},
        {name: "MEN KNITWEAR", cateNo: 76, gender: ["men"]},
        {name: "MEN TOPS", cateNo: 78, gender: ["men"]},
        {name: "MEN TROUSERS", cateNo: 79, gender: ["men"]},
        {name: "MEN JEANS", cateNo: 80, gender: ["men"]},
        {name: "MEN BAGS", cateNo: 81, gender: ["men"]},
        {name: "MEN SHOES", cateNo: 82, gender: ["men"]},
        {name: "MEN ACCESSORIES", cateNo: 83, gender: ["men"]},
        {name: "WOMEN", cateNo: 74, gender: ["women"], url: "/category/women/74/"},
        {name: "WOMEN NEW", cateNo: 93, gender: ["women"]},
        {name: "WOMEN OUTER", cateNo: 92, gender: ["women"]},
        {name: "WOMEN KNITWEAR", cateNo: 84, gender: ["women"]},
        {name: "WOMEN TOPS", cateNo: 85, gender: ["women"]},
        {name: "WOMEN TROUSERS", cateNo: 86, gender: ["women"]},
        {name: "WOMEN JEANS", cateNo: 87, gender: ["women"]},
        {name: "WOMEN SKIRTS", cateNo: 102, gender: ["women"]},
        {name: "WOMEN BAGS", cateNo: 88, gender: ["women"]},
        {name: "WOMEN SHOES", cateNo: 98, gender: ["women"]},
        {name: "WOMEN ACCESSORIES", cateNo: 97, gender: ["women"]},
        // 공식 BLACK FRIDAY 트리에서 ALL/할인율 부서는 남성 상품군이고,
        // WOMEN은 182로 별도 분리된다.
        {name: "MEN BLACK FRIDAY ALL", cateNo: 186, gender: ["men"]},
        {name: "MEN BLACK FRIDAY 40%", cateNo: 178, gender: ["men"]},
        {name: "MEN BLACK FRIDAY 30%", cateNo: 179, gender: ["men"]},
        {name: "MEN BLACK FRIDAY 10%", cateNo: 181, gender: ["men"]},
        {name: "WOMEN BLACK FRIDAY", cateNo: 182, gender: ["women"]},
      ],
    },
    notes: "공식 MEN/WOMEN 상위 목록과 캠페인·룩북의 양쪽 전개를 상품 단위로 보존한다.",
  },
  {
    key: "erer",
    name: "ERER (에르에르)",
    type: "cafe24",
    baseUrl: "https://erer.kr",
    brand: "ERER (에르에르)",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    cafe24CanonicalDetailGender: true,
    genderTextPatterns: {unisex: [/^\[UN\]/i]},
    category: {
      discovery: "manual",
      categories: [
        {name: "WOMEN", cateNo: 118, gender: ["women"]},
        {name: "MEN", cateNo: 119, gender: ["men"]},
      ],
    },
    notes: "brand_node id=5412. WOMEN/MEN 목록 중복은 상세의 canonical 카테고리 계층으로 확정하며 [UN] 표기만 공용으로 처리한다.",
  },
  {
    key: "tape00",
    name: "0Tape",
    type: "cafe24",
    baseUrl: "https://tape00.cafe24.com",
    brand: "0Tape",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "ALL", cateNo: 56, gender: ["women"]}],
    },
    notes: "brand_node id=2149. 공식 현행 카탈로그의 스커트·여성 슬리브리스와 여성 모델 착용 근거로 women; 과거 8DIVISION 유래 unisex 기본값 폐기.",
  },
  {
    key: "noirer",
    name: "NOIRER",
    type: "cafe24",
    baseUrl: "https://noirer.com",
    brand: "NOIRER",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "MEN", cateNo: 76, gender: ["men"]},
        {name: "MEN NEW ARRIVALS", cateNo: 202, gender: ["men"]},
        {name: "FINAL SALE MEN", cateNo: 321, gender: ["men"]},
        // 현재 공식 PRE-ORDER 상품은 모두 NOIRER 남성 라인의 48/50/52 사이즈다.
        {name: "MEN PRE-ORDER", cateNo: 341, gender: ["men"]},
        {name: "WOMEN", cateNo: 180, gender: ["women"]},
        {name: "FINAL SALE WOMEN", cateNo: 326, gender: ["women"]},
      ],
    },
    notes: "brand_node id=5230. 브랜드는 MEN/WOMEN 혼성(unisex)이나 상품은 공식 부서 카테고리별로 분류한다.",
  },
  {
    key: "jinochio",
    name: "jinochio",
    type: "cafe24",
    baseUrl: "https://jinochio.com",
    brand: "jinochio",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    genderTextPatterns: {
      women: [/\(w\)/i],
      unisex: [/\(uni\)/i],
    },
    category: {
      discovery: "manual",
      categories: [{name: "New 홈웨어", cateNo: 176}],
    },
    notes: "brand_node id=5472. 침구는 제외하고 공식 신상품 홈웨어에서 상품명 (w)/(uni) 표기가 있는 패션 상품만 보존.",
  },
  {
    key: "fritt",
    name: "FRITT (프릿)",
    type: "cafe24",
    baseUrl: "https://fritt.co.kr",
    brand: "FRITT (프릿)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    genderTextPatterns: {
      men: [/남자\s*모델/i],
      women: [/여자\s*모델/i],
    },
    category: {
      discovery: "manual",
      categories: [{name: "그녀를 위한 기프트", cateNo: 156, gender: ["women"]}],
    },
    notes: "brand_node id=5348. 공식몰의 '그녀를 위한 기프트' 카테고리만 여성 근거로 사용하며, 커플 주얼리 등 다른 상품은 브랜드 단위로 추정하지 않음.",
  },
  {
    key: "ensundayceremony",
    name: "SUNDAY CEREMONY",
    type: "cafe24",
    baseUrl: "https://en.sunday-ceremony.com",
    brand: "SUNDAY CEREMONY",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    genderTextPatterns: {
      men: [/\(M\)(?:\s|$)/i],
      women: [/\(W\)(?:\s|$)/i],
    },
    category: {
      discovery: "manual",
      categories: [{name: "All", cateNo: 29}],
    },
    notes: "brand_node id=5561. 공식 All 상품명의 (M)/(W) 성별 표기를 상품 단위로 보존하며 무표기 액세서리는 추정하지 않음.",
  },
  {
    key: "sculptorpage",
    name: "SCULPTOR",
    type: "cafe24",
    baseUrl: "https://sculptorpage.com",
    brand: "SCULPTOR",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "All", cateNo: 1532, gender: ["women"]}],
    },
    notes: "brand_node id=834. 공식 상세 전반의 Female Model 치수·착용 사이즈와 여성 전용 의류를 검증; 1532가 전체 상품 목록.",
  },
  {
    key: "noscouleurs",
    name: "NOS COULEURS (노쿨러스)",
    type: "cafe24",
    baseUrl: "https://noscouleurs.com",
    brand: "NOS COULEURS (노쿨러스)",
    defaultGender: ["unisex"],
    verifiedUnisexDefault: true,
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 24, gender: ["unisex"]},
        {name: "Tops", cateNo: 25, gender: ["unisex"]},
        {name: "Bottoms", cateNo: 27, gender: ["unisex"]},
        {name: "Accessories", cateNo: 28, gender: ["unisex"]},
      ],
    },
    notes: "brand_node id=5433. 공식 All=42 현행 목록과 상세의 여성·남성 모델별 착용 사이즈를 공용 근거로 검증.",
  },
  {
    key: "kijiko",
    name: "KIJIKO",
    type: "cafe24",
    baseUrl: "https://kijiko.co.kr",
    brand: "KIJIKO",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: false,
    selectors: {
      productItem: 'li[id^="anchorBoxId_"]',
      // 메인 위젯은 설명/가격 블록 없이 상품 이미지 alt에만 상품명을 둔다.
      productName: 'img[id^="eListPrdImage"]',
      productImage: 'img[id^="eListPrdImage"]',
      productLink: 'a[href*="/product/"]',
    },
    category: {
      discovery: "manual",
      categories: [{name: "SHOP", cateNo: 1, gender: ["women"], url: "/"}],
    },
    notes: "brand_node id=5620. 공식몰 여성 카탈로그 메뉴(TOP/SKIRT/DRESS/OUTER/BOTTOM)와 메인 상품 피드 검증.",
  },
  {
    key: "royaloakseoul",
    name: "ROYAL OAK",
    type: "cafe24",
    baseUrl: "https://royaloakseoul.com",
    brand: "ROYAL OAK",
    defaultGender: ["women"],
    kidsGenderNoisePatterns: [/\bbaby[-\s]+wave\b/gi],
    paginate: true,
    maxPages: 100,
    category: {
      discovery: "manual",
      categories: [
        {name: "All", cateNo: 24},
      ],
    },
    notes: "brand_node id=5691. 공식 All 카탈로그(비키니/보디수트/스커트/드레스)와 상세의 여성 한국 사이즈 44/55 표기를 검증.",
  },
  {
    key: "sideservice",
    name: "SIDE",
    type: "cafe24",
    baseUrl: "https://sideservice.store",
    brand: "SIDE",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "ALL", cateNo: 1, url: "/shop/all.html"}],
    },
    notes: "brand_node id=5400. 공식 전체 목록과 상세 재수집으로 활성 상품·가격·성별 근거 검증.",
  },
  {
    key: "cacele",
    name: "CACELE",
    type: "cafe24",
    baseUrl: "https://ca-cele.com",
    brand: "CACELE",
    defaultGender: ["women"],
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    selectors: {
      productItem: 'li[id^="anchorBoxId_"]',
      productName: ".product-info .product-text.mb-2 span",
      productPrice: ".product-info .cacele-format-currency",
      productImage: 'img[id^="eListPrdImage"]',
      productLink: 'a[href*="/product/"]',
    },
    category: {
      discovery: "manual",
      categories: [
        {name: "OUTERWEAR", cateNo: 52, gender: ["women"]},
        {name: "all", cateNo: 53, gender: ["women"]},
        {name: "BOTTOM", cateNo: 54, gender: ["women"]},
        {name: "DRESS", cateNo: 55, gender: ["women"]},
        {name: "ACC", cateNo: 56, gender: ["women"]},
      ],
    },
    notes: "brand_node id=5687. Official About identifies CACELE as a women's clothing brand.",
  },
  {
    key: "liha",
    name: "LIHA",
    type: "shopify",
    baseUrl: "https://lihabeauty.com",
    brand: "LIHA",
    defaultGender: ["unisex"],
    verifiedUnisexDefault: true,
    defaultCategory: "other",
    sourceCurrency: "GBP",
    maxPages: 20,
    crawlDelay: 1000,
    notes: "brand_node id=4877. Official LIHA journal states all products are designed for all genders; cart.js reports GBP.",
  },
  {
    key: "tatras-official",
    name: "TATRAS",
    type: "shopify",
    baseUrl: "https://tatras-official.com",
    brand: "TATRAS",
    shopifyGenderCollections: {
      men: ["all-products-men"],
      women: ["all-products-women"],
    },
    shopifyExcludedTags: ["KIDS"],
    sourceCurrency: "EUR",
    maxPages: 20,
    crawlDelay: 1000,
    notes: "brand_node id=5703. Official All Products MEN/WOMEN Shopify collections provide product-level gender evidence; cart.js reports EUR.",
  },
  {
    key: "canton-collective",
    name: "Canton Collective",
    type: "shopify",
    baseUrl: "https://cantoncollective.com",
    multiBrand: true,
    defaultGender: ["women"],
    kidsGenderNoisePatterns: [
      /\bbaby[-\s]?tee\b/gi,
      /\bbaby[-\s]?doll\b/gi,
      /\bbabydoll\b/gi,
    ],
    shopifyExcludedHandles: ["canton-collective-express"],
    sourceCurrency: "USD",
    maxPages: 20,
    crawlDelay: 1000,
    notes: "brand_node id=5611. Official storefront identifies itself as a women's fashion multi-brand curation platform; preserve Shopify vendor as product brand. cart.js reports USD.",
  },
  // ─── Manual 설정 완료 (카테고리 구조 깔끔) ─────────

  {
    key: "bmuettestore",
    name: "BMUET(TE)",
    type: "cafe24",
    baseUrl: "https://bmuettestore.com",
    brand: "BMUET(TE)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "WOMEN", cateNo: 112, gender: ["women"]},
        {name: "MEN", cateNo: 113, gender: ["men"]},
      ],
    },
    notes: "Official storefront gender departments verified: WOMEN /category/women/112, MEN /category/men/113.",
  },
  {
    key: "shopamomento",
    name: "샵아모멘토",
    type: "cafe24",
    baseUrl: "https://shopamomento.com",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    pricePattern: /KRW\s*([\d,]+)/,
    priceCurrency: "₩",
    category: {
      discovery: "manual",
      categories: [
        // Women
        {name: "Outer", cateNo: 450, gender: ["women"]},
        {name: "Top", cateNo: 451, gender: ["women"]},
        {name: "Knitwear", cateNo: 689, gender: ["women"]},
        {name: "Bottom", cateNo: 460, gender: ["women"]},
        {name: "Dress", cateNo: 465, gender: ["women"]},
        {name: "Shoes", cateNo: 466, gender: ["women"]},
        {name: "Bag", cateNo: 467, gender: ["women"]},
        {name: "Accessories", cateNo: 469, gender: ["women"]},
        // Men
        {name: "Outer", cateNo: 490, gender: ["men"]},
        {name: "Top", cateNo: 491, gender: ["men"]},
        {name: "Shirts", cateNo: 493, gender: ["men"]},
        {name: "Knitwear", cateNo: 693, gender: ["men"]},
        {name: "Bottom", cateNo: 501, gender: ["men"]},
        {name: "Shoes", cateNo: 505, gender: ["men"]},
        {name: "Bag", cateNo: 544, gender: ["men"]},
        {name: "Accessories", cateNo: 507, gender: ["men"]},
      ],
    },
    notes: "Women 8 + Men 8 = 16개 카테고리",
  },
  {
    key: "slowsteadyclub",
    name: "슬로우스테디클럽",
    type: "cafe24",
    baseUrl: "https://slowsteadyclub.com",
    disabled: true, // 재고 파서 미스(전량 품절 오판) — 패치 전까지 크롤 제외
    paginate: true,
    maxPages: 300,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 683, gender: ["unisex"]},
        {name: "Top", cateNo: 742, gender: ["unisex"]},
        {name: "Knitwear", cateNo: 1020, gender: ["unisex"]},
        {name: "Bottom", cateNo: 755, gender: ["unisex"]},
        {name: "Shoes", cateNo: 783, gender: ["unisex"]},
        {name: "Bag", cateNo: 1341, gender: ["unisex"]},
        {name: "Accessories", cateNo: 798, gender: ["unisex"]},
      ],
    },
    notes: "unisex 편집샵. 7개 카테고리",
  },
  {
    key: "adekuver",
    name: "아데쿠베",
    type: "cafe24",
    baseUrl: "https://adekuver.com",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // Women
        {name: "Outer", cateNo: 121, gender: ["women"]},
        {name: "Top", cateNo: 119, gender: ["women"]},
        {name: "Bottom", cateNo: 118, gender: ["women"]},
        {name: "Dress", cateNo: 123, gender: ["women"]},
        {name: "Bag", cateNo: 117, gender: ["women"]},
        {name: "Shoes", cateNo: 120, gender: ["women"]},
        {name: "Accessories", cateNo: 116, gender: ["women"]},
        // Men
        {name: "Outer", cateNo: 115, gender: ["men"]},
        {name: "Top", cateNo: 113, gender: ["men"]},
        {name: "Bottom", cateNo: 112, gender: ["men"]},
        {name: "Bag", cateNo: 111, gender: ["men"]},
        {name: "Shoes", cateNo: 114, gender: ["men"]},
        {name: "Accessories", cateNo: 110, gender: ["men"]},
      ],
    },
    notes: "도산공원 편집샵. Women 7 + Men 6 = 13개 카테고리",
  },
  {
    key: "etcseoul",
    name: "이티씨서울",
    type: "cafe24",
    baseUrl: "https://etcseoul.com",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 2026-08-25 정정: 원래 10개 전부 gender: ["unisex"] 였다. **틀렸다** —
        // etcseoul.com 내비게이션에는 성별 부서가 아예 없다(품목 + 브랜드 축만
        // 있다). "성별 구분이 없다"는 unisex 의 근거가 아니라 "모름"이고,
        // 검색 RPC 가 unisex 를 남녀 양쪽에 노출하므로 그대로 두면 남성복이
        // 여성 결과로 샌다(실측: `킨_ MEN'S JASPER [SILVER MINK]` 가 상품명에
        // MEN'S 를 달고도 unisex 로 적재돼 여성 검색에 노출). 같은 파일의
        // 8division 처리와 동일하게 성별을 채우지 않는다 — 상품 단위 근거
        // (상품명 MEN'S/WOMEN'S 표기)가 있으면 그쪽이 쓰인다.
        {name: "Outer", cateNo: 446},
        {name: "Outer", cateNo: 170}, // Jacket
        {name: "Knitwear", cateNo: 450},
        {name: "Shirts", cateNo: 169},
        {name: "Top", cateNo: 171}, // T-Shirts
        {name: "Bottom", cateNo: 103},
        {name: "Bottom", cateNo: 1368}, // Shorts
        {name: "Shoes", cateNo: 137},
        {name: "Accessories", cateNo: 26}, // Headwear
        {name: "Accessories", cateNo: 27},
      ],
    },
    notes: "성별 미구분 편집샵(내비에 MEN/WOMEN 부서 없음). 카테고리를 gender 근거로 쓰지 않음 — 상품명 표기만 사용. Coat/Jacket 분리, 10개 카테고리",
  },
  {
    key: "visualaid",
    name: "VISUAL AID",
    type: "cafe24",
    baseUrl: "https://visualaid.kr",
    disabled: true, // 보류: 멀티브랜드 편집샵, 상품이 "[BRAND] 제품명" 형식 — [브랜드] 추출 미구현, OLD엔진 크롤 시 brand 오염
    paginate: true,
    maxPages: 300,
    defaultGender: ["women"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 25, gender: ["women"]},
        {name: "Top", cateNo: 26, gender: ["women"]},
        {name: "Bottom", cateNo: 27, gender: ["women"]},
        {name: "Dress", cateNo: 306, gender: ["women"]},
        {name: "Bag", cateNo: 54, gender: ["women"]},
        {name: "Shoes", cateNo: 42, gender: ["women"]},
        {name: "Accessories", cateNo: 28, gender: ["women"]},
        {name: "Accessories", cateNo: 351, gender: ["women"]}, // Headwear
      ],
    },
    notes: "여성 전용. 8개 카테고리",
  },
  // ─── 구조 복잡 → 나중에 manual 설정 필요 ──────────

  {
    key: "8division",
    name: "8디비전",
    type: "cafe24",
    baseUrl: "https://www.8division.com",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 성별 미구분 상품군이다. 편집샵 자체가 unisex라는 뜻은 아니므로 성별을
        // 채우지 않는다. 상품 단위 근거가 없으면 안전하게 적재에서 제외한다.
        {name: "Top", cateNo: 218}, // 상의
        {name: "Outer", cateNo: 220}, // 아우터
        {name: "Bottom", cateNo: 219}, // 하의
        {name: "Shoes", cateNo: 223}, // 신발
        {name: "Bag", cateNo: 222}, // 가방
        {name: "Accessories", cateNo: 229}, // 악세사리
        {name: "Accessories", cateNo: 224}, // 모자
        {name: "Accessories", cateNo: 221}, // 벨트
        {name: "Accessories", cateNo: 1078}, // 주얼리
      ],
    },
    notes: "성별 혼성 편집샵. 성별 미구분 온라인샵 카테고리는 gender 근거로 쓰지 않음. 700+ cate_no 중 의류 카테고리 9개만 사용.",
  },
  {
    key: "sculpstore",
    name: "스컬프스토어",
    type: "cafe24",
    baseUrl: "https://sculpstore.com",
    multiBrand: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 카테고리 (unisex — 성별 구분 없음)
        {name: "Top", cateNo: 77, gender: ["unisex"]}, // 티셔츠
        {name: "Shirts", cateNo: 74, gender: ["unisex"]}, // 셔츠
        {name: "Top", cateNo: 76, gender: ["unisex"]}, // 스웻
        {name: "Knitwear", cateNo: 71, gender: ["unisex"]}, // 니트
        {name: "Top", cateNo: 78, gender: ["unisex"]}, // 베스트
        {name: "Outer", cateNo: 70, gender: ["unisex"]}, // 자켓
        {name: "Outer", cateNo: 64, gender: ["unisex"]}, // 코트
        {name: "Outer", cateNo: 66, gender: ["unisex"]}, // 다운파카
        {name: "Bottom", cateNo: 72, gender: ["unisex"]}, // 긴바지
        {name: "Bottom", cateNo: 73, gender: ["unisex"]}, // 반바지
        {name: "Bottom", cateNo: 65, gender: ["unisex"]}, // 데님
        {name: "Bottom", cateNo: 75, gender: ["unisex"]}, // 스커트
        {name: "Shoes", cateNo: 68, gender: ["unisex"]}, // 신발
        {name: "Shoes", cateNo: 390, gender: ["unisex"]}, // 샌들
        {name: "Accessories", cateNo: 69, gender: ["unisex"]}, // 모자
        {name: "Bag", cateNo: 52, gender: ["unisex"]}, // 가방 & 지갑
        {name: "Accessories", cateNo: 51, gender: ["unisex"]}, // 액세서리
      ],
    },
    notes: "unisex 편집샵 (Eastlogue, EG, Kapital 등). 브랜드 카테고리 제외, 의류 17개 카테고리",
  },
  {
    key: "fr8ight",
    name: "프레이트",
    type: "cafe24",
    baseUrl: "https://fr8ight.co.kr",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 일반 카테고리 (unisex)
        {name: "Top", cateNo: 47, gender: ["unisex"]}, // t-shirts
        {name: "Top", cateNo: 522, gender: ["unisex"]}, // sweats
        {name: "Shirts", cateNo: 48, gender: ["unisex"]}, // shirts
        {name: "Top", cateNo: 49, gender: ["unisex"]}, // vests
        {name: "Knitwear", cateNo: 50, gender: ["unisex"]}, // knitwear
        {name: "Outer", cateNo: 393, gender: ["unisex"]}, // jackets
        {name: "Outer", cateNo: 525, gender: ["unisex"]}, // leather
        {name: "Outer", cateNo: 394, gender: ["unisex"]}, // coats
        {name: "Bottom", cateNo: 52, gender: ["unisex"]}, // pants
        {name: "Bottom", cateNo: 1574, gender: ["unisex"]}, // skirt
        {name: "Bottom", cateNo: 53, gender: ["unisex"]}, // shorts
        {name: "Shoes", cateNo: 55, gender: ["unisex"]}, // shoes
        {name: "Accessories", cateNo: 523, gender: ["unisex"]}, // headwear
        {name: "Accessories", cateNo: 54, gender: ["unisex"]}, // accessories
      ],
    },
    notes: "Eastlogue/Unaffected 자사 브랜드 + 편집샵. 브랜드 페이지(list_b) 제외, 카테고리 14개",
  },
  {
    key: "heights-store",
    name: "하이츠스토어",
    type: "cafe24",
    baseUrl: "https://heights-store.com",
    category: {discovery: "auto"},
    disabled: true,
    notes: "JS 렌더링 복잡. manual 설정 필요",
  },
  {
    key: "llud",
    name: "LLUD",
    type: "cafe24",
    baseUrl: "https://llud.co.kr",
    category: {discovery: "auto"},
    selectors: {productItem: ".xans-product li"},
    disabled: true,
    notes: "마켓플레이스 (100+ 셀러). 구조 다름",
  },

  // ─── 3차 확장: 디자이너 브랜드몰 ─────────────────

  {
    key: "eastlogue",
    name: "이스트로그",
    type: "cafe24",
    baseUrl: "https://eastlogue.com",
    brand: "EASTLOGUE", // 단일브랜드 자사몰 — DOM 브랜드 추출이 한글명("이스트로그")을 반환해 brand_nodes와 불일치했음
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // Men
        {name: "Top", cateNo: 226, gender: ["men"]},       // t-shirts
        {name: "Top", cateNo: 227, gender: ["men"]},       // sweats
        {name: "Shirts", cateNo: 228, gender: ["men"]},
        {name: "Top", cateNo: 229, gender: ["men"]},       // vests
        {name: "Knitwear", cateNo: 230, gender: ["men"]},
        {name: "Outer", cateNo: 231, gender: ["men"]},     // jackets
        {name: "Outer", cateNo: 232, gender: ["men"]},     // leather
        {name: "Outer", cateNo: 233, gender: ["men"]},     // coats
        {name: "Outer", cateNo: 234, gender: ["men"]},     // down jackets
        {name: "Bottom", cateNo: 235, gender: ["men"]},    // pants
        {name: "Bottom", cateNo: 236, gender: ["men"]},    // shorts
        {name: "Shoes", cateNo: 241, gender: ["men"]},
        {name: "Accessories", cateNo: 237, gender: ["men"]}, // headwear
        {name: "Accessories", cateNo: 238, gender: ["men"]},
        // Women
        {name: "Top", cateNo: 207, gender: ["women"]},     // t-shirts
        {name: "Top", cateNo: 208, gender: ["women"]},     // sweats
        {name: "Shirts", cateNo: 209, gender: ["women"]},
      ],
    },
    notes: "밀리터리/아웃도어 자사 브랜드. Men 14 + Women 3 = 17개 카테고리. 10~40만원대",
  },
  {
    key: "sienneboutique",
    name: "시엔느",
    type: "cafe24",
    baseUrl: "https://sienneboutique.com",
    brand: "Sienne", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    defaultGender: ["women"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 54, gender: ["women"]},
        {name: "Top", cateNo: 44, gender: ["women"]},
        {name: "Knitwear", cateNo: 78, gender: ["women"]},
        {name: "Bottom", cateNo: 49, gender: ["women"]},
        {name: "Dress", cateNo: 55, gender: ["women"]},
        {name: "Bag", cateNo: 183, gender: ["women"]},
        {name: "Accessories", cateNo: 56, gender: ["women"]},
      ],
    },
    notes: "리파인드 빈티지 컨템포러리 여성복. 7개 카테고리. 10~50만원대",
  },
  {
    key: "mardimercredi",
    name: "마르디메크르디",
    type: "cafe24",
    baseUrl: "https://mardimercredi.com",
    brand: "Mardi Mercredi", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    defaultGender: ["women"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 519, gender: ["women"]},      // TSHIRT
        {name: "Top", cateNo: 520, gender: ["women"]},      // TOPS
        {name: "Shirts", cateNo: 522, gender: ["women"]},
        {name: "Top", cateNo: 521, gender: ["women"]},      // SWEATSHIRT
        {name: "Bottom", cateNo: 525, gender: ["women"]},
        {name: "Dress", cateNo: 526, gender: ["women"]},
        {name: "Knitwear", cateNo: 523, gender: ["women"]},
        {name: "Outer", cateNo: 524, gender: ["women"]},
        {name: "Accessories", cateNo: 527, gender: ["women"]},
        {name: "Bag", cateNo: 528, gender: ["women"]},
        {name: "Shoes", cateNo: 553, gender: ["women"]},
      ],
    },
    notes: "프렌치 데일리 캐주얼 여성복. WOMEN 11개 카테고리 (KIDS/PET 제외). 5~25만원대",
  },

  {
    key: "matteveil",
    name: "Matteveil",
    type: "cafe24",
    baseUrl: "https://matteveil.kr",
    brand: "Matteveil", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    pricePattern: /KRW\s*([\d,]+)/,
    priceCurrency: "₩",
    defaultGender: ["women"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Top",         cateNo: 43, gender: ["women"]},
        {name: "Accessories", cateNo: 44, gender: ["women"]},
        {name: "Bottom",      cateNo: 46, gender: ["women"]},
        {name: "Dress",       cateNo: 47, gender: ["women"]},
      ],
    },
    notes: "여성 자사 브랜드몰. Top/Acc/Bottom/Dress 4개 카테고리. 4~6만원대",
  },

  // ─── 캐주얼/스트릿 편집샵 (2차 확장) ──────────────

  {
    key: "triplestore",
    name: "트리플스토어",
    type: "cafe24",
    baseUrl: "https://triplestore.co.kr",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // Men
        {name: "Outer", cateNo: 1500, gender: ["men"]},
        {name: "Knitwear", cateNo: 1546, gender: ["men"]},
        {name: "Top", cateNo: 1547, gender: ["men"]},       // Sweatshirt
        {name: "Shirts", cateNo: 1556, gender: ["men"]},
        {name: "Top", cateNo: 1574, gender: ["men"]},       // T-Shirt
        {name: "Bottom", cateNo: 1499, gender: ["men"]},
        {name: "Bottom", cateNo: 1577, gender: ["men"]},    // Shorts
        {name: "Bag", cateNo: 1548, gender: ["men"]},
        {name: "Shoes", cateNo: 1776, gender: ["men"]},
        {name: "Accessories", cateNo: 1501, gender: ["men"]}, // Headgear
        // Women
        {name: "Outer", cateNo: 1508, gender: ["women"]},
        {name: "Knitwear", cateNo: 1568, gender: ["women"]},
        {name: "Top", cateNo: 1569, gender: ["women"]},     // Sweatshirt
        {name: "Top", cateNo: 1593, gender: ["women"]},
        {name: "Dress", cateNo: 1725, gender: ["women"]},
        {name: "Bottom", cateNo: 1507, gender: ["women"]},
        {name: "Bag", cateNo: 1558, gender: ["women"]},
        {name: "Shoes", cateNo: 1778, gender: ["women"]},
        {name: "Accessories", cateNo: 1505, gender: ["women"]}, // Headgear
      ],
    },
    notes: "제주 기반 편집샵. Men 10 + Women 9 = 19개 카테고리. 5~40만원대",
  },
  {
    key: "noclaim",
    name: "노클레임",
    type: "cafe24",
    baseUrl: "https://noclaim.co.kr",
    paginate: true,
    maxPages: 300,
    category: { discovery: "auto" },
    defaultGender: ["unisex"],
    disabled: true,
    notes: "부산 기반 편집샵. 브랜드 기반 구조라 의류 카테고리 없음. 수동 설정 필요",
  },
  {
    key: "swallowlounge",
    name: "스왈로우라운지",
    type: "cafe24",
    baseUrl: "https://swallowlounge.co.kr",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    // "모두 보기"(1152)에 전 브랜드 상품이 포함됨. 브랜드별 서브카테고리(1153+)는 중복이므로 제외.
    // 혼성 편집샵의 전체 목록은 상품 성별 근거가 아니므로 gender/defaultGender를 두지 않는다.
    category: {
      discovery: "manual",
      categories: [{ name: "모두 보기", cateNo: 1152 }],
    },
    notes: "성수동 혼성 편집샵. 전체 목록에는 상품 단위 성별 근거가 필요함. 10~50만원대",
  },
  {
    key: "takeastreet",
    name: "테이크어스트릿",
    type: "cafe24",
    baseUrl: "https://takeastreet.com",
    disabled: true, // 셀렉터 전면 실패(name="상품명" price=5, brand 93% 결손) — 크롤 제외
    paginate: true,
    maxPages: 300,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 137, gender: ["unisex"]},
        {name: "Top", cateNo: 135, gender: ["unisex"]},
        {name: "Bottom", cateNo: 136, gender: ["unisex"]},
        {name: "Bag", cateNo: 138, gender: ["unisex"]},
        {name: "Accessories", cateNo: 139, gender: ["unisex"]}, // 모자
        {name: "Accessories", cateNo: 141, gender: ["unisex"]},
        {name: "Shoes", cateNo: 1111, gender: ["unisex"]},
      ],
    },
    notes: "합정 편집샵. 7개 카테고리. 3~20만원대",
  },
  {
    key: "chanceclothing",
    name: "찬스클로딩",
    type: "cafe24",
    baseUrl: "https://chanceclothing.co.kr",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 29, gender: ["unisex"]},
        {name: "Top", cateNo: 30, gender: ["unisex"]},
        {name: "Bottom", cateNo: 31, gender: ["unisex"]},
        {name: "Shoes", cateNo: 42, gender: ["unisex"]},
        {name: "Bag", cateNo: 43, gender: ["unisex"]},
        {name: "Accessories", cateNo: 44, gender: ["unisex"]}, // Hats
        {name: "Accessories", cateNo: 45, gender: ["unisex"]},
      ],
    },
    notes: "국내외 브랜드 편집샵. 7개 카테고리. 5~30만원대",
  },
  {
    key: "havati",
    name: "하바티",
    type: "cafe24",
    baseUrl: "https://havatishop.com",
    // 편집샵 — 상품 1,823건 전부 "[HORLISUN] ..." 처럼 상품명에 브랜드가 박혀 있다.
    // 2026-08-02 이전에는 두 플래그가 모두 없어서 (1) 직접 크롤이 brand='Havati'(샵
    // 이름)를 전 상품에 찍었고 (2) 갱신 경로의 신규 후보 1,669건이 detected_brand
    // NULL 로 전량 파킹됐다.
    multiBrand: true,
    brandFromNamePrefix: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // Outer 하위
        {name: "Outer", cateNo: 131, gender: ["unisex"]},  // Jacket/Blouson
        {name: "Outer", cateNo: 132, gender: ["unisex"]},  // Jumper/Parka
        {name: "Outer", cateNo: 323, gender: ["unisex"]},  // Leather
        {name: "Outer", cateNo: 133, gender: ["unisex"]},  // Coat
        {name: "Outer", cateNo: 135, gender: ["unisex"]},  // Vest
        {name: "Outer", cateNo: 136, gender: ["unisex"]},  // Padding
        {name: "Knitwear", cateNo: 137, gender: ["unisex"]}, // Cardigan
        // Tops 하위
        {name: "Top", cateNo: 32, gender: ["unisex"]},     // Tee
        {name: "Shirts", cateNo: 33, gender: ["unisex"]},   // Shirt
        {name: "Top", cateNo: 125, gender: ["unisex"]},    // Sweatshirt
        {name: "Knitwear", cateNo: 126, gender: ["unisex"]}, // Knitwear
        // Bottoms 하위
        {name: "Bottom", cateNo: 138, gender: ["unisex"]},  // Denim
        {name: "Bottom", cateNo: 280, gender: ["unisex"]},  // Chino
        {name: "Bottom", cateNo: 281, gender: ["unisex"]},  // Trousers
        {name: "Bottom", cateNo: 282, gender: ["unisex"]},  // Easy Pants
        {name: "Bottom", cateNo: 283, gender: ["unisex"]},  // Work Pants
        {name: "Bottom", cateNo: 284, gender: ["unisex"]},  // Shorts
        // 나머지
        {name: "Shoes", cateNo: 28, gender: ["unisex"]},
        {name: "Bag", cateNo: 80, gender: ["unisex"]},
        {name: "Accessories", cateNo: 79, gender: ["unisex"]}, // Hats
        {name: "Accessories", cateNo: 42, gender: ["unisex"]},
      ],
    },
    notes: "캐주얼 편집샵. 하위 카테고리 21개",
  },

  // ─── 캐주얼 자사 브랜드몰 (2차 확장) ────────────────

  {
    key: "pottery",
    name: "포터리",
    type: "cafe24",
    baseUrl: "https://www.ptry.co.kr",
    brand: "POTTERY",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    selectors: {
      // POTTERY cards are divs. The generic `.xans-product li` fallback sees
      // material/color/origin/size spec rows as separate products.
      productItem: "div.product__item",
      productName: ".en-name > li:not(.displaynone):first-child .add-desc span",
      productPrice: ".figcaption > .price > div:first-child",
      productImage: ".figure img",
      productLink: '.figure a[href*="product_no="]',
    },
    category: {
      discovery: "manual",
      categories: [
        // Official men's navigation.
        {name: "Men Knitwear", cateNo: 747, gender: ["men"]},
        {name: "Men Tailoring", cateNo: 789, gender: ["men"]},
        {name: "Men Outerwear", cateNo: 745, gender: ["men"]},
        {name: "Men Shirts", cateNo: 944, gender: ["men"]},
        {name: "Men Tops", cateNo: 746, gender: ["men"]},
        {name: "Men Bottoms", cateNo: 748, gender: ["men"]},
        {name: "Men Denim", cateNo: 749, gender: ["men"]},
        {name: "Men Accessories", cateNo: 750, gender: ["men"]},
        // Official women's navigation. Products found in both departments
        // become unisex through mergeCafe24DuplicateGender.
        {name: "Women Knitwear", cateNo: 1022, gender: ["women"]},
        {name: "Women Tailoring", cateNo: 1023, gender: ["women"]},
        {name: "Women Outerwear", cateNo: 1024, gender: ["women"]},
        {name: "Women Shirts", cateNo: 1025, gender: ["women"]},
        {name: "Women Tops", cateNo: 1026, gender: ["women"]},
        {name: "Women Dresses", cateNo: 1136, gender: ["women"]},
        {name: "Women Skirts", cateNo: 1232, gender: ["women"]},
        {name: "Women Bottoms", cateNo: 1027, gender: ["women"]},
        {name: "Women Denim", cateNo: 1028, gender: ["women"]},
      ],
    },
    notes: "현재 상품명에 남성/여성/[유니섹스]가 혼재하므로 사이트 기본 성별 금지. 상품명 근거만 사용.",
  },
  {
    key: "beslow",
    name: "비슬로우",
    type: "cafe24",
    baseUrl: "https://beslow.co.kr",
    brand: "BESLOW", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    category: {
      discovery: "manual",
      categories: [
        {name: "Beslow", cateNo: 126, gender: ["men"]},          // 자사 메인 (6p)
        {name: "Beslow Purple", cateNo: 76, gender: ["men"]},    // 퍼플 라인 (2p)
        {name: "Slowboy", cateNo: 133, gender: ["men"]},         // 슬로우보이 (1p)
        {name: "Selected Brands", cateNo: 127, gender: ["men"]}, // 셀렉 브랜드 (16p)
      ],
    },
    disabled: true,
    notes: "미니멀 클래식 남성복. 보류 사유: 가격이 .xans-product-listitem spec블록에 JS로 늦게 주입 → 엔진 2s 스냅샷 시점 미렌더, price 0% 정상(2026-05-17 검증). brand/name은 수정 후 정상. 렌더대기 로직 추가 전까지 제외",
  },
  {
    key: "anotheroffice",
    name: "어나더오피스",
    type: "cafe24",
    baseUrl: "https://anotheroffice.co.kr",
    brand: "Another Office", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // Men
        {name: "Outer", cateNo: 44, gender: ["men"]},
        {name: "Top", cateNo: 45, gender: ["men"]},
        {name: "Bottom", cateNo: 46, gender: ["men"]},
        {name: "Accessories", cateNo: 47, gender: ["men"]},
        // Women
        {name: "Top", cateNo: 80, gender: ["women"]},
        {name: "Bottom", cateNo: 81, gender: ["women"]},
        {name: "Dress", cateNo: 95, gender: ["women"]},
        {name: "Accessories", cateNo: 82, gender: ["women"]},
      ],
    },
    notes: "컨템포러리 캐주얼, 테일러드 베이직. Men 4 + Women 4 = 8개 카테고리. 7~38만원대",
  },
  {
    key: "bastong",
    name: "바스통",
    type: "cafe24",
    baseUrl: "https://bastong.co.kr",
    brand: "BASTONG", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "All", cateNo: 64, gender: ["men"]}, // SHOPNOW (전체 상품 — 단일 카테고리)
      ],
    },
    notes: "클래식 남성복. 단일 카테고리 (379개). 7~50만원대",
  },
  {
    key: "roughside",
    name: "러프사이드",
    type: "cafe24",
    baseUrl: "https://roughside.co.kr",
    brand: "ROUGHSIDE", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // Men
        {name: "Outer", cateNo: 62, gender: ["men"]},
        {name: "Outer", cateNo: 63, gender: ["men"]},       // 재킷
        {name: "Bottom", cateNo: 27, gender: ["men"]},
        {name: "Shirts", cateNo: 64, gender: ["men"]},
        {name: "Knitwear", cateNo: 65, gender: ["men"]},
        {name: "Top", cateNo: 66, gender: ["men"]},         // 컷앤소운
        {name: "Accessories", cateNo: 53, gender: ["men"]},
        // Women
        {name: "Outer", cateNo: 81, gender: ["women"]},
        {name: "Top", cateNo: 86, gender: ["women"]},
        {name: "Bottom", cateNo: 83, gender: ["women"]},
        {name: "Knitwear", cateNo: 85, gender: ["women"]},
        {name: "Dress", cateNo: 84, gender: ["women"]},
        {name: "Accessories", cateNo: 87, gender: ["women"]},
      ],
    },
    notes: "컨템포러리 캐주얼. Men 7 + Women 6 = 13개 카테고리. 5~25만원대",
  },
  {
    key: "blankroom",
    name: "블랭크룸",
    type: "cafe24",
    baseUrl: "https://blankroom.house",
    brand: "BLANKROOM", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true, // color는 .color-name span (JS-rendered) — list page에 없음
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 87, gender: ["unisex"]},
        {name: "Knitwear", cateNo: 51, gender: ["unisex"]},
        {name: "Shirts", cateNo: 80, gender: ["unisex"]},
        {name: "Top", cateNo: 30, gender: ["unisex"]},
        {name: "Bottom", cateNo: 31, gender: ["unisex"]},
        {name: "Bottom", cateNo: 188, gender: ["unisex"]}, // Denim
      ],
    },
    notes: "미니멀 라이프스타일. 6개 카테고리 (Home 제외)",
  },
  {
    key: "steadyeverywear",
    name: "스테디에브리웨어",
    type: "cafe24",
    baseUrl: "https://steadyeverywear.com",
    disabled: true,
    paginate: true,
    maxPages: 300,
    category: { discovery: "auto" },
    defaultGender: ["unisex"],
    notes: "데일리 캐주얼. JS 렌더링 심해서 카테고리 구조 파악 불가",
  },

  // ─── 카테고리 적음 / 구조 미약 → 보류 ─────────────

  {
    key: "obscura",
    name: "옵스큐라",
    type: "cafe24",
    baseUrl: "https://obscura-store.com",
    category: {discovery: "auto"},
    disabled: true,
    notes: "카테고리 구분 미약. 브랜드 기반",
  },
  {
    key: "samplas",
    name: "샘플라스",
    type: "cafe24",
    baseUrl: "https://samplas.co.kr",
    category: {discovery: "auto"},
    disabled: true,
    notes: "여성 전용. 카테고리 3~4개뿐",
  },
  {
    key: "empty",
    name: "엠프티",
    type: "cafe24",
    baseUrl: "https://empty.seoul.kr",
    category: {discovery: "auto"},
    disabled: true,
    notes: "카테고리 구조 숨김. JS 분석 필요",
  },

  // ─── 기타 비활성 ──────────────────────────────────

  {
    key: "opener",
    name: "오프너",
    type: "cafe24",
    baseUrl: "https://www.opener.co.kr",
    category: {discovery: "auto"},
    disabled: true,
    notes: "cate_no 패턴 없음",
  },
  {
    key: "addicted",
    name: "에딕티드",
    type: "cafe24",
    baseUrl: "https://www.addicted.co.kr",
    category: {discovery: "auto"},
    disabled: true,
    notes: "SSL 인증서 에러",
  },
  {
    key: "the-broken-arm",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 상품 0건 — 편집샵 성격은 동일).
    multiBrand: true,
    name: "THE BROKEN ARM",
    type: "shopify",
    baseUrl: "https://www.the-broken-arm.com",
    disabled: true,
    notes: "Shopify /products.json 403 차단",
  },
  // ─── 해외 디자이너 자사몰 (Shopify POC, 2026-04-23) ──────────────
  {
    key: "aime-leon-dore",
    name: "Aimé Leon Dore",
    type: "shopify",
    baseUrl: "https://www.aimeleondore.com",
    brand: "Aimé Leon Dore",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "kith",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 286개).
    multiBrand: true,
    name: "Kith",
    type: "shopify",
    baseUrl: "https://kith.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Multi-brand editorial, ~15~25k SKU 예상",
  },
  {
    key: "stussy",
    name: "Stüssy",
    type: "shopify",
    baseUrl: "https://www.stussy.com",
    brand: "Stüssy",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "noah-ny",
    name: "Noah NY",
    type: "shopify",
    baseUrl: "https://noahny.com",
    brand: "Noah",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-07-28 재수집 배치 2에서 발견: URL/상품명에 성별 신호가 전혀 없어
    // gender_missing 으로 크롤 634행 중 66행만 살아남았다(게이트가 정상
    // 차단). 기존 DB 634행 실측: men=634, women=3(예외적 오분류로 보임),
    // 상품명 women 계열 키워드 0건 — 사실상 남성 전용 헤리티지 멘즈웨어
    // 브랜드(sack jacket/sport jacket 등 클래식 테일러링 어휘)라 men 으로 명시.
    defaultGender: ["men"],
  },
  {
    key: "brain-dead",
    name: "Brain Dead",
    type: "shopify",
    baseUrl: "https://wearebraindead.com",
    brand: "Brain Dead",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "cpfm",
    name: "Cactus Plant Flea Market",
    type: "shopify",
    baseUrl: "https://cactusplantfleamarket.com",
    brand: "Cactus Plant Flea Market",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-07-28 재수집 파일럿에서 발견: 상품 9개 전부 성별 신호가 없어
    // gender_missing 으로 QC 게이트에 전량 걸려 writeProductsFile 이 파일을
    // 아예 안 썼다 (크롤 "0개"로 보였던 원인). 스트리트웨어 브랜드로 사이트에
    // 남녀 구분이 없어 unisex 로 명시.
    defaultGender: ["unisex"],
  },
  {
    key: "drakes",
    name: "Drake's",
    type: "shopify",
    baseUrl: "https://www.drakes.com",
    brand: "Drake's",
    sourceCurrency: "GBP",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-07-28 재수집 배치 2에서 발견: gender_missing 으로 1816개 중
    // 1639개 드랍(46→942행 게이트 실패). 기존 DB 942행 전량 men, women 0건
    // — Drake's 는 영국 헤리티지 멘즈웨어 전문 브랜드라 men 으로 명시.
    // (참고: 같은 배치의 stussy/aime-leon-dore 는 반대로 실제 혼성 브랜드라
    // defaultGender 를 넣지 않았다 — men/women 이 둘 다 실측되는 곳에 일괄
    // 기본값을 넣으면 그 다양성 자체를 세탁하게 된다.)
    defaultGender: ["men"],
  },
  {
    key: "bodega",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 172개).
    multiBrand: true,
    name: "Bodega",
    type: "shopify",
    baseUrl: "https://bdgastore.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "032c",
    name: "032c",
    type: "shopify",
    baseUrl: "https://032c.com",
    brand: "032c",
    sourceCurrency: "EUR",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "apc-us",
    name: "A.P.C. (US)",
    type: "shopify",
    baseUrl: "https://apc-us.com",
    brand: "A.P.C.",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
  },

  // ─── Multi-brand editorial (Shopify) — SPEC-007 ──────────────────────
  // Three Shopify-backed luxury/streetwear multi-brand editorials added
  // 2026-05-07. Live probe (.moai/cache/spec-007-prep/probe.ts):
  //   - Slam Jam:  127 vendors, 2500+ SKU sample, top: Nike/OAMC/adidas/Undercover
  //   - Antonioli: 185 vendors, 2500+ SKU sample, top: Ann Demeulemeester/Rick Owens/Gucci/Balenciaga
  //   - Browns:    347 vendors, 2500+ SKU sample, top: Zimmermann/The Row/Khaite/Jacquemus
  // Per user memory `feedback_region_preference.md`: prefer global/US over
  // KR localization. Engine sends `localization={GB,DE}` cookie via
  // `CURRENCY_TO_COUNTRY` mapping → Shopify Markets returns native EUR/GBP
  // prices (NOT auto-converted KRW). import-products.ts handles GBP→KRW
  // (×1750) and EUR→KRW (×1560) at upsert time per SPEC-002 hook.
  {
    key: "slam-jam",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 212개).
    multiBrand: true,
    name: "Slam Jam",
    type: "shopify",
    baseUrl: "https://slamjam.com",
    // KRW = "한국 마켓을 크롤한다". Shopify Markets 가 KR 마켓을 열어두고 있어
    // /products.json?country=KR 이 현지 원화가를 직접 준다 (실측 2026-08-26:
    // Carlson Cut Jeans €117 → ₩161,124). 환산값보다 사이트가 실제로 한국
    // 고객에게 제시하는 가격이 정확하므로 EUR 크롤 + import 환산을 대체한다.
    sourceCurrency: "KRW",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Slam Jam Milan, 1989-est, streetwear/contemporary multi-brand editorial. ~127 vendors observed 2026-05-07; Nike/OAMC/adidas/Undercover/Puma top. SPEC-PLATFORM-EXPANSION-007. maxPages bumped 50→100 (2026-05-07). 2026-08-26: sourceCurrency EUR→KRW — 스토어가 KR 마켓을 지원해 country=KR 로 원화가를 직접 받는다(EUR 시절 재고 중 9건이 EUR 금액을 원화로 적재한 채 남아 있었다).",
  },
  {
    key: "antonioli",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 165개).
    multiBrand: true,
    name: "Antonioli",
    type: "shopify",
    baseUrl: "https://antonioli.eu",
    sourceCurrency: "EUR",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Antonioli Milan, 1987-est, luxury contemporary multi-brand editorial. ~185 vendors observed 2026-05-07; Ann Demeulemeester/Rick Owens/Gucci/Balenciaga/Prada/Loewe top. Shopify Markets routes EUR via localization=DE cookie (KR-IP would otherwise auto-route to KRW). SPEC-PLATFORM-EXPANSION-007. maxPages bumped 50→100 (2026-05-07).",
  },
  {
    key: "browns",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 390개).
    multiBrand: true,
    name: "Browns Fashion",
    type: "shopify",
    baseUrl: "https://brownsfashion.com",
    sourceCurrency: "GBP",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Browns Fashion London, 1970-est, Farfetch group subsidiary with separate curation team. ~347 vendors observed 2026-05-07; Zimmermann/The Row/Le Gramme/Khaite/Tom Wood/Valentino top. Women's luxury heavy. Migrated to Shopify in 2024. Distinct SKU IDs from Farfetch (Shopify product handle vs Farfetch -item-{id}.aspx) — no Supabase dedup collision. Shopify Markets routes GBP via localization=GB cookie. SPEC-PLATFORM-EXPANSION-007. maxPages bumped 50→100 (2026-05-07) — first run hit 50-page cap at 12,495 products.",
  },

  // ─── Tier 1 unique-selection editorial (SPEC-008) ───────────────────
  // Both confirmed Shopify accessible from KR-IP (deep-probe 2026-05-07).
  // Selected for minimum brand overlap with existing 42 platforms.
  {
    key: "mohawk-general",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 215개).
    multiBrand: true,
    name: "Mohawk General Store",
    type: "shopify",
    baseUrl: "https://www.mohawkgeneralstore.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Mohawk General Store LA. Minimal Japanese + Scandinavian + indie designer focus. ~110 unique vendors observed 2026-05-07: Auralee/SMOCK/Lemaire/Hai/mfpen/Studio Nicholson/Baserange/Comme Si/Still By Hand/Gimaguas top. Almost zero overlap with existing platforms — high incremental value. Shopify Markets routes USD via localization=US cookie. SPEC-PLATFORM-EXPANSION-008.",
  },
  {
    key: "union-la",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 52개).
    multiBrand: true,
    name: "Union LA",
    type: "shopify",
    baseUrl: "https://store.unionlosangeles.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Union Los Angeles. Japanese heritage + US streetwear luxury. ~53 vendors observed 2026-05-07: Union LA(자체)/RRR123/Kapital/A.PRESSE/Visvim/Jacques Marie Mage/Martine Rose/Patta/Aaron Levine. Japanese heritage brand selection unmatched by other registered platforms. SPEC-PLATFORM-EXPANSION-008.",
  },
  {
    key: "concepts",
    // 멀티브랜드 편집샵 — 상품마다 브랜드가 다르다 (실측 2026-07-31 고유 브랜드 77개).
    multiBrand: true,
    name: "Concepts",
    type: "shopify",
    baseUrl: "https://cncpts.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Concepts Boston, sneakers + contemporary multi-brand. ~72 vendors observed 2026-05-07: Nike(133)/Adidas(117)/NB(83)/Jordan(71)/BAPE(61)/GANNI(58)/Stone Island(45)/Honor The Gift(35)/Dime(27)/Danielle Guizio(26). New value vs existing catalog: BAPE, Stone Island, Dime, Honor The Gift. SPEC-PLATFORM-EXPANSION-008 round 2.",
  },
  {
    key: "18east",
    name: "18 East",
    type: "shopify",
    baseUrl: "https://18east.co",
    brand: "18 East",
    // 자사 상품이 대다수지만 ROTOTO/KEEN/NANGA 등 외부 vendor도 실제 판매한다.
    // 하우스 브랜드로 일괄 덮지 않고 Shopify vendor를 상품별로 유지한다.
    multiBrand: true,
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "18 East NYC indie designer single-brand DTC (~90% in-house: 357/398 SKU). Auxiliary vendors: ROTOTO, REVOLUTION KNITS, KEEN, NANGA. Standalone 18 East catalog parallel to other DTC entries (ALD/Kith/Stussy). SPEC-PLATFORM-EXPANSION-008 round 2.",
  },

  // ─── Uniqlo (KR) — first non-Cafe24/non-Shopify engine ───────────────
  // SPEC: SPEC-PLATFORM-EXPANSION-001
  // path format: "<L1_gender>,<L2_class>,<L3_category>,<L4_subcategory>"
  // (4 positions, comma-separated, URL-encoded by the engine).
  {
    key: "uniqlo-kr",
    name: "유니클로 (KR)",
    type: "uniqlo",
    baseUrl: "https://www.uniqlo.com/kr/ko",
    region: "KR",
    sourceCurrency: "KRW",
    crawlDelay: 1000,
    apiCategoryPaths: [
      // WOMEN (57892) — top-level + L2 classes
      "57892,,,",
      "57892,57959,,",  // 티셔츠 & UT & 브라탑
      "57892,95354,,",  // 셔츠 & 블라우스 & 폴로셔츠
      "57892,95353,,",  // 니트 & 가디건
      "57892,57958,,",  // 아우터
      "57892,57960,,",  // 팬츠
      "57892,57961,,",  // 원피스 & 스커트
      "57892,57963,,",  // 이너웨어
      "57892,57964,,",  // 파자마 & 홈웨어 (lounge)
      "57892,57965,,",  // 액세서리
      "57892,57962,,",  // 스포츠 유틸리티 웨어
      // MEN (57893) — top-level + L2 classes
      "57893,,,",
      "57893,57967,,",  // 티셔츠 & 스웨트셔츠 & UT
      "57893,95356,,",  // 셔츠 & 폴로셔츠
      "57893,95355,,",  // 니트 & 가디건
      "57893,57966,,",  // 아우터
      "57893,57968,,",  // 팬츠
      "57893,57970,,",  // 이너웨어
      "57893,57971,,",  // 라운지 팬츠 & 홈웨어
      "57893,57972,,",  // 액세서리
      "57893,57969,,",  // 스포츠 유틸리티 웨어
      // KIDS (57894) and BABY (57925) — top-level only
      "57894,,,",
      "57925,,,",
    ],
    notes: "Uniqlo KR API engine. Path = 4-position L1,L2,L3,L4. KRW native, 1 req/sec, 5-UA rotation, robots-check enforced.",
  },

  // ─── Uniqlo (US) — region=US shared engine, USD-native cache ────────
  // SPEC: SPEC-PLATFORM-EXPANSION-002
  // path format: same 4-position scheme as KR. US class IDs from live
  // probe aggregations.tree.classes (research.md §1 [^u-us4]):
  //   23294 Outerwear, 23295 T-Shirts & Sweats, 23296 Jeans & Pants,
  //   23297 Dresses & Skirts, 23298 Innerwear & Underwear,
  //   23299 Loungewear & Home, 23300 Accessories,
  //   95663 Shirts & Blouses, 95664 Sweaters & Cardigans
  // Gender L1 codes: 22210 WOMEN, 22211 MEN, 22212 KIDS, 22213 BABY.
  {
    key: "uniqlo-us",
    name: "유니클로 (US)",
    type: "uniqlo",
    baseUrl: "https://www.uniqlo.com/us/en",
    region: "US",
    sourceCurrency: "USD",
    crawlDelay: 1000,
    apiCategoryPaths: [
      // WOMEN (22210) — top-level + L2 classes
      "22210,,,",
      "22210,23295,,",  // T-Shirts & Sweats
      "22210,95663,,",  // Shirts & Blouses
      "22210,95664,,",  // Sweaters & Cardigans
      "22210,23294,,",  // Outerwear
      "22210,23296,,",  // Jeans & Pants
      "22210,23297,,",  // Dresses & Skirts
      "22210,23298,,",  // Innerwear & Underwear
      "22210,23299,,",  // Loungewear & Home
      "22210,23300,,",  // Accessories
      // MEN (22211) — top-level + L2 classes
      "22211,,,",
      "22211,23295,,",  // T-Shirts & Sweats
      "22211,95663,,",  // Shirts & Polos
      "22211,95664,,",  // Sweaters & Cardigans
      "22211,23294,,",  // Outerwear
      "22211,23296,,",  // Jeans & Pants
      "22211,23298,,",  // Innerwear & Underwear
      "22211,23299,,",  // Loungewear & Home
      "22211,23300,,",  // Accessories
      // KIDS (22212) and BABY (22213) — top-level only
      "22212,,,",
      "22213,,,",
    ],
    notes: "Uniqlo US API engine. Region=US drives /us/api/commerce/v5/en/products + USD source currency + en-US locale. USD-native cache; convertToKrw applied at import time. 1 req/sec, 5-UA rotation, robots-check enforced.",
  },

  // ─── ZARA (KR) — first Playwright engine after Cafe24 ───────────────
  // SPEC: SPEC-PLATFORM-EXPANSION-003
  // Engine: pure Playwright with channel:"chrome" (real Chrome binary
  //   required — bundled Chromium hard-403'd by Akamai fingerprint check).
  //   AJAX response interception of /kr/ko/category/{id}/products?ajax=true
  //   carries the full product JSON with name, price (KRW int), seo,
  //   availability, color list, and xmedia image URLs.
  // Pacing: 2 sec/page (browser overhead + Akamai-friendly).
  // ToS: pre-verified 2026-05-05 by hansangho — AMBIGUOUS-ACCEPTED-BY-OWNER
  //   (research.md §1.2). Verbatim Korean clauses embedded at top of
  //   src/lib/zara-engine.ts per REQ-008.
  // categoryUrls: Women + Men L2 landings live-verified 2026-05-05 against
  //   the ZARA KR SPA. Refresh cadence: once per major season change OR
  //   when test failures surface.
  {
    key: "zara-kr",
    name: "자라 (KR)",
    type: "zara",
    baseUrl: "https://www.zara.com/kr/ko",
    sourceCurrency: "KRW",
    // SPEC-PLATFORM-EXPANSION-005 REQ-001: explicit region binding now
    // that the engine is region-parameterized (zara-kr + zara-us share
    // src/lib/zara-engine.ts).
    region: "KR",
    crawlDelay: 2000,
    categoryUrls: [
      // WOMAN
      "https://www.zara.com/kr/ko/woman-new-in-l1180.html",
      "https://www.zara.com/kr/ko/woman-coats-l1184.html",
      "https://www.zara.com/kr/ko/woman-jackets-l1185.html",
      "https://www.zara.com/kr/ko/woman-knitwear-l1182.html",
      "https://www.zara.com/kr/ko/woman-shirts-l1217.html",
      "https://www.zara.com/kr/ko/woman-tshirts-l1180.html",
      "https://www.zara.com/kr/ko/woman-trousers-l1335.html",
      "https://www.zara.com/kr/ko/woman-jeans-l1119.html",
      "https://www.zara.com/kr/ko/woman-dresses-l1066.html",
      "https://www.zara.com/kr/ko/woman-skirts-l1299.html",
      // MAN
      "https://www.zara.com/kr/ko/man-new-in-l711.html",
      "https://www.zara.com/kr/ko/man-coats-l715.html",
      "https://www.zara.com/kr/ko/man-jackets-l717.html",
      "https://www.zara.com/kr/ko/man-knitwear-l681.html",
      "https://www.zara.com/kr/ko/man-shirts-l737.html",
      "https://www.zara.com/kr/ko/man-tshirts-l855.html",
      "https://www.zara.com/kr/ko/man-trousers-l838.html",
      "https://www.zara.com/kr/ko/man-jeans-l710.html",
    ],
    notes: "ZARA KR Playwright engine. Akamai bypass via channel:'chrome' (real Chrome required, bundled Chromium hard-403'd). XHR-interception strategy: /kr/ko/category/{id}/products?ajax=true carries full product JSON. KRW-native, 2 sec/page, 5-UA rotation (one UA per browser context), robots-check enforced. ToS pre-verified 2026-05-05 (research.md §1.2 verified, AMBIGUOUS-ACCEPTED-BY-OWNER). portal.ai-internal-use only; halt on cease-and-desist.",
  },

  // ─── ZARA (US) — region=US shared engine, USD-native cache ──────────
  // SPEC: SPEC-PLATFORM-EXPANSION-005
  // Engine: src/lib/zara-engine.ts is region-parameterized (zara-kr +
  //   zara-us share one module per SPEC-005 §9 DDD ANALYZE-PRESERVE-IMPROVE).
  //   `config.region === "US"` drives:
  //     • browser context locale="en-US", timezoneId="America/New_York"
  //     • parseProductsFromXhr region/sourceCurrency parameters
  //     • formatZaraPrice("$" + price.toFixed(2))
  //   AJAX response interception of /us/en/category/{id}/products?ajax=true
  //   carries the full product JSON (region-agnostic regex pattern).
  // Pacing: 2 sec/page (mirrors KR — Akamai-friendly + browser overhead).
  // Akamai posture: REQ-007 verified 2026-05-06 — 5/5 (100%) sequential
  //   page.goto reach real product DOM via channel:'chrome'.
  // ToS: REQ-008 verified 2026-05-06 — canonical PDF located via SPA
  //   homepage footer; verdict AMBIGUOUS-ACCEPTED-BY-OWNER. Verbatim
  //   English §3, §17 clauses embedded at top of src/lib/zara-engine.ts.
  // categoryUrls: 18 Women + Men L2 landings sourced from
  //   sitemap-category-us-en.xml.gz 2026-05-06; KR L-codes that collide
  //   (l1184, l1185, l1180, l717, l710) are explicitly excluded.
  //   REQ-009 verified 2026-05-06: 17/18 PASS. man-outerwear-l715 removed
  //   (page renders cards but does not fire AJAX endpoint — engine
  //   XHR-interception cannot harvest).
  // Currency: USD-native cache; convertToKrw applied at import time via
  //   existing src/lib/fx.ts (FX_TO_KRW.USD = 1430, populated by SPEC-002).
  //   No engine-time conversion; no live FX API.
  {
    key: "zara-us",
    name: "자라 (US)",
    type: "zara",
    baseUrl: "https://www.zara.com/us/en",
    region: "US",
    sourceCurrency: "USD",
    crawlDelay: 2000,
    categoryUrls: [
      // WOMAN (10)
      "https://www.zara.com/us/en/woman-new-in-l1180.html",
      "https://www.zara.com/us/en/woman-outerwear-l1184.html",
      "https://www.zara.com/us/en/woman-jackets-l1114.html",
      "https://www.zara.com/us/en/woman-knitwear-l1152.html",
      "https://www.zara.com/us/en/woman-shirts-l1217.html",
      "https://www.zara.com/us/en/woman-tshirts-l1362.html",
      "https://www.zara.com/us/en/woman-trousers-l1335.html",
      "https://www.zara.com/us/en/woman-jeans-l1119.html",
      "https://www.zara.com/us/en/woman-dresses-l1066.html",
      "https://www.zara.com/us/en/woman-skirts-l1299.html",
      // MAN (7) — l715 (man-outerwear) removed 2026-05-06 per REQ-009:
      //   live verification 3/3 attempts captured 47 product cards but
      //   the page does NOT fire /us/en/category/{id}/products?ajax=true
      //   XHR (data is delivered via a different mechanism). The engine's
      //   XHR-interception strategy cannot harvest products from this URL.
      //   Re-add only if (a) engine adds an HTML-fallback parse path or
      //   (b) ZARA restores the AJAX endpoint for this category.
      "https://www.zara.com/us/en/man-new-in-l711.html",
      "https://www.zara.com/us/en/man-jackets-l640.html",
      "https://www.zara.com/us/en/man-knitwear-l681.html",
      "https://www.zara.com/us/en/man-shirts-l737.html",
      "https://www.zara.com/us/en/man-tshirts-l855.html",
      "https://www.zara.com/us/en/man-trousers-l838.html",
      "https://www.zara.com/us/en/man-jeans-l659.html",
    ],
    notes: "ZARA US Playwright engine. Shares src/lib/zara-engine.ts with KR via region:'US' (SPEC-005 §9 DDD). Run-phase gates verified 2026-05-06: REQ-007 Akamai bypass 5/5 (100%) with channel:'chrome' against woman-new-in-l1180. REQ-008 ToS captured from canonical PDF terms-and-conditions-en_US-20250829.pdf via SPA homepage footer; verdict AMBIGUOUS-ACCEPTED-BY-OWNER (no automation keyword present; §17 IP rights structurally parallel to KR §15) — verbatim English clauses embedded at top of zara-engine.ts. REQ-009 live URL verification 17/18 (man-outerwear-l715 removed: page does not fire AJAX endpoint). XHR-interception: /us/en/category/{id}/products?ajax=true (region-agnostic regex). USD-native cache, USD→KRW import-time conversion via SPEC-002 fx.ts hook (FX_TO_KRW.USD = 1430). 2 sec/page pacing, 5-UA rotation, robots-check enforced. portal.ai-internal-use only; halt-on-cease-and-desist; re-verify > 90 days OR Inditex USA, Inc. communication OR ToS PDF version change.",
  },

  // ─── Farfetch (KR) — luxury multi-brand DOM-scrape engine ───────────
  // SPEC: SPEC-PLATFORM-EXPANSION-006
  // Engine: src/lib/farfetch-engine.ts is region-parameterized
  //   (farfetch-kr + farfetch-us share one module per SPEC-006 §9 DDD).
  //   `config.region` drives browser context locale + timezone, source
  //   currency, price formatter. KR is server-geo-routed (KRW-native).
  // Strategy: Playwright `channel:"chrome"` + DOM-scrape extraction
  //   (Farfetch SSRs product cards directly; no XHR-interception).
  //   Selector: `[data-component*="ProductCard"]`. Image hosts
  //   whitelist: cdn-images.farfetch-contents.com, cdn-static.farfetch-
  //   contents.com.
  // Pacing: 3 sec/page (more conservative than ZARA's 2 sec — luxury
  //   multi-brand has higher anti-bot monitoring potential).
  // ToS: live-captured 2026-05-07 (REQ-008). §13 names "데이터 마이닝,
  //   로봇, 데이터 수집 및 발췌 툴" generically and prohibits creating a
  //   database from "가격 및 상품 리스트" without written consent.
  //   Verdict: AMBIGUOUS-ACCEPTED-BY-OWNER (hansangho 2026-05-07).
  //   Verbatim Korean clauses embedded at top of farfetch-engine.ts.
  // categoryUrls: 8 sitemap-derived URLs verified 2026-05-07 via REQ-009
  //   probe (KR multi-nav 8/8 pass at 3-sec pacing).
  {
    key: "farfetch-kr",
    name: "파페치 (KR)",
    type: "farfetch",
    baseUrl: "https://www.farfetch.com/kr",
    region: "KR",
    sourceCurrency: "KRW",
    crawlDelay: 3000,
    // Top-level `/{gender}/items.aspx` URLs are deliberately omitted
    // — they render curated showcase tiles without per-card brand/price
    // text, yielding 0 parsed products (verified 2026-05-07 full crawl).
    // Only L2 buckets carry the [data-component*="ProductCard"] grid
    // with hydrated brand/name/price text. Sub-L2 segments (sale,
    // jewellery, watches) are added defensively; the engine's 4xx-with-
    // populated-body rule and abort-on-3 mechanism cover URL drift.
    categoryUrls: [
      // Men L2 (slug numbering verified 2026-05-07 via live nav DOM)
      "https://www.farfetch.com/kr/shopping/men/clothing-2/items.aspx",
      "https://www.farfetch.com/kr/shopping/men/shoes-2/items.aspx",
      "https://www.farfetch.com/kr/shopping/men/bags-purses-2/items.aspx",
      "https://www.farfetch.com/kr/shopping/men/accessories-all-2/items.aspx",
      // Women L2
      "https://www.farfetch.com/kr/shopping/women/clothing-1/items.aspx",
      "https://www.farfetch.com/kr/shopping/women/shoes-1/items.aspx",
      "https://www.farfetch.com/kr/shopping/women/bags-purses-1/items.aspx",
      "https://www.farfetch.com/kr/shopping/women/accessories-all-1/items.aspx",
    ],
    notes: "Farfetch KR Playwright + DOM-scrape engine. channel:'chrome' (real Chrome required, similar Akamai posture to ZARA). KR-routed via IP geo-detection — KRW native, Korean product names. 3 sec/page pacing (more conservative than ZARA's 2 sec — luxury multi-brand has higher monitoring potential). 5-UA rotation (one UA per context), robots-check enforced. ToS captured 2026-05-07 (REQ-008): §13 names '데이터 마이닝, 로봇' generically + DB-from-price-list prohibition; verdict AMBIGUOUS-ACCEPTED-BY-OWNER (hansangho). Verbatim Korean clauses embedded in src/lib/farfetch-engine.ts top-of-file. REQ-007 Akamai bypass 8/8 pass with channel:'chrome' at 3-sec pacing 2026-05-07. REQ-009 categoryUrls live-verified 2026-05-07. Pagination ?page=N returns 4xx with populated body — engine treats 4xx + cards>=10 as success. portal.ai-internal-use only; halt-on-cease-and-desist; re-verify > 90 days OR Farfetch UK Limited (Coupang Inc.) communication OR ToS body change.",
  },

  // ─── Farfetch (US) — region=US shared engine, USD-native cache ──────
  // SPEC: SPEC-PLATFORM-EXPANSION-006 (US extension by user request 2026-05-07)
  // Engine: shares src/lib/farfetch-engine.ts with KR via region:'US'.
  // Currency: USD-native cache; convertToKrw applied at import time via
  //   existing src/lib/fx.ts (FX_TO_KRW.USD = 1430, populated by SPEC-002).
  // ToS: same legal entity as KR. Farfetch's /terms-and-conditions/
  //   serves Korean ToS text with notice "This section is currently only
  //   available in Korean." — KR §13 binding text applies to US storefront.
  // Verification status: REQ-007/009 for US storefront NOT empirically
  //   verified from KR-resident operator IP (Farfetch geo-routes KR IPs
  //   away from /shopping/{gender}/items.aspx to /kr/shopping/...).
  //   Production deployment from US-routable infrastructure SHOULD re-run
  //   the live multi-nav probe via `pnpm crawl --probe=farfetch-us`. The
  //   region-parameterized engine is structurally symmetric to KR (same
  //   Akamai vendor, same Playwright lifecycle, same DOM selectors).
  //   Operator may set `disabled: true` if production probe fails.
  {
    key: "farfetch-us",
    name: "Farfetch (US)",
    type: "farfetch",
    baseUrl: "https://www.farfetch.com",
    region: "US",
    sourceCurrency: "USD",
    crawlDelay: 3000,
    // KR-resident operator IP forces server-side geo-routing to /kr/
    // regardless of locale header — verified 2026-05-07 (debug-us.ts:
    // hrefs returned as /kr/shopping/... and prices as ₩, NOT $). The
    // engine cannot harvest US-storefront cards without a US-routable
    // egress (residential US IP, US datacenter, or cloud region in
    // North America). Re-enable by removing `disabled: true` once
    // production runs from US-routable infra AND `pnpm crawl
    // --probe=farfetch-us` returns USD-priced products.
    disabled: true,
    // Top-level `/{gender}/items.aspx` omitted (curated showcase, 0
    // parsed products). Same rationale as farfetch-kr.
    categoryUrls: [
      // Men L2 (mirrors KR slug structure)
      "https://www.farfetch.com/shopping/men/clothing-2/items.aspx",
      "https://www.farfetch.com/shopping/men/shoes-2/items.aspx",
      "https://www.farfetch.com/shopping/men/bags-purses-2/items.aspx",
      "https://www.farfetch.com/shopping/men/accessories-all-2/items.aspx",
      // Women L2
      "https://www.farfetch.com/shopping/women/clothing-1/items.aspx",
      "https://www.farfetch.com/shopping/women/shoes-1/items.aspx",
      "https://www.farfetch.com/shopping/women/bags-purses-1/items.aspx",
      "https://www.farfetch.com/shopping/women/accessories-all-1/items.aspx",
    ],
    notes: "Farfetch US Playwright engine. Shares src/lib/farfetch-engine.ts with KR via region:'US' (SPEC-006 user-extension 2026-05-07). USD-native cache, USD→KRW import-time conversion via SPEC-002 fx.ts hook. KR §13 ToS body applies (Farfetch /terms-and-conditions/ serves Korean text with 'currently only available in Korean' notice; same legal entity). channel:'chrome' real Chrome required, 3-sec pacing, 5-UA rotation, robots-check enforced. REQ-007/009 NOT empirically verified from KR-resident IP (geo-routing forced); production deployment from US-routable infrastructure should re-run `pnpm crawl --probe=farfetch-us`. Set disabled:true if production probe fails. portal.ai-internal-use only; halt-on-cease-and-desist.",
  },

  // ─── 4차 확장: brand_nodes 미크롤 KR 자사몰 (2026-07-02 온보딩) ───
  // 후보 선정: brand_nodes 중 origin_country=KR + wiki.homepage_url 존재 +
  // products 테이블에 brand_node_id 매칭 0건(미크롤) 브랜드를 스캔 후,
  // 실제 홈페이지가 cafe24인지(응답 HTML의 "cafe24" 시그니처) + robots.txt
  // 허용 여부를 curl로 직접 검증해서 골랐다. moif.co.kr도 후보였으나 홈페이지
  // nav가 단일 "STORE"(cate_no=256) 플랫 리스트뿐이라 타입별 카테고리를
  // 못 뽑아 제외 — goyowear로 대체.

  {
    key: "yuse",
    name: "유즈",
    type: "cafe24",
    baseUrl: "https://yuse.co.kr",
    brand: "YUSE", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    verifyStockFromDetail: true,
    // 공식 ABOUT: "여성 디자이너 브랜드" (2026-08-11 확인).
    // https://yuse.co.kr/shopinfo/company.html
    defaultGender: ["women"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 290, gender: ["women"]},
        {name: "Knitwear", cateNo: 59, gender: ["women"]},
        {name: "Outer", cateNo: 47, gender: ["women"]},
        {name: "Bottom", cateNo: 291, gender: ["women"]},
        {name: "Dress", cateNo: 28, gender: ["women"]},
        {name: "Accessories", cateNo: 43, gender: ["women"]},
      ],
    },
    notes: "공식 ABOUT의 여성 디자이너 브랜드 근거로 women. NEW/BEST/REFURB/SAMPLE SALE 등 컬렉션성 cate_no는 타입 카테고리와 중복이라 제외.",
  },
  {
    key: "ojos",
    name: "오호스",
    type: "cafe24",
    baseUrl: "https://www.ojos.kr",
    brand: "OJOS", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    defaultGender: ["women"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 260, gender: ["women"]},
        {name: "Top", cateNo: 261, gender: ["women"]},
        {name: "Dress", cateNo: 262, gender: ["women"]},
        {name: "Bottom", cateNo: 263, gender: ["women"]},
        {name: "Shoes", cateNo: 264, gender: ["women"]},
      ],
    },
    notes: "brand_nodes id=844 gender_scope 태그는 unisex였지만 wiki.category=['womenswear','streetwear']와 실제 카테고리(Dress/Skirt 포함, 남성 카테고리 없음)가 women을 가리켜 여기서는 women으로 설정.",
  },
  {
    key: "goyowear",
    name: "고요웨어",
    type: "cafe24",
    baseUrl: "https://goyowear.kr",
    brand: "GOYOWEAR", // 단일브랜드 자사몰 — DOM 브랜드 추출 실패 폴백 (.description 폴백이 "상품명 :" 숨김 라벨을 잘못 주움)
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    defaultGender: ["unisex"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 36, gender: ["unisex"]},
        {name: "Outer", cateNo: 28, gender: ["unisex"]},
        {name: "Bottom", cateNo: 38, gender: ["unisex"]},
        {name: "Shoes", cateNo: 43, gender: ["unisex"]},
        {name: "Bag", cateNo: 42, gender: ["unisex"]},
        {name: "Accessories", cateNo: 44, gender: ["unisex"]},
        {name: "Accessories", cateNo: 39, gender: ["unisex"]}, // HEAD GEAR
      ],
    },
    notes: "brand_nodes id=3841, gender_scope 비어있음, wiki.category=['menswear','womenswear','outerwear'] → unisex. 홈 nav 자체엔 타입 카테고리가 없고 /product/list.html?cate_no=29(ALL) 페이지 내부 서브필터에서 발견.",
  },

  // ─── 2026-07 브랜드 온보딩 (style_node 분류 완료된 최근 10개 중 자사몰 9개) ───
  {
    key: "taats",
    name: "타츠",
    type: "cafe24",
    baseUrl: "https://taats.co.kr",
    brand: "Taats",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Washed Pajama", cateNo: 48, gender: ["unisex"]},
        {name: "Loungewear", cateNo: 56, gender: ["unisex"]},
      ],
    },
    notes: "dry-run으로 확인된 실제 카테고리 2개(New Arrivals/Sale/Archives는 상품 목록이 아니라 제외)",
  },
  {
    key: "marun5",
    name: "마른파이브",
    type: "cafe24",
    baseUrl: "https://marun5.com",
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — dry-run에서 기본 상품 셀렉터로 상품을 못 찾음(커스텀 테마, 셀렉터 오버라이드 필요) + 홈페이지 nav에 SCHIER/FREEPLE 등 다수 서브 브랜드명 노출(멀티브랜드 이너웨어몰 가능성, 마른파이브 단독몰인지 재확인 필요). 커스텀 셀렉터 작업 + 브랜드 범위 확인 후 활성화.",
  },
  {
    key: "franksupply",
    name: "프랭크 서플라이",
    type: "cafe24",
    baseUrl: "https://franksupply.co",
    brand: "Frank Supply Co.",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outwear", cateNo: 30, gender: ["unisex"]},
        {name: "Top", cateNo: 31, gender: ["unisex"]},
        {name: "Bottom", cateNo: 34, gender: ["unisex"]},
        {name: "Acc", cateNo: 35, gender: ["unisex"]},
      ],
    },
    notes: "SHOP(24) 하위 서브카테고리 4개. ALL(29)은 중복 방지를 위해 제외",
  },
  {
    key: "nnpcs",
    name: "엔엔피스",
    type: "cafe24",
    baseUrl: "https://nnpcs.kr",
    brand: "NNPCS",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 49, gender: ["unisex"]}],
    },
    notes: "서브카테고리 없음 확인 — 단일 SHOP 피드",
  },
  {
    key: "layerproduct",
    name: "레이어 프로덕트",
    type: "cafe24",
    baseUrl: "https://layerproduct.com",
    brand: "Layer Product",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 24, gender: ["women"]}],
    },
    notes: "서브카테고리 없음 확인 — 단일 Shop 피드. Only at Layer(50)은 Shop과 중복 가능성 높아 제외",
  },
  {
    key: "piscess",
    name: "파이시스",
    type: "cafe24",
    baseUrl: "https://piscess.shop",
    brand: "PISCESS",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [{name: "All", cateNo: 42, gender: ["women"]}],
    },
    notes: "ALL(42) 단일 피드. NEW(210)/BEST(74)/X GEUNGHEE(215)는 ALL과 중복되는 컬렉션 뷰라 제외",
  },
  {
    key: "mu-row",
    name: "뮤로우",
    type: "cafe24",
    baseUrl: "https://mu-row.com",
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — dry-run(Playwright, JS 렌더링 포함)에서도 카테고리 링크 0개. 홈페이지 nav 구조가 표준 cate_no 링크가 아님 — discoverySelector 커스터마이징 또는 실제 브라우저로 직접 메뉴 구조 확인 필요.",
  },
  {
    key: "hippiedippy",
    name: "히피디피",
    type: "cafe24",
    baseUrl: "https://hippiedippy.kr",
    brand: "hippiedippy",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 46, gender: ["women"]},
        {name: "Top", cateNo: 48, gender: ["women"]},
        {name: "Dress", cateNo: 50, gender: ["women"]},
        {name: "Bag", cateNo: 51, gender: ["women"]},
        {name: "Shoes", cateNo: 52, gender: ["women"]},
        {name: "Inner", cateNo: 53, gender: ["women"]},
        {name: "Acc", cateNo: 54, gender: ["women"]},
        {name: "Pants", cateNo: 63, gender: ["women"]},
        {name: "Skirt", cateNo: 64, gender: ["women"]},
      ],
    },
    notes: "정적 HTML 파싱으로 확인된 실제 카테고리 9개(Best/New arrivals/당일발송은 상품 목록이 아니라 제외)",
  },
  {
    key: "kijiko",
    name: "키지코",
    type: "cafe24",
    baseUrl: "https://kijiko.co.kr",
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — dry-run에서 lookbook(62) 외 카테고리 링크 없음(상품 셀렉터는 13개 감지되므로 상품 자체는 존재). 실제 상품 목록 진입 경로를 브라우저로 직접 확인 필요.",
  },

  // ─── 2026-07 브랜드 온보딩 2차 배치 (style_node 분류 완료 최근 10개, id 5713~5722) ───
  {
    key: "seygun",
    name: "SEYGUN",
    type: "cafe24",
    baseUrl: "https://seygun.kr",
    brand: "SEYGUN",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Coats, Jackets", cateNo: 30, gender: ["men"]},
        {name: "Trousers", cateNo: 31, gender: ["men"]},
        {name: "Tops, Shirts", cateNo: 43, gender: ["men"]},
        {name: "Skirts", cateNo: 44, gender: ["men"]},
        {name: "Accessories", cateNo: 46, gender: ["men"]},
      ],
    },
    notes: "dry-run으로 확인된 실제 카테고리 5개(SHOP=24는 상위 all, ARCHIVES는 lookbook이라 제외). 2026-08-24: 카테고리 gender 태그가 전부 unisex로 잘못 박혀 있었음 — 실제 DB 17/17건이 men으로 해석되고 상품이 SUIT JACKET/TRENCH COAT/BLOUSON 등 남성 정장류라 men으로 정정.",
  },
  {
    key: "lelivre",
    name: "Le Livre",
    type: "cafe24",
    baseUrl: "https://lelivre.kr",
    brand: "Le Livre",
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — dry-run에서 카테고리 링크는 찾았으나(Shop=24/tops=30/bottoms=31 등) 기본 상품 셀렉터로 상품을 못 찾음(커스텀 테마, marun5와 동일 증상). 커스텀 셀렉터 작업 필요.",
  },
  {
    key: "hanahi",
    name: "HANAHI",
    type: "cafe24",
    baseUrl: "https://hanahi.kr",
    brand: "HANAHI",
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — dry-run에서 journal/lookbook(25,32) 외 실제 상품 카테고리 없음 + 기본 셀렉터로 상품 못 찾음. 커스텀 셀렉터 + 실제 진입 경로 확인 필요.",
  },
  {
    key: "teak",
    name: "TEAK",
    type: "cafe24",
    baseUrl: "https://teak.co.kr",
    brand: "TEAK",
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — dry-run(Playwright)에서도 카테고리 링크 0개. 실제 진입 경로 브라우저로 직접 확인 필요.",
  },
  {
    key: "feyre",
    name: "FEYRE",
    type: "cafe24",
    baseUrl: "https://feyre.co.kr",
    brand: "FEYRE",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    selectors: {
      productItem: 'li[id^="anchorBoxId_"]',
      productName: ".mun-prdlist__name > span:not(.mun-prdlist__name-title)",
      productPrice: '.mun-prdlist__spec-item[data-title="판매가"] > span:not(.title)',
      productImage: 'img[id^="eListPrdImage"]',
      productLink: ".mun-prdlist__thumb-link",
    },
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 30, gender: ["women"]},
        {name: "Bottom", cateNo: 31, gender: ["women"]},
        {name: "Dress", cateNo: 50, gender: ["women"]},
        {name: "Outer", cateNo: 29, gender: ["women"]},
      ],
    },
    notes: "brand_node id=5715. 공식몰 여성형 상품 설명과 커스텀 mun-prdlist 카드 DOM을 검증.",
  },
  {
    key: "demoshop",
    name: "DEMO SHOP",
    type: "cafe24",
    baseUrl: "https://demoshp.com",
    brand: "DEMO SHOP",
    paginate: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Poster", cateNo: 52, gender: ["unisex"]},
        {name: "DNA", cateNo: 54, gender: ["unisex"]},
      ],
    },
    notes: "dry-run으로 확인된 실제 카테고리 2개",
  },
  {
    key: "ccqstore",
    name: "CCQ",
    type: "shopify",
    baseUrl: "https://ccqstore.com",
    brand: "CCQ",
    defaultGender: ["unisex"],
    notes: "Shopify, /products.json 가격이 이미 KRW(예: 38000) — sourceCurrency 생략(기본값 KRW). 2026-07-06: gender_scope/wiki 미완료라 상품군(반다나/캡 등 액세서리) 기준 unisex로 시드.",
  },
  // BLOCKED — 아래 3개는 PlatformType(cafe24/shopify/uniqlo/zara/farfetch)에 없는
  // 미지원 플랫폼이라 SiteConfig 자체를 만들 수 없음(엔진 부재). 신규 파서 구현 필요:
  //   - MOROA (https://www.moroa.kr) — Sixshop(식스샵)
  //   - OUR NATION (https://our-nation.com) — Imweb
  //   - IRO Paris (https://www.iroparis.com) — Salesforce Commerce Cloud(Demandware),
  //     대형 국제 브랜드라 봇 방어도 강할 가능성

  // ─── 2026-07 브랜드 온보딩 3차 배치 (cafe24, draft — dry-run 후 manual 전환 필요) ───
  {
    key: "hamsaseyo",
    name: "HAM",
    type: "cafe24",
    baseUrl: "https://hamsaseyo.com",
    brand: "HAM",
    paginate: true,
    defaultGender: ["men"],
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요. 2026-07-06: menswear(chino/shirts 등) 확인되어 defaultGender=men 시드.",
  },
  {
    key: "lossyrow",
    name: "LOSSYROW",
    type: "cafe24",
    baseUrl: "https://lossyrow.com",
    brand: "LOSSYROW",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "samostuff",
    name: "SAMOSTUFF",
    type: "cafe24",
    baseUrl: "https://samostuff.com",
    brand: "SAMOSTUFF",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "pantrka",
    name: "PanTrKa",
    type: "cafe24",
    baseUrl: "https://www.pantrka.com",
    brand: "PanTrKa",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "kiibi",
    name: "KIIBI",
    type: "cafe24",
    baseUrl: "https://kiibi.co.kr",
    brand: "KIIBI",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "agowlife",
    name: "AGOW",
    type: "cafe24",
    baseUrl: "https://agowlife.com",
    brand: "AGOW",
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — 2026-07-06 dry-run: 기본 상품 셀렉터로 상품을 찾지 못함(커스텀 테마, 셀렉터 오버라이드 필요). 커스텀 셀렉터 작업 후 활성화.",
  },
  {
    key: "mausoleum",
    name: "MAU SOLEUM",
    type: "cafe24",
    baseUrl: "https://mausoleum.co.kr",
    brand: "MAU SOLEUM",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "editablescenario",
    name: "editable scenario",
    type: "cafe24",
    baseUrl: "https://editablescenario.com",
    brand: "editable scenario",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "enlowool",
    name: "LOWOOL",
    type: "cafe24",
    baseUrl: "https://en.lowool.com",
    brand: "LOWOOL",
    sourceCurrency: "USD",
    paginate: true,
    crawlDetails: true,
    trustedCategory: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Necklace", cateNo: 102},
        {name: "Bracelet", cateNo: 104},
        {name: "Earrings", cateNo: 113},
        {name: "Ring", cateNo: 99},
        {name: "Exclusive", cateNo: 87},
        {name: "Shop", cateNo: 61},
      ],
    },
    notes: "공식 영문몰: genderless products, USD. 상품형 하위 메뉴만 수집하고 Press/Lookbook/Offline 제외.",
  },
  {
    key: "rollingstudios",
    name: "ROLLING STUDIOS",
    type: "cafe24",
    baseUrl: "https://rollingstudios.co.kr",
    brand: "ROLLING STUDIOS",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "oryany",
    name: "ORYANY",
    type: "cafe24",
    baseUrl: "https://oryany.co.kr",
    brand: "ORYANY",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "lyjelservice",
    name: "LYJEL SERVICE",
    type: "cafe24",
    baseUrl: "https://lyjelservice.com",
    brand: "LYJEL SERVICE",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    selectors: {
      productItem: "li.mun-prdlist__item",
      productName: ".mun-prdlist__name > span:not(.mun-prdlist__name-title)",
      productPrice: ".mun-prdlist__sale",
      productImage: ".mun-prdlist__img",
      productLink: ".mun-prdlist__thumb-link",
    },
    category: {
      discovery: "manual",
      categories: [
        {name: "all", cateNo: 63, gender: ["men"]},
        {name: "all", cateNo: 70, gender: ["women"]},
      ],
    },
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "leete",
    name: "le ete",
    type: "cafe24",
    baseUrl: "https://le-ete.kr",
    brand: "le ete",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "royaloakseoul",
    name: "ROYAL OAK",
    type: "cafe24",
    baseUrl: "https://www.royaloakseoul.com",
    brand: "ROYAL OAK",
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — 2026-07-06 dry-run: 기본 상품 셀렉터로 상품을 찾지 못함(d1-wrap/d2-wrap 커스텀 테마, 셀렉터 오버라이드 필요). 커스텀 셀렉터 작업 후 활성화.",
  },
  {
    key: "kupidomovingwear",
    name: "KUPIDO",
    type: "cafe24",
    baseUrl: "https://kupido-movingwear.com",
    brand: "KUPIDO",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "jungdo",
    name: "JUNGDO",
    type: "cafe24",
    baseUrl: "https://jung-do.kr",
    brand: "JUNGDO",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "cacele",
    name: "CACELE",
    type: "cafe24",
    baseUrl: "https://ca-cele.com",
    brand: "CACELE",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "dearunknown",
    name: "dear unknown",
    type: "cafe24",
    baseUrl: "https://dearunknown.com",
    brand: "dear unknown",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "groundiam",
    name: "ground iam",
    type: "cafe24",
    baseUrl: "https://groundiam.com",
    brand: "ground iam",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "waineke",
    name: "waineke",
    type: "cafe24",
    baseUrl: "https://waineke.com",
    brand: "waineke",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "saurusgirl",
    name: "saurus2girl",
    type: "cafe24",
    baseUrl: "https://saurusgirl.com",
    brand: "saurus2girl",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "roaringrad",
    name: "ROARINGRAD",
    type: "cafe24",
    baseUrl: "https://roaringrad.com",
    brand: "ROARINGRAD",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "yearsago",
    name: "Years Ago",
    type: "cafe24",
    baseUrl: "https://yearsago.kr",
    brand: "Years Ago",
    paginate: true,
    category: {discovery: "auto"},
    // 메인 라인이 남성복이고 여성은 "Years Ago Women"/"우먼즈 캡슐 컬렉션" 으로
    // 붙은 별도 라인이다 (사이트에 MEN 카테고리 자체가 없다). 카테고리가 교차
    // 구조라 여성 라인 상품은 "상의"/"아우터" 에도 함께 걸리는데, 카테고리 유래
    // gender(engine)가 이 전역 기본값(config_default)보다 상위라 dedup merge 에서
    // women 이 이긴다 — 확인: tests/product-gender.test.ts 의 config_default 케이스.
    defaultGender: ["men"],
    notes: "3차 배치 draft — dry-run 필요. defaultGender=men (여성 라인은 카테고리로 분리됨)",
  },
  {
    key: "ceyesseoul",
    name: "ceyes",
    type: "cafe24",
    baseUrl: "https://ceyesseoul.com",
    brand: "ceyes",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "deeperthanblue",
    name: "Deeper Than Blue",
    type: "cafe24",
    baseUrl: "https://deeperthanblue.co.kr",
    brand: "Deeper Than Blue",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "hagamos",
    name: "Hagamos",
    type: "cafe24",
    baseUrl: "https://hagamos.co.kr",
    brand: "Hagamos",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "wonet",
    name: "wonet",
    type: "cafe24",
    baseUrl: "https://wonet.kr",
    brand: "wonet",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "theepel",
    name: "The Epel",
    type: "cafe24",
    baseUrl: "https://theepel.co.kr",
    brand: "The Epel",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "bergwerk",
    name: "Bergwerk Seoul",
    type: "cafe24",
    baseUrl: "https://bergwerk.kr",
    brand: "Bergwerk Seoul",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "moringaearth",
    name: "Moringa",
    type: "cafe24",
    baseUrl: "https://moringaearth.com",
    brand: "Moringa",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "nuakle",
    name: "NUAKLE",
    type: "cafe24",
    baseUrl: "https://nuakle.com",
    brand: "NUAKLE",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "cladda",
    name: "CLaddA",
    type: "cafe24",
    baseUrl: "https://cladda.kr",
    brand: "CLaddA",
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — 2026-07-06 dry-run: 기본 상품 셀렉터로 상품을 찾지 못함(커스텀 테마, 셀렉터 오버라이드 필요). 커스텀 셀렉터 작업 후 활성화.",
  },
  {
    key: "khakipoint",
    name: "KHAKIPOINT",
    type: "cafe24",
    baseUrl: "https://khakipoint.kr",
    brand: "KHAKIPOINT",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "aru",
    name: "A.R.U",
    type: "cafe24",
    baseUrl: "https://aru.co.kr",
    brand: "A.R.U",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "yahnsisi",
    name: "YAHNSISI",
    type: "cafe24",
    baseUrl: "https://yahnsisi.com",
    brand: "YAHNSISI",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "muarvo",
    name: "mu:arvo",
    type: "cafe24",
    baseUrl: "https://muarvo.com",
    brand: "mu:arvo",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "funfromfun",
    name: "FUNFROMFUN",
    type: "cafe24",
    baseUrl: "https://funfromfun.com",
    brand: "FUNFROMFUN",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "zizemuseum",
    name: "ZIZEMUSEUM",
    type: "cafe24",
    baseUrl: "https://zizemuseum.com",
    brand: "ZIZEMUSEUM",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "textureseoul",
    name: "TEXTURE SEOUL",
    type: "cafe24",
    baseUrl: "https://texture-seoul.co.kr",
    brand: "TEXTURE SEOUL",
    paginate: false,
    selectors: {
      productItem: 'li[id^="anchorBoxId_"]',
      productName: "h3.project-excerpt-title-inner",
      productPrice: ".project-excerpt-tags > .project-excerpt-tags-inner:nth-of-type(2)",
      productImage: 'img[id^="eListPrdImage"]',
      productLink: 'a[href*="/product/"]',
    },
    category: {
      discovery: "manual",
      // 이 테마는 표준 product/list.html?cate_no=N을 비워 두고 공식 pretty URL에만
      // 상품 카드를 렌더링한다. sitemap의 상위 판매 카테고리를 직접 사용한다.
      categories: [
        {name: "OUTERWEARS", cateNo: 42, url: "/category/outerwears/42/"},
        {name: "TOP", cateNo: 43, url: "/category/top/43/"},
        {name: "KNITWEARS", cateNo: 132, url: "/category/knitwears/132/"},
        {name: "BOTTOMS", cateNo: 44, url: "/category/bottoms/44/"},
        {name: "DRESSES", cateNo: 45, gender: ["women"], url: "/category/dresses/45/"},
        {name: "ACCESSORIES", cateNo: 81, url: "/category/accessories/81/"},
        {name: "本 TEXTURE", cateNo: 128, url: "/category/本-texture/128/"},
      ],
    },
    notes: "brand_node id=5596. 2026-08-12 실측: 표준 목록은 0개, 공식 pretty URL 상품 카드는 전부 OUT OF STOCK.",
  },
  {
    key: "ordes",
    name: "ORDÉS",
    type: "cafe24",
    baseUrl: "https://ordes.co.kr",
    brand: "ORDÉS",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "portraitseoul",
    name: "PORTRAITSEOUL",
    type: "cafe24",
    baseUrl: "https://portraitseoul.kr",
    brand: "PORTRAITSEOUL",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "kanari",
    name: "Kanari",
    type: "cafe24",
    baseUrl: "https://kanari.co.kr",
    brand: "Kanari",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "newrim",
    name: "NEWRIM",
    type: "cafe24",
    baseUrl: "https://newrim.co.kr",
    brand: "NEWRIM",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "parrtofficial",
    name: "PARRT",
    type: "cafe24",
    baseUrl: "https://parrtofficial.com",
    brand: "PARRT",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "dared",
    name: "DARED",
    type: "cafe24",
    baseUrl: "https://dared.kr",
    brand: "DARED",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "saengin",
    name: "SAENGIN STUDIOS",
    type: "cafe24",
    baseUrl: "https://saengin.store",
    brand: "SAENGIN STUDIOS",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "sankofapuella",
    name: "sankofa puella",
    type: "cafe24",
    baseUrl: "https://sankofapuella.kr",
    brand: "sankofa puella",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "ordinaryholiday",
    name: "ORDINARY HOLIDAY",
    type: "cafe24",
    baseUrl: "https://ordinaryholiday.co.kr",
    brand: "ORDINARY HOLIDAY",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "autumnshop",
    name: "AUTUMN",
    type: "cafe24",
    baseUrl: "https://autumnshop.kr",
    brand: "AUTUMN",
    paginate: true,
    defaultGender: ["women"],
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "birthdayeve",
    name: "Birthday Eve",
    type: "cafe24",
    baseUrl: "https://birthdayeve.kr",
    brand: "Birthday Eve",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "treemingbird",
    name: "TREEMINGBIRD",
    type: "cafe24",
    baseUrl: "https://treemingbird.com",
    brand: "TREEMINGBIRD",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "rense",
    name: "RENSE",
    type: "cafe24",
    baseUrl: "https://rense.kr",
    brand: "RENSE",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "geegee",
    name: "GEEGEE",
    type: "cafe24",
    baseUrl: "https://geegee.kr",
    brand: "GEEGEE",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "tonse",
    name: "TONSE",
    type: "cafe24",
    baseUrl: "https://tonse.kr",
    brand: "TONSE",
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — 2026-07-06 dry-run: 기본 상품 셀렉터로 상품을 찾지 못함(커스텀 테마, 셀렉터 오버라이드 필요). 커스텀 셀렉터 작업 후 활성화.",
  },
  {
    key: "miuki",
    name: "미유키 MIUKI",
    type: "cafe24",
    baseUrl: "https://miuki.kr",
    brand: "미유키 MIUKI",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "outdoorserviceworks",
    name: "outdoorservice",
    type: "cafe24",
    baseUrl: "https://outdoorservice.works",
    brand: "outdoorservice",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "rewind",
    name: "rewind",
    type: "cafe24",
    baseUrl: "https://re-wind.co.kr",
    brand: "rewind",
    paginate: true,
    category: {discovery: "auto"},
    selectors: {productPrice: ".product_price"},
    notes: "3차 배치 draft — dry-run 필요. 판매가 셀렉터가 기본 DEFAULT_SELECTORS(.price 등)와 " +
      "매칭되지 않아(테마가 .product_price/.prd_price_sale 클래스 사용) price가 null로 떨어지고, " +
      "이어서 specText 폴백이 할인판매가를 price에 대입해버려 salePrice/originalPrice가 소실되던 문제 " +
      "(2026-08-08) — .product_price 오버라이드로 원가를 정확히 잡아 할인가 비교가 제대로 되도록 수정.",
  },
  {
    key: "enseennees",
    name: "SEEN NEES",
    type: "cafe24",
    baseUrl: "https://en.seen-nees.com",
    brand: "SEEN NEES",
    paginate: true,
    crawlDetails: true,
    // 공식 홈의 현행 SHOP 상품 링크가 모두 cate_no=64에 연결된다. 자동 탐색은
    // LOOKBOOK/COLLABORATION 등 14개 메뉴를 상품 카테고리로 오인해 가격 없는
    // 과거·품절 행을 반복 수집하므로 현재 판매 카테고리만 고정한다.
    // https://en.seen-nees.com/category/shop/64/
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 64, gender: ["women"]}],
    },
    notes: "공식 현행 SHOP cate_no=64 고정. 상세 가격 관측 필수.",
  },
  {
    key: "aftrsmmr",
    name: "애프터썸머",
    type: "cafe24",
    baseUrl: "https://aftrsmmr.com",
    brand: "애프터썸머",
    paginate: true,
    defaultGender: ["women"],
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 24},
        {name: "Top", cateNo: 25},
        {name: "Bottom", cateNo: 26},
        {name: "Bag", cateNo: 28},
        {name: "Acc", cateNo: 43},
      ],
    },
    notes: "홈페이지 nav에서 실제 카테고리 5개 확인(ALL=23은 집계라 제외, LOOKBOOK=42는 상품 목록 아님). "
      + "defaultGender=women — brand_nodes.wiki.gender_source(2026-08-14, 자사몰 상품 구성 기준: blouse/lace/flower 프린트 등 여성복 다수, 남성복 지표 전무, 신뢰도 med) 근거.",
  },
  {
    key: "themysterioushotel",
    name: "THE MYSTERIOUS HOTEL",
    type: "cafe24",
    baseUrl: "https://themysterioushotel.com",
    brand: "THE MYSTERIOUS HOTEL",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "sailas",
    name: "SAILAS",
    type: "cafe24",
    baseUrl: "https://sailas.co.kr",
    brand: "SAILAS",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "nervous4031cafe24",
    name: "NERVOUS",
    type: "cafe24",
    baseUrl: "https://nervous4031.cafe24.com",
    brand: "NERVOUS",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "righeofficial",
    name: "RIGHE",
    type: "cafe24",
    baseUrl: "https://righeofficial.com",
    brand: "RIGHE",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "9999archive",
    name: "9999ARCHIVE (9999아카이브)",
    type: "cafe24",
    baseUrl: "https://9999archive.kr",
    brand: "9999ARCHIVE (9999아카이브)",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },

  // ─── 2026-07-07 브랜드 온보딩 (최신순 not_started 10개 중 표준 엔진 크롤 가능 5개) ───
  {
    key: "ballew",
    name: "Ballew",
    type: "shopify",
    baseUrl: "https://ballew.nyc",
    brand: "Ballew",
    defaultGender: ["women"],
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5724. 공식 현행 카탈로그는 여성 제품군. meta.json currency=USD.",
  },
  {
    key: "becay",
    name: "Becay",
    type: "shopify",
    baseUrl: "https://becay.store",
    brand: "Becay",
    defaultGender: ["unisex"],
    sourceCurrency: "EUR",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5725. meta.json currency=EUR. /products.json 정상.",
  },
  {
    key: "anotte",
    name: "ÄNOTTE",
    type: "cafe24",
    baseUrl: "https://anotte.kr",
    brand: "ÄNOTTE",
    defaultGender: ["women"],
    paginate: true,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "SHOP", cateNo: 23, gender: ["women"]}],
    },
    notes: "brand_node id=5723. dry-run 확인: SHOP(23) 단일 상품 피드(li[id^=anchorBoxId] 셀렉터 정상). COLLECTION(43)/EDITORIAL(45)은 lookbook이라 제외.",
  },
  {
    key: "blank03",
    name: "BLANK03",
    type: "cafe24",
    baseUrl: "https://blank03.com",
    brand: "BLANK03",
    defaultGender: ["women"],
    paginate: true,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Category A", cateNo: 50, gender: ["women"]},
        {name: "Category B", cateNo: 51, gender: ["women"]},
      ],
    },
    notes: "brand_node id=5726. 공식 Brand Story/상품 카탈로그로 여성복 브랜드 확인(2026-08-03). cate_no=50/51 상품 피드(각 14개, 셀렉터 정상). cate_no=29는 프로모션 배너라 제외. 엔진이 productUrl로 dedup하므로 겹쳐도 안전.",
  },
  {
    key: "nocle",
    name: "NOCLE",
    type: "cafe24",
    baseUrl: "https://nocle.co.kr",
    brand: "NOCLE",
    defaultGender: ["men"],
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — brand_node id=5736. curl은 200(0.25s) 정상이나 Playwright page.goto가 30s 타임아웃(6분+ 재시도해도 상품 0개) — 헤드리스 브라우저 차단/스톨. zara/farfetch처럼 channel:'chrome' 실브라우저 또는 봇 우회 필요.",
  },

  // ─── 2026-07-07 브랜드 온보딩 (최신순 not_started 20개 detect 후 표준 엔진 가능) ───
  {
    key: "birthofroyalchild",
    name: "BIRTH OF ROYAL CHILD (BORC)",
    type: "shopify",
    baseUrl: "https://birthofroyalchild.com",
    brand: "BIRTH OF ROYAL CHILD (BORC)",
    defaultGender: ["men"],
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5361. 공식 상품 이미지 대체텍스트가 Men's streetwear로 명시. meta.json currency=USD, /products.json reachable.",
  },
  {
    key: "nofaithstudios",
    name: "NO/FAITH STUDIOS",
    type: "shopify",
    baseUrl: "https://nofaithstudios.com",
    brand: "NO/FAITH STUDIOS",
    defaultGender: ["unisex"],
    sourceCurrency: "EUR",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5418. meta.json currency=EUR, /products.json reachable. detect=shopify.",
  },
  {
    key: "twojeys",
    name: "Twojeys",
    type: "shopify",
    baseUrl: "https://twojeys.com",
    brand: "Twojeys",
    // "Summer Kids"는 성인 XS~XL 의류를 포함한 캠페인명이고 Baby Blue는 색상명.
    // kids 가드에서만 이 사이트 고유 노이즈를 제거한다(상품 태그 원문은 보존).
    kidsGenderNoisePatterns: [
      /\bsummer[-\s]kids(?:[-\s]2026|[12])?\b/gi,
      /\bbaby[-\s]blue\b/gi,
      /\bbuy a lighter get the \*+boy tee\b/gi,
    ],
    sourceCurrency: "KRW",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5413. KR localization returns KRW prices from /products.json. detect=shopify.",
  },
  {
    key: "jadedldn",
    name: "Jaded London",
    type: "shopify",
    baseUrl: "https://jadedldn.com/en-kr",
    brand: "Jaded London",
    sourceCurrency: "KRW",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5757. /en-kr/products.json returns KRW prices. detect=shopify.",
  },
  {
    key: "sportyandrich",
    name: "Sporty & Rich",
    type: "shopify",
    baseUrl: "https://www.sportyandrich.com",
    brand: "Sporty & Rich",
    sourceCurrency: "KRW",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-08-03 추가: 성별 롤백 백필 대상이었으나 SiteConfig 가 없어 재크롤이
    // 불가능했다(DB 1,433행이 refresh-candidates 경로로만 들어와 있었다).
    // robots.txt 통과 확인. /products.json 은 KRW 가격을 그대로 반환한다.
    // 남녀 모두 판매하는 혼성 브랜드라 defaultGender 를 두지 않는다 — 사이트
    // 기본값을 박으면 상품 절반이 반대 성별로 적재된다. 태그에 "Unisex" 가
    // 실려 오므로 evidence 텍스트 추론이 처리한다.
    notes: "재크롤 대상(성별 백필). robots allowed 2026-08-03. 혼성 브랜드 — defaultGender 금지.",
  },
  {
    key: "a-cold-wall-2808",
    name: "A-COLD-WALL*",
    type: "shopify",
    baseUrl: "https://www.a-cold-wall.com",
    brand: "A-COLD-WALL*",
    sourceCurrency: "KRW",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-08-03 추가: sportyandrich 와 같은 사유(DB 95행, config 부재).
    // robots.txt 통과 확인. 태그에 성별 신호가 없어 카테고리 URL 근거에 의존한다 —
    // 크롤 후 수율을 측정하고, 근거가 안 나오면 defaultGender 를 넣지 말고
    // 드랍시킨다 (근거 없는 기본값 금지, gender-defaults.ts 헤더 참조).
    notes: "재크롤 대상(성별 백필). robots allowed 2026-08-03.",
  },
  {
    key: "cayl",
    name: "Cayl",
    type: "cafe24",
    baseUrl: "https://cayl.co.kr",
    brand: "Cayl",
    defaultGender: ["unisex"],
    paginate: true,
    crawlDetails: true,
    category: {discovery: "auto"},
    notes: "brand_node id=2231. detect=cafe24, gender_scope=unisex.",
  },
  {
    key: "nastyfancyclub",
    name: "FANCY CLUB",
    type: "cafe24",
    baseUrl: "https://nastyfancyclub.com",
    brand: "FANCY CLUB",
    defaultGender: ["women"],
    paginate: true,
    crawlDetails: true,
    category: {discovery: "auto"},
    notes: "brand_node id=5195. detect=cafe24, gender_scope=women.",
  },
  {
    key: "setup-exe",
    name: "SETUPEXE",
    type: "cafe24",
    baseUrl: "https://www.setup-exe.com",
    brand: "SETUPEXE",
    defaultGender: ["unisex"],
    paginate: true,
    crawlDetails: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — brand_node id=5194. detect=cafe24, gender_scope=unisex, but dry-run found 0 cate_no links on homepage. Manual category config/custom discovery needed.",
  },
  {
    key: "plasticproduct",
    name: "PLASTICPRODUCT",
    type: "cafe24",
    baseUrl: "https://plasticproduct.co.kr",
    brand: "PLASTICPRODUCT",
    defaultGender: ["unisex"],
    paginate: true,
    crawlDetails: true,
    category: {discovery: "auto"},
    notes: "brand_node id=5421. detect=cafe24, gender_scope=unisex.",
  },
  {
    key: "blackpurple",
    name: "BLACKPURPLE",
    type: "cafe24",
    baseUrl: "https://blackpurple.kr",
    brand: "BLACKPURPLE",
    defaultGender: ["unisex"],
    sourceCurrency: "USD",
    paginate: true,
    crawlDetails: true,
    category: {discovery: "auto"},
    notes: "brand_node id=5223. detect=cafe24, gender_scope=unisex.",
  },
  {
    key: "nothingeverything",
    name: "NOTHINGEVERYTHING",
    type: "cafe24",
    baseUrl: "https://nothingeverything.kr",
    brand: "NOTHINGEVERYTHING",
    defaultGender: ["women"],
    paginate: true,
    crawlDetails: true,
    category: {discovery: "auto"},
    notes: "brand_node id=5215. detect=cafe24, gender_scope=women.",
  },

  // ─── 2026-07-07 보류 (표준 엔진으로 즉시 크롤 불가, 재작업 필요) ───
  {
    key: "huelleyrose",
    name: "Huelleyrose",
    type: "shopify",
    baseUrl: "https://huelleyrose.com",
    brand: "Huelleyrose",
    disabled: true,
    notes: "BLOCKED — brand_node id=5730. meta.json currency=USD 지만 /products.json 가격이 VND 단위(예: LIANE DRESS 4,500,000). USD로 임포트하면 FX 환산이 폭주함. VND 미지원(sourceCurrency 유니온에 없음) — 통화 처리 확정 후 활성화.",
  },
  {
    key: "catalysz",
    name: "Catalysz",
    type: "shopify",
    baseUrl: "https://www.catalysz.ca",
    brand: "Catalysz",
    disabled: true,
    notes: "BLOCKED — brand_node id=5727. /products.json 401(비밀번호/봇 차단) + meta.json currency=CAD(sourceCurrency 유니온 미지원). 차단 우회 + CAD 지원 후 활성화.",
  },
  {
    key: "lsoul",
    name: "LSOUL",
    type: "cafe24",
    baseUrl: "https://lsoul.com",
    brand: "LSOUL",
    disabled: true,
    notes: "BLOCKED — brand_node id=5733. detect=custom. cafe24/shopify 시그니처 없음(products.json/meta.json/cate_no 모두 미검출) — 커스텀 테마 전용 엔진/셀렉터 필요.",
  },
  {
    key: "mael",
    name: "Maël Femme",
    type: "cafe24",
    baseUrl: "https://mael.vn",
    brand: "Maël Femme",
    disabled: true,
    notes: "BLOCKED — brand_node id=5734. detect=custom. cafe24/shopify 시그니처 없음 — 커스텀 테마 전용 엔진 필요. 베트남몰(VND) 통화 이슈도 확인 필요.",
  },
  {
    key: "sheelly",
    name: "SHEELLY",
    type: "imweb",
    baseUrl: "https://sheelly.co.kr",
    brand: "SHEELLY",
    defaultGender: ["women"],
    notes: "7월 미착수 브랜드 온보딩 — brand_node_id=5764, detect platform_family=imweb",
  },
  {
    key: "amunofficial",
    name: "AMUN",
    type: "cafe24",
    baseUrl: "https://amunofficial.kr",
    brand: "AMUN",
    disabled: true,
    notes:
      "BLOCKED — brand_node id=5763. homepage_url(amunofficial.kr)이 실제 cafe24 " +
      "몰이 아니라 다른 도메인(amuu.cafe24.com/shop2,3,4)으로 링크만 거는 랜딩 페이지 " +
      "— 카테고리 0개 검출. brand_nodes.wiki.homepage_url을 실제 몰 도메인으로 " +
      "정정하거나 shop2/3/4 중 어느 것이 정식몰인지 확인 후 활성화.",
  },
  // ─── 커스텀 브랜드 파일럿: imweb (2026-07-16) ─────────────────
  // detection.platform_family=imweb 재분류(brand-crawl detect fingerprint 확장)
  // 결과에서 robots.txt 허용 25개 선정. 카테고리는 엔진 자동 탐색(.shop-item
  // 렌더 페이지 채택). 단일브랜드 자사몰 — brand 필드 필수(브랜드명 고정 원칙).
  {
    key: "aubour",
    name: "AUBOUR",
    type: "imweb",
    baseUrl: "https://www.aubour.com",
    defaultGender: ["women"],
    brand: "AUBOUR",
    notes: "imweb 파일럿 — brand_node_id=5575, detect platform_family=imweb",
  },
  {
    key: "heretic",
    name: "HERETIC",
    type: "imweb",
    baseUrl: "https://heretic.kr",
    defaultGender: ["women"],
    brand: "HERETIC",
    notes: "imweb 파일럿 — brand_node_id=5608. 공식 스토어의 Dresses/Skirts/Blouses 카테고리로 여성복 확인(2026-08-03).",
  },
  {
    key: "questandguest",
    name: "QG",
    type: "imweb",
    baseUrl: "https://questandguest.com",
    defaultGender: ["unisex"],
    brand: "QG",
    notes: "imweb 파일럿 — brand_node_id=2459, detect platform_family=imweb",
  },
  {
    key: "differentis",
    name: "DIFFERENTIS",
    type: "imweb",
    baseUrl: "https://www.differentis.kr",
    defaultGender: ["unisex"],
    brand: "DIFFERENTIS",
    notes: "imweb 파일럿 — brand_node_id=5285, detect platform_family=imweb",
  },
  {
    key: "service-en",
    name: "604service",
    type: "imweb",
    baseUrl: "http://604service-en.com",
    defaultGender: ["unisex"],
    brand: "604service",
    sourceCurrency: "USD",
    notes: "imweb 파일럿 — brand_node_id=823, detect platform_family=imweb. 2026-07-21: 사이트 실측 currency=USD 확인 (기존엔 미설정으로 KRW 오판정 → id 605827 등 가격 오적재, crawler SPEC 수정과 함께 반영).",
  },
  {
    key: "youche-pa",
    name: "YOUCHE PRETAPORTER",
    type: "imweb",
    baseUrl: "https://youche-pa.kr",
    defaultGender: ["unisex"],
    brand: "YOUCHE PRETAPORTER",
    notes: "imweb 파일럿 — brand_node_id=5229, detect platform_family=imweb",
  },
  {
    key: "sacredt",
    name: "사크레드티",
    type: "imweb",
    baseUrl: "https://sacredt.kr",
    defaultGender: ["unisex"],
    brand: "사크레드티",
    notes: "imweb 파일럿 — brand_node_id=5233, detect platform_family=imweb",
  },
  {
    key: "noobstore",
    name: "Noobstore",
    type: "imweb",
    baseUrl: "https://www.noobstore.co.kr",
    defaultGender: ["unisex"],
    brand: "Noobstore",
    notes: "imweb 파일럿 — brand_node_id=5506, detect platform_family=imweb",
  },
  {
    key: "eonts",
    name: "Eonts",
    type: "imweb",
    baseUrl: "https://www.eonts.kr",
    defaultGender: ["unisex"],
    brand: "Eonts",
    notes: "imweb 파일럿 — brand_node_id=5290, detect platform_family=imweb",
  },
  {
    key: "bluesf",
    name: "bluesf",
    type: "imweb",
    baseUrl: "https://bluesf.kr",
    defaultGender: ["unisex"],
    brand: "bluesf",
    notes: "imweb 파일럿 — brand_node_id=5295, detect platform_family=imweb",
  },
  {
    key: "durt",
    name: "durt",
    type: "imweb",
    baseUrl: "https://durt.co.kr",
    brand: "durt",
    notes: "imweb 파일럿 — brand_node_id=5365. 공식 취급처에서 남성·여성 상품이 모두 확인돼 전역 기본값을 쓰지 않음.",
  },
  {
    key: "corebrass",
    name: "COREBRASS",
    type: "imweb",
    baseUrl: "https://corebrass.com",
    defaultGender: ["unisex"],
    brand: "COREBRASS",
    notes: "imweb 파일럿 — brand_node_id=2557, detect platform_family=imweb",
  },
  {
    key: "lost-town-supply",
    name: "Lost Town Supply",
    type: "imweb",
    baseUrl: "https://www.lost-town-supply.com",
    defaultGender: ["unisex"],
    brand: "Lost Town Supply",
    notes: "imweb 파일럿 — brand_node_id=2474, detect platform_family=imweb",
  },
  {
    key: "homly",
    name: "Homly",
    type: "imweb",
    baseUrl: "https://homly.kr",
    defaultGender: ["men"],
    brand: "Homly",
    notes: "brand_node id=2170. 공식 상세 전반이 남성 모델(174~179cm/63~67kg)과 30~34인치 하의 치수로 전개됨.",
  },
  {
    key: "monjagal",
    name: "Monja Gal",
    type: "imweb",
    baseUrl: "https://monjagal.com",
    defaultGender: ["women"],
    brand: "Monja Gal",
    notes: "imweb 파일럿 — brand_node_id=5512, detect platform_family=imweb",
  },
  {
    key: "rarseoul",
    name: "RAR",
    type: "imweb",
    baseUrl: "https://rarseoul.com",
    defaultGender: ["unisex"],
    brand: "RAR",
    notes: "imweb 파일럿 — brand_node_id=5341, detect platform_family=imweb",
  },
  // 2026-08-25 정정: 원래 `defaultGender: ["women"]` 하나였다. **틀렸다** —
  // taille.kr 은 /Menshop 과 /Womenshop 을 모두 운영하는 남녀 병행 브랜드다.
  // 그 결과 MEN 부서 상품이 통째로 여성으로 적재됐다(실측: 609행 중 414행,
  // 예 `BLANCHE COMO SHIRT INK BLACK` /171·/195 = MEN 인데 ["women"]).
  // imweb 메뉴 번호는 URL 경로 그대로이고 부서가 그 트리로 갈리므로, 메뉴를
  // 성별과 함께 고정해 상품 단위 근거(engine)로 올린다. 2026-08-25 라이브에서
  // 각 페이지의 active 브레드크럼(MEN/WOMEN > READY TO WEAR > …)으로 확인.
  //
  // 순서 주의: imweb 엔진은 상품 code 로 dedup 하고 **먼저 만난 카테고리**의
  // 이름·성별을 쓴다. 품목 메뉴를 앞에, 부서 전체 메뉴(모두 보기/새로운 컬렉션)를
  // 뒤에 둬야 category 값이 품목으로 남는다.
  // defaultGender 는 두지 않는다 — 맵에 빠진 메뉴가 생기면 조용히 한쪽 성별로
  // 세탁되는 것이 이번 사고의 원인이었다.
  {
    key: "taille",
    name: "Taille",
    type: "imweb",
    brand: "Taille",
    baseUrl: "https://taille.kr",
    category: {
      discovery: "manual",
      categories: [
        // ── MEN (/Menshop > READY TO WEAR = 170) ──
        {name: "Outer", cateNo: 172, url: "https://taille.kr/172", gender: ["men"]}, // 아우터
        {name: "Outer", cateNo: 235, url: "https://taille.kr/235", gender: ["men"]}, // 레더
        {name: "Outer", cateNo: 236, url: "https://taille.kr/236", gender: ["men"]}, // 수트
        {name: "Top", cateNo: 173, url: "https://taille.kr/173", gender: ["men"]}, // 탑
        {name: "Knitwear", cateNo: 204, url: "https://taille.kr/204", gender: ["men"]}, // 니트웨어
        {name: "Bottom", cateNo: 174, url: "https://taille.kr/174", gender: ["men"]}, // 팬츠
        {name: "Bottom", cateNo: 205, url: "https://taille.kr/205", gender: ["men"]}, // 데님
        {name: "Accessories", cateNo: 175, url: "https://taille.kr/175", gender: ["men"]}, // 액세서리
        {name: "", cateNo: 196, url: "https://taille.kr/196", gender: ["men"]}, // 에센셜
        {name: "", cateNo: 171, url: "https://taille.kr/171", gender: ["men"]}, // 새로운 컬렉션
        {name: "", cateNo: 195, url: "https://taille.kr/195", gender: ["men"]}, // 모두 보기
        // ── WOMEN (/Womenshop > READY TO WEAR = 176) ──
        {name: "Outer", cateNo: 178, url: "https://taille.kr/178", gender: ["women"]}, // 아우터
        {name: "Outer", cateNo: 237, url: "https://taille.kr/237", gender: ["women"]}, // 레더
        {name: "Top", cateNo: 179, url: "https://taille.kr/179", gender: ["women"]}, // 탑
        {name: "Knitwear", cateNo: 206, url: "https://taille.kr/206", gender: ["women"]}, // 니트웨어
        {name: "Bottom", cateNo: 180, url: "https://taille.kr/180", gender: ["women"]}, // 팬츠
        {name: "Bottom", cateNo: 207, url: "https://taille.kr/207", gender: ["women"]}, // 데님
        {name: "Accessories", cateNo: 181, url: "https://taille.kr/181", gender: ["women"]}, // 액세서리
        {name: "", cateNo: 198, url: "https://taille.kr/198", gender: ["women"]}, // 에센셜
        {name: "", cateNo: 177, url: "https://taille.kr/177", gender: ["women"]}, // 새로운 컬렉션
        {name: "", cateNo: 197, url: "https://taille.kr/197", gender: ["women"]}, // 모두 보기
      ],
    },
    notes: "imweb 파일럿 — brand_node_id=2205, detect platform_family=imweb. MEN/WOMEN 부서 병행 — 메뉴별 성별 맵 필수(2026-08-25 라이브 확인)",
  },
  {
    key: "dogmaehks",
    name: "DOGMA EHKS",
    type: "imweb",
    baseUrl: "https://dogmaehks.com",
    defaultGender: ["women"],
    brand: "DOGMA EHKS",
    notes: "imweb 파일럿 — brand_node_id=5284, detect platform_family=imweb",
  },
  {
    key: "jimilii",
    name: "jimilii",
    type: "imweb",
    baseUrl: "https://jimilii.com",
    defaultGender: ["women"],
    brand: "jimilii",
    notes: "imweb 파일럿 — brand_node_id=5316, detect platform_family=imweb",
  },
  {
    key: "amabe",
    name: "AMABE",
    type: "imweb",
    baseUrl: "http://amabe.kr",
    defaultGender: ["women"],
    brand: "AMABE",
    notes: "imweb 파일럿 — brand_node_id=5227, detect platform_family=imweb",
  },
  {
    key: "singularisca",
    name: "singularisca",
    type: "imweb",
    baseUrl: "https://singularisca.com",
    defaultGender: ["men"],
    brand: "singularisca",
    notes: "imweb 파일럿 — brand_node_id=5317, detect platform_family=imweb",
  },
  {
    key: "pulajournal",
    name: "PULA",
    type: "imweb",
    baseUrl: "https://pulajournal.com",
    defaultGender: ["women"],
    brand: "PULA",
    notes: "imweb 파일럿 — brand_node_id=5445, detect platform_family=imweb",
  },
  {
    key: "hokuspokus",
    name: "HOKUSPOKUS (호쿠스포쿠스)",
    type: "imweb",
    baseUrl: "https://www.hokuspokus.co.kr",
    defaultGender: ["women"],
    brand: "HOKUSPOKUS (호쿠스포쿠스)",
    notes: "imweb 파일럿 — brand_node_id=5511, detect platform_family=imweb",
  },
  {
    key: "minihorses",
    name: "Mini Horses",
    type: "imweb",
    baseUrl: "https://minihorses.co.kr",
    defaultGender: ["women"],
    brand: "Mini Horses",
    notes: "imweb 파일럿 — brand_node_id=5528, detect platform_family=imweb",
  },
  {
    key: "hausou",
    name: "HAUSOU",
    type: "imweb",
    baseUrl: "https://www.hausou.com",
    defaultGender: ["women"],
    brand: "HAUSOU",
    notes: "imweb 파일럿 — brand_node_id=5484, detect platform_family=imweb",
  },
  {
    key: "maziuntitled",
    name: "MAZI UNTITLED",
    type: "cafe24",
    baseUrl: "https://maziuntitled.com",
    brand: "MAZI UNTITLED",
    defaultGender: ["unisex"],
    verifiedUnisexDefault: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    trustedCategory: true,
    verifyStockFromDetail: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Bags", cateNo: 101, gender: ["unisex"]},
        {name: "Bags", cateNo: 102, gender: ["unisex"]},
        {name: "Bags", cateNo: 104, gender: ["unisex"]},
        {name: "Bags", cateNo: 105, gender: ["unisex"]},
        {name: "Bags", cateNo: 106, gender: ["unisex"]},
        {name: "Bags", cateNo: 107, gender: ["unisex"]},
        {name: "Accessories", cateNo: 109, gender: ["unisex"]},
      ],
    },
    notes: "brand_node_id=5840. Official bag catalogue; product descriptions explicitly state suitability for both men and women.",
  },
  // ── 2026-08-19 cafe24 온보딩 파일럿 (batch 1) ────────────────────────────
  // product_crawl_status 에는 있는데 platforms.ts/generated 어디에도 SiteConfig 가
  // 없어 크롤 자체가 안 되던 cafe24 사이트 64곳 중 첫 5곳. 카테고리는 전부
  // 공식 내비게이션/sitemap.xml 에서 실제 cateNo 를 읽어 수동 매핑했다 —
  // placeholder 번호를 쓰지 않는다(2026-08-18~19 gender_missing 전량 드랍 사고).
  {
    key: "omn-omnipotent",
    name: "옴니포턴트 (OMN)",
    type: "cafe24",
    baseUrl: "https://omn-omnipotent.com",
    brand: "옴니포턴트 (OMN)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 리프를 먼저 둔다 — dedupe 시 비generic 카테고리는 먼저 잡힌 쪽이
        // 남으므로(mergeCafe24DuplicateCategory), 뒤에 오는 상위 부서보다
        // 세부 타입이 살아남는다.
        {name: "Flat", cateNo: 135, gender: ["women"]},
        {name: "Boots", cateNo: 136, gender: ["women"]},
        {name: "Loafer", cateNo: 137, gender: ["women"]},
        {name: "Sandal", cateNo: 138, gender: ["women"]},
        {name: "Sneakers", cateNo: 157, gender: ["women"]},
        {name: "Heels", cateNo: 187, gender: ["women"]},
        {name: "Top Handle", cateNo: 171, gender: ["women"]},
        {name: "Small Bags", cateNo: 173, gender: ["women"]},
        {name: "Shoulder Bags", cateNo: 174, gender: ["women"]},
        {name: "Tote Bags", cateNo: 176, gender: ["women"]},
        {name: "Duffel Bags", cateNo: 177, gender: ["women"]},
        {name: "Backpack", cateNo: 178, gender: ["women"]},
        {name: "Card Holder", cateNo: 179, gender: ["women"]},
        {name: "Bifold Wallet", cateNo: 180, gender: ["women"]},
        {name: "Passport Holder", cateNo: 181, gender: ["women"]},
        {name: "Keyrings", cateNo: 182, gender: ["women"]},
        {name: "Belts", cateNo: 183, gender: ["women"]},
        {name: "Caps", cateNo: 184, gender: ["women"]},
        {name: "Socks", cateNo: 185, gender: ["women"]},
        // Re:omn SALE(192) 전용 상품 10개는 위 본 카탈로그에 없다(실측).
        {name: "Bag", cateNo: 197, gender: ["women"]},
        {name: "Shoes", cateNo: 198, gender: ["women"]},
        // 상위 부서는 리프에서 새는 상품용 catch-all (Bag 141 이 리프 합계보다 3개 많다).
        {name: "Shoes", cateNo: 55, gender: ["women"]},
        {name: "Bag", cateNo: 141, gender: ["women"]},
        {name: "Wallet", cateNo: 142, gender: ["women"]},
        {name: "Acc", cateNo: 143, gender: ["women"]},
      ],
    },
    notes: "brand_node_id=5544. 공식몰에 성별 부서가 없어 공식 취급처 카탈로그로 women 확정 — 무신사 브랜드 목록 86건 전량 '여성'(https://www.musinsa.com/brand/omnipotent). 상품 총 182건(본 카탈로그 172 + SALE 전용 10).",
  },
  {
    key: "seystudio",
    name: "SEYSTUDIO (세이스튜디오)",
    type: "cafe24",
    baseUrl: "https://seystudio.co.kr",
    brand: "SEYSTUDIO (세이스튜디오)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Bags", cateNo: 24, gender: ["women"]},
        {name: "Accessories", cateNo: 25, gender: ["women"]},
      ],
    },
    notes: "brand_node_id=5509. 공식 취급처 카탈로그로 women 확정 — 무신사 브랜드 목록 37건 전량 '여성'(https://www.musinsa.com/brand/seystudio). 부서 29(Shoulder Bag)는 24(Bags)와 상품 21건이 완전히 동일한 중복 부서라 제외했다. 58(BEST)/42(lookbook)는 부분집합이다. 상품 총 38건.",
  },
  {
    key: "visusoffice",
    name: "visus (비수스)",
    type: "cafe24",
    baseUrl: "https://visusoffice.com",
    brand: "visus (비수스)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Tops", cateNo: 44, gender: ["women"]},
        {name: "Trousers & Shorts", cateNo: 47, gender: ["women"]},
        {name: "Skirts", cateNo: 50, gender: ["women"]},
        {name: "Outer", cateNo: 62, gender: ["women"]},
        // catch-all — 위 타입 부서 합(113)에 없는 상품이 Shop/SALE 쪽에 3건 있다.
        {name: "Shop", cateNo: 51, gender: ["women"]},
        {name: "New Arrivals", cateNo: 52, gender: ["women"]},
        {name: "SALE", cateNo: 66, gender: ["women"]},
      ],
    },
    notes: "brand_node_id=5499. 공식 취급처 카탈로그로 women 확정 — 무신사 브랜드 목록 100건 전량 '여성'(https://www.musinsa.com/brand/visus). 카테고리 번호는 공식 sitemap.xml 의 /category/<slug>/<no>/ 에서 읽었다. 상품 총 116건.",
  },
  {
    key: "octette",
    name: "OCTETTE (오떼뜨)",
    type: "cafe24",
    baseUrl: "https://octette.co.kr",
    brand: "OCTETTE (오떼뜨)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Tops", cateNo: 32, gender: ["women"]},
        {name: "Pants", cateNo: 27, gender: ["women"]},
        {name: "Skirt", cateNo: 34, gender: ["women"]},
        {name: "Dress", cateNo: 37, gender: ["women"]},
        {name: "Outwears", cateNo: 29, gender: ["women"]},
        {name: "Swimwear", cateNo: 70, gender: ["women"]},
        // catch-all. SHOP(24) 1,102건이 최대 상위집합이지만 타입 부서에만 있는
        // 상품도 14건 있어 양쪽을 모두 돈다. 이름이 generic 이라 타입 라벨을 덮지 않는다.
        {name: "SHOP", cateNo: 24, gender: ["women"]},
        {name: "All", cateNo: 100, gender: ["women"]},
        {name: "New Arrivals", cateNo: 26, gender: ["women"]},
        {name: "EXCLUSIVE", cateNo: 129, gender: ["women"]},
      ],
    },
    notes: "brand_node_id=5540. 공식몰이 스스로 여성복으로 명시한다 — SHOP(24) 페이지 title '여성의류 브랜드 오떼뜨', Outwears(29) title '여성 아우터'. 무신사 브랜드 목록 100건도 전량 '여성'(https://www.musinsa.com/brand/octette). 상품 약 1,116건으로 파일럿 5곳 중 최대다. SEASON(25)/컬렉션(48·49·50·131·132·133)은 /collection/ 룩북 경로라 제외.",
  },
  {
    key: "s-sil",
    name: "SSIL",
    type: "cafe24",
    baseUrl: "https://s-sil.com",
    brand: "SSIL",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "목걸이·펜던트", cateNo: 48},
        {name: "반지", cateNo: 49},
        {name: "팔찌", cateNo: 50},
        {name: "귀걸이", cateNo: 51},
        {name: "헤어 액세서리", cateNo: 138},
        {name: "잡화", cateNo: 223},
        {name: "의류", cateNo: 242},
      ],
    },
    notes: "brand_node_id=320. defaultGender 는 gender-defaults.ts 의 기존 검증값(women)이 getSiteConfig 에서 채운다 — 여기에 중복 선언하지 않는다. 위 7개 타입 부서가 전 상품 330건을 덮는다(소재별 209/210, 라인별, 컬렉션, 프로모션 부서는 전부 부분집합임을 실측 확인).",
  },
  // ── 2026-08-20 나머지 64-5=59개 온보딩 배치 — Shopify 그룹 ──────────────
  // product_crawl_status 에 platform_type='cafe24' 로 기록돼 있었지만 실제로는
  // robots.txt("# we use Shopify as our ecommerce platform")와 /products.json
  // 응답으로 Shopify 임을 재확인했다. DB 의 platform_type 컬럼은 최초 브랜드
  // 탐지 당시의 추정치일 뿐 신뢰하지 않고 사이트별로 직접 검증했다.
  {
    key: "neweracap",
    name: "New Era",
    type: "shopify",
    baseUrl: "https://neweracap.com",
    brand: "New Era",
    genderDepartmentTagPrefixes: {men: ["gender: male"], women: ["gender: female"]},
    sourceCurrency: "USD",
    maxPages: 30,
    crawlDelay: 500,
    notes: "brand_node keys=neweracap,neweracap-226(기존 2개 중 하나로 통합). 상품 태그에 구조화된 gender: MALE/FEMALE/BOYS/KIDS 필드가 실측 확인됨(5페이지 표본 1,199 MALE·29 FEMALE·20 BOYS·2 KIDS) — kids 가드가 gender 추론보다 먼저 돌아 BOYS/KIDS 태그 상품은 자동으로 미확인 처리된다.",
  },
  {
    key: "triangl",
    name: "Triangl",
    type: "shopify",
    baseUrl: "https://triangl.com",
    brand: "Triangl",
    defaultGender: ["women"],
    sourceCurrency: "USD",
    maxPages: 20,
    crawlDelay: 500,
    notes: "brand_node_id 기존 key=triangl. 수영복 전문 브랜드 — vendor 전량 'Triangl', 상품명 표본에 남성 라인 신호 없음('MENDE' 는 색상/패턴명이지 성별 아님). cart_currency=USD 쿠키로 통화 확정.",
  },
  {
    key: "victoriabeckham",
    name: "Victoria Beckham",
    type: "shopify",
    baseUrl: "https://victoriabeckham.com",
    brand: "Victoria Beckham",
    defaultGender: ["women"],
    sourceCurrency: "GBP",
    maxPages: 40,
    crawlDelay: 500,
    notes: "brand_node 기존 key=victoriabeckham. 여성복 럭셔리 브랜드가 주력이나 상품 750건 표본에서 남성 셔츠 2건 확인 — 별도 gender 태그/컬렉션이 없어 defaultGender로 여성 처리하며 극소수 남성 라인은 오분류 감수(문서화된 한계). 통화는 homepage Shopify.currency={\"active\":\"GBP\"} 로 확정 — 가격 표본(£903 톳백)만으로는 USD로 오판할 뻔했다.",
  },
  // ── 2026-08-20 나머지 34개 gap 온보딩 — batch 1 (10개) ──────────────────
  // 원래 조사한 59개 중 27개는 이미 platforms.ts/generated에 다른 key로
  // 등록돼 있었다(domain 기준 재검증으로 발견) — 그 27개는 건드리지 않는다.
  // 그중 unaffected-2757/aakam 등 "Cat9"/"Cat13" placeholder 카테고리를 쓰는
  // 257개 사이트를 별도로 발견했으나 이번 배치 범위 밖이라 보고만 하고 방치.
  {
    key: "amiment",
    name: "AMIMENT (아미먼트)",
    type: "cafe24",
    baseUrl: "https://amiment.co.kr",
    brand: "AMIMENT (아미먼트)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 33, gender: ["women"]},
        {name: "Tops", cateNo: 36, gender: ["women"]},
        {name: "Bottoms", cateNo: 37, gender: ["women"]},
        {name: "Dress", cateNo: 38, gender: ["women"]},
        {name: "Bag & Hat", cateNo: 39, gender: ["women"]},
        {name: "Accessories", cateNo: 40, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). 공식 About: 'Amiment pursue romantic and lovely style' + Dress 카테고리·상품명(ruched-dress 등)이 여성복 스타일링 — women 확정.",
  },
  {
    key: "bohemseo",
    name: "BOHEMSEO (보헴서울)",
    type: "cafe24",
    baseUrl: "https://bohemseo.com",
    brand: "BOHEMSEO (보헴서울)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Dresses", cateNo: 77, gender: ["women"]},
        {name: "Top", cateNo: 81, gender: ["women"]},
        {name: "Shoes", cateNo: 86, gender: ["women"]},
        {name: "Bottom", cateNo: 88, gender: ["women"]},
        {name: "Acc", cateNo: 92, gender: ["women"]},
        {name: "Outwear", cateNo: 94, gender: ["women"]},
        {name: "Basic", cateNo: 96, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). Dresses 카테고리 상품명(boucle-damage-mini-dress, off-shoulder-dress 등)이 명백한 여성복 스타일링 — women 확정.",
  },
  {
    key: "conichiwabonjour",
    name: "CONICHIWA bonjour (곤니치와봉쥬르)",
    type: "cafe24",
    baseUrl: "https://conichiwabonjour.com",
    brand: "CONICHIWA bonjour (곤니치와봉쥬르)",
    defaultGender: ["men"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outwear", cateNo: 46, gender: ["men"]},
        {name: "Acc", cateNo: 48, gender: ["men"]},
        {name: "Top", cateNo: 52, gender: ["men"]},
        {name: "Bottom", cateNo: 53, gender: ["men"]},
      ],
    },
    notes: "brand_node id 없음(신규). 공식몰에 성별 부서 없음 — 무신사 취급처 표본 50건 중 남성 39·공용 6·여성 5 로 남성이 압도적 다수라 men 확정(소수 교차 판매분은 문서화된 한계로 감수).",
  },
  {
    key: "dirddy",
    name: "DIRDDY (더디)",
    type: "cafe24",
    baseUrl: "https://dirddy.com",
    brand: "DIRDDY (더디)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outerwears", cateNo: 24, gender: ["women"]},
        {name: "Tops", cateNo: 25, gender: ["women"]},
        {name: "Dresses", cateNo: 26, gender: ["women"]},
        {name: "Bottoms", cateNo: 27, gender: ["women"]},
        {name: "Accs", cateNo: 28, gender: ["women"]},
        {name: "Knits", cateNo: 50, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). Dresses 카테고리 상품명(shiny-flower-button-dress 등)이 여성복 스타일링 — women 확정.",
  },
  {
    key: "en-yuppe",
    name: "YUPPE (엽페)",
    type: "cafe24",
    baseUrl: "https://en.yuppe.co.kr",
    // brand_nodes.brand_name = "YUPPE" 정확히(괄호 한글명 없음) — 기존
    // product_crawl_status.platform_key="en-5234"→brand_node_id=5234 매칭.
    // 여기 문자열을 바꾸면 --no-new-brands 가 매칭 실패로 상품 전량 제외한다
    // (2026-08-20 batch2 1차 실측 — brand="YUPPE (엽페)"로 655건 전량 드랍).
    brand: "YUPPE",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Shop", cateNo: 164, gender: ["women"]},
        {name: "Only You", cateNo: 51, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). 공식몰 내비게이션이 극히 단순(Shop/Only You 2개뿐, 하위 부서 없음) — 무신사 취급처 표본 50건 전량 '여성'으로 women 확정.",
  },
  {
    key: "fitzray",
    name: "Fitz Ray (피츠레이)",
    type: "cafe24",
    baseUrl: "https://fitzray.world",
    brand: "Fitz Ray (피츠레이)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outerwear", cateNo: 25},
        {name: "Shirts", cateNo: 26},
        {name: "Tees", cateNo: 27},
        {name: "Lounge & Set", cateNo: 28},
        {name: "Pants", cateNo: 29},
        {name: "Denim", cateNo: 30},
        {name: "Accessories", cateNo: 31},
      ],
    },
    notes: "brand_node id 없음(신규). gender 근거 부족 — 공식몰에 성별 부서 없고, 무신사 취급처 미검색, 상품명(work-jacket/chino/hoodie/jogger)도 남녀 어느 쪽으로도 단정 못 함. defaultGender 미설정 — 상품이 드랍되더라도 틀린 성별 적재보다 낫다는 원칙(gender-defaults.ts 헤더)에 따름. 추가 조사 필요.",
  },
  {
    key: "guesskorea",
    name: "GUESS (게스코리아)",
    type: "cafe24",
    baseUrl: "https://guesskorea.com",
    // brand_nodes.brand_name = "GUESS USA" 정확히 — 기존
    // product_crawl_status.platform_key="shop-544"→brand_node_id=544 매칭.
    // brand="GUESS"로 두면 --no-new-brands 가 매칭 실패로 상품 전량 제외한다
    // (2026-08-20 batch2 1차 실측 — 1,047건 전량 드랍).
    brand: "GUESS USA",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {discovery: "auto"},
    notes: "brand_node id 없음(신규). 대형 공식 유통사 — sitemap.xml 기준 수십 개 하위부서가 있고 여성(23)/남성(24) 최상위 페이지는 페이지당 20개뿐인 큐레이션 랜딩이라 전체 카탈로그가 아니다(수동 전수 매핑 비현실적). discovery:auto 로 실제 내비 링크를 런타임 발견 — 카테고리 링크 텍스트에 '남성'/'여성'이 실측 존재(sitemap: /category/남성/126 등)해 엔진이 상품 단위 gender 근거를 만든다.",
  },
  {
    key: "merrellkorea",
    name: "Merrell (머렐코리아)",
    type: "cafe24",
    baseUrl: "https://merrellkorea.co.kr",
    brand: "Merrell",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "WOMEN", cateNo: 258, gender: ["women"]},
        {name: "MEN", cateNo: 287, gender: ["men"]},
      ],
    },
    notes: "brand_node keys=merrell,merrell-690(기존 2개 중 하나로 통합, 'Merrell 1TRL'은 별도 브랜드가 아니라 Merrell 내 라인명). 공식 대형 유통사지만 WOMEN(258)/MEN(287) 최상위 페이지가 title 자체로 부서를 명시하고(<title>WOMEN - WOMEN - 머렐 Merrell</title>) 실측 페이지네이션도 깊어(각 47~50p) 전체 카탈로그로 판단 — 두 부서만으로 충분.",
  },
  {
    key: "saucony",
    name: "Saucony (써코니)",
    type: "cafe24",
    baseUrl: "https://saucony.co.kr",
    brand: "Saucony",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {discovery: "auto"},
    selectors: {
      productItem: "div.product-item",
      productName: ".name-en",
      productPrice: ".price-info .price",
      productLink: 'a[href*="/product/detail.html"]',
    },
    notes: "brand_node id 없음(신규). 대형 공식 유통사 — sitemap.xml 에 신발 모델명(레이서/맥스/킨바라/트라이엄프/페레그린/허리케인 등) 기준 카테고리가 수십 개라 수동 매핑 비현실적. discovery:auto — 카테고리 링크 텍스트에 '여성'(150/223/45/82)·'남성'(151/222/44/81) 이 실측 존재해 엔진이 상품 단위 gender 근거를 만든다. 신형 EC 테마(div 기반, Tailwind)라 기본 셀렉터 8종이 전부 실패(li.xans-record- 기대하는데 실제는 div.product-item xans-record-) — 2026-08-20 batch2 1차 크롤에서 103개 카테고리 전량 0건으로 실측, selectors 오버라이드로 수정. 상품 카드 자체에 <div class=\"category\">WOMEN</div> 식 성별 라벨도 있어 향후 필요시 근거로 재활용 가능.",
  },
  {
    key: "halfdevilus",
    name: "Half Devil Us (하프데빌어스)",
    type: "cafe24",
    baseUrl: "https://halfdevilus.com",
    brand: "Half Devil Us (하프데빌어스)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // DEVILS 라인
        {name: "Top", cateNo: 45, gender: ["women"]},
        {name: "Bottom", cateNo: 48, gender: ["women"]},
        {name: "Knitwear", cateNo: 49, gender: ["women"]},
        {name: "Outwear", cateNo: 97, gender: ["women"]},
        {name: "Accessories", cateNo: 111, gender: ["women"]},
        {name: "Dress", cateNo: 94, gender: ["women"]},
        // HUMANS 라인 — DEVILS 와 상품 ID 완전 분리(실측 교집합 0)라 둘 다 필요.
        {name: "Top", cateNo: 58, gender: ["women"]},
        {name: "Bottom", cateNo: 59, gender: ["women"]},
        {name: "Knitwear", cateNo: 78, gender: ["women"]},
        {name: "Outwear", cateNo: 109, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). 'DEVILS'/'HUMANS'는 성별이 아니라 컨셉 라인 구분(각자 독립된 Top/Bottom/Knitwear/Outwear 부서를 가짐, 실측 교집합 0) — 무신사 취급처 표본 50건 전량 '여성'으로 women 확정.",
  },
  // ── 2026-08-20 batch 2 (23개) — batch 1 이후 나머지 gap. leereintention.com
  // 은 향/캔들 브랜드(패션 아님)로 제외.
  {
    key: "hhhuv",
    name: "HHHUV",
    type: "cafe24",
    baseUrl: "https://hhhuv.com",
    brand: "HHHUV",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outwear", cateNo: 44, gender: ["women"]},
        {name: "Top", cateNo: 45, gender: ["women"]},
        {name: "Bottom", cateNo: 46, gender: ["women"]},
        {name: "Dress", cateNo: 47, gender: ["women"]},
        {name: "Acc", cateNo: 48, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). 무신사 취급처 미검색 — Dress 전용 부서가 있는 단일 브랜드 자사몰 구조(pilot amiment/bohemseo/dirddy 와 동일 패턴)로 women 판단.",
  },
  {
    key: "hifisoundreference",
    name: "Hifisoundreference (하이파이사운드레퍼런스)",
    type: "cafe24",
    baseUrl: "https://hifisoundreference.kr",
    brand: "Hifisoundreference (하이파이사운드레퍼런스)",
    defaultGender: ["men"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 45, gender: ["men"]}],
    },
    notes: "brand_node id 없음(신규). 브랜드명은 오디오 감성이지만 실제로는 사운드시스템 문화 테마의 스트리트웨어(티셔츠/토트백/후드) — 패션 브랜드 맞음. 무신사 취급처 표본 30건 중 남성 24·여성 6 으로 men 확정(소수 교차분 감수).",
  },
  {
    key: "jichoi",
    name: "JICHOI (지초이)",
    type: "cafe24",
    baseUrl: "https://jichoi.net",
    brand: "JICHOI (지초이)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "JICHOI", cateNo: 26},
        {name: "JICHOI COMFORT", cateNo: 27},
        {name: "JX", cateNo: 28},
        {name: "JITO", cateNo: 42},
        {name: "JICHOI SCHNA", cateNo: 51},
      ],
    },
    notes: "brand_node id 없음(신규). gender 근거 부족 — 무신사 미검색, 상품명(trainer-skirt-trousers/vest/half-zip-t-shirt)도 남녀공용 테크웨어 성향이라 단정 불가. defaultGender 미설정, 추가 조사 필요.",
  },
  {
    key: "llus",
    name: "llus.studio (일루스 스튜디오)",
    type: "cafe24",
    baseUrl: "https://llus.kr",
    brand: "llus.studio (일루스 스튜디오)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 55, gender: ["women"]}],
    },
    notes: "brand_node id 없음(신규). 무신사 미검색 — 상품명(Off-Shoulder Crop Top, Shirred Tie-Waist Top)이 여성복 스타일링 — women 확정.",
  },
  {
    key: "maisoncreme",
    name: "Maison Creme (메종크림)",
    type: "cafe24",
    baseUrl: "https://maisoncreme.co.kr",
    brand: "Maison Creme (메종크림)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Skirt", cateNo: 52, gender: ["women"]},
        {name: "Knit", cateNo: 53, gender: ["women"]},
        {name: "Top", cateNo: 54, gender: ["women"]},
        {name: "Tote", cateNo: 48, gender: ["women"]},
        {name: "Shoulder", cateNo: 46, gender: ["women"]},
        {name: "Cross", cateNo: 47, gender: ["women"]},
        {name: "Backpack", cateNo: 49, gender: ["women"]},
        {name: "Eco", cateNo: 181, gender: ["women"]},
        {name: "Pouch", cateNo: 182, gender: ["women"]},
        {name: "Acc", cateNo: 51, gender: ["women"]},
      ],
    },
    selectors: {
      productName: ".mc-p-name",
      productPrice: ".mc-p-price",
    },
    notes: "대분류/중분류/소분류/상세분류 깊은 계층 구조. 무신사 취급처 표본 30건 중 29건 '여성' — women 확정. 2026-08-20 batch2 1차 실측(pretty-URL 슬러그로 수정)이 틀렸다 — 재조사 결과 cate_no=29~41(Jackets/Coats/Blazers/Tees/Shirts 등 대/중/소/상세분류 메가메뉴)는 pretty-URL이든 query-param(cate_no=)이든 전부 404, 사이트에 실제로 게시되지 않은 죽은 카테고리다. 반면 상단 플랫 내비의 cate_no=42~55/181/182/194(All/New/Best/Archive/Clothes/Skirt/Knit/Top/Acc/Bags/Tote/Shoulder/Cross/Backpack/Eco/Pouch)는 전부 query-param 그대로 200 정상 응답 — 애초에 pretty-URL 문제가 아니었다. Clothes(44)·Bags(55)는 하위 카테고리 합산 롤업이라 제외하고 리프 카테고리만 사용. 카테고리 URL을 고쳐도 여전히 0건이었던 2차 원인: 신형 테마 커스텀 클래스(.mc-p-name/.mc-p-price)가 기본 셀렉터 8종과 전부 안 맞음(li[id^=anchorBoxId] 자체는 정상 매칭) — selectors 오버라이드로 해결. 상품 URL도 /product/detail.html?product_no= 가 아니라 /product/<slug>/<no>/category/... 프리티 URL이라 productLink 기본값(a[href*=\"/product/\"] 부분 문자열 매치)이 우연히 통과했다.",
  },
  {
    key: "musedofficial",
    name: "MUSED (뮤제드)",
    type: "cafe24",
    baseUrl: "https://musedofficial.com",
    brand: "MUSED (뮤제드)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 104, gender: ["women"]}],
    },
    notes: "brand_node id 없음(신규). 무신사 미검색 — 상품명(Mused Marine Lace Dress, Everyday Sleeveless Top)과 Skirt/Dress 하위 카테고리가 여성복 — women 확정.",
  },
  {
    key: "naats",
    name: "NAATS (나츠)",
    type: "cafe24",
    baseUrl: "https://naats.co.kr",
    brand: "NAATS (나츠)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Collection", cateNo: 45, gender: ["women"]}],
    },
    notes: "brand_node id 없음(신규). 무신사 미검색 — 상품명(check-shirring-half-blouse, v-neck-sleeve-t-shirt, iris-petal)이 여성복 스타일링 — women 확정. 공식몰 내비가 시즌명(26 SUMMER)뿐이라 카테고리 단일화.",
  },
  {
    key: "nnnotnew",
    name: "NNNOTNEW (낫뉴)",
    type: "cafe24",
    baseUrl: "https://nnnotnew.com",
    brand: "NNNOTNEW (낫뉴)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 29},
        {name: "Top", cateNo: 30},
        {name: "Bottoms", cateNo: 31},
        {name: "Acc", cateNo: 26},
        {name: "Bag", cateNo: 54},
        {name: "Headwear", cateNo: 63},
      ],
    },
    notes: "brand_node id 없음(신규). gender 근거 부족 — 무신사 미검색, 상품명(basic-nn-dyed-t-shirt, sticker-t-shirt)도 남녀공용 베이직 스트리트웨어라 단정 불가. defaultGender 미설정, 추가 조사 필요.",
  },
  {
    key: "noeyeson",
    name: "Noeyesonme (노아이즈온미)",
    type: "cafe24",
    baseUrl: "https://noeyeson.me",
    brand: "Noeyesonme (노아이즈온미)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outerwear", cateNo: 24, gender: ["women"]},
        {name: "Tops", cateNo: 25, gender: ["women"]},
        {name: "Dresses", cateNo: 26, gender: ["women"]},
        {name: "Bottoms", cateNo: 27, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). 무신사 미검색 — Dress 전용 부서가 있는 단일 브랜드 자사몰 구조(pilot 과 동일 패턴)로 women 판단. 상품 목록이 JS 렌더라 상품명 직접 확인은 못 함(카테고리 구조 근거만).",
  },
  {
    key: "noregret",
    name: "NOREGRET (노리그렛)",
    type: "cafe24",
    baseUrl: "https://noregret.kr",
    brand: "NOREGRET (노리그렛)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 24},
        {name: "Top", cateNo: 25},
        {name: "Bottom", cateNo: 26},
        {name: "Acc", cateNo: 27},
      ],
    },
    notes: "brand_node id 없음(신규). defaultGender 는 gender-defaults.ts 의 기존 검증값(women, 2026-08-13~14 공식 카탈로그 검증)이 getSiteConfig 에서 채운다 — 여기에 중복 선언하지 않는다.",
  },
  {
    key: "p-aes",
    name: "PAES (페이스)",
    type: "cafe24",
    baseUrl: "https://p-aes.com",
    brand: "PAES (페이스)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Flip Flops", cateNo: 73, gender: ["women"]},
        {name: "Boots", cateNo: 78, gender: ["women"]},
        {name: "Rain Shoes", cateNo: 79, gender: ["women"]},
        {name: "Winter Boots", cateNo: 81, gender: ["women"]},
        {name: "Slides", cateNo: 88, gender: ["women"]},
        {name: "Flats", cateNo: 97, gender: ["women"]},
        {name: "Mule", cateNo: 98, gender: ["women"]},
        {name: "Mary Jane", cateNo: 99, gender: ["women"]},
        {name: "Sandals", cateNo: 101, gender: ["women"]},
        {name: "Pumps", cateNo: 110, gender: ["women"]},
        {name: "Acc", cateNo: 86, gender: ["women"]},
      ],
    },
    selectors: {
      productName: ".product_name",
      productPrice: ".original_price",
    },
    notes: "brand_node id 없음(신규). 슈즈 전문 브랜드 — Mary Jane/Mule/Pumps/Flats 는 여성화 전용 실루엣으로 women 확정. 2026-08-20 batch2 실크롤에서 전량 0건 — 원인은 swiper.js 타이밍이 아니라 신형 테마 클래스명(.product_name 언더스코어, .original_price)이 기본 셀렉터 8종과 전부 안 맞은 것(실측: ul.prdList>li 는 26개 정상 매칭, name/price 만 실패). selectors 오버라이드로 해결 — 할인가는 별도 .sale_price 클래스 기반 로직(cafe24-engine.ts price2El)이 오버라이드와 무관하게 자동 처리.",
  },
  {
    key: "pleasenofollow",
    name: "PLEASENOFOLLOW (플리즈노팔로우)",
    type: "cafe24",
    baseUrl: "https://pleasenofollow.kr",
    brand: "PLEASENOFOLLOW (플리즈노팔로우)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 25, gender: ["women"]}],
    },
    notes: "brand_node id 없음(신규). 무신사 취급처 표본 30건 전량 '여성' — women 확정.",
  },
  {
    key: "saint-james",
    name: "Saint James (세인트제임스)",
    type: "cafe24",
    baseUrl: "https://saint-james.co.kr",
    // brand_nodes.brand_name = "SANIT JAMES" (오타 그대로, 원본 등록값) —
    // 기존 product_crawl_status.platform_key="saint-james-3903"→
    // brand_node_id=3903 매칭. 오타를 고쳐 "Saint James"로 쓰면
    // --no-new-brands 가 매칭 실패로 상품 전량 제외한다(2026-08-20 batch2
    // 1차 실측 패턴과 동일). 오타 정정은 별도 brand_nodes 데이터 수정 작업.
    brand: "SANIT JAMES",
    trustedCategory: true,
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "남성", cateNo: 170, gender: ["men"]},
        {name: "여성", cateNo: 176, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). 프랑스 브랜드 공식 한국 유통사 — 공식 내비 자체가 남성(170)/여성(176)/아동(200, kids 제외)으로 명시 분리돼 있어 카테고리 단위 gender 확정.",
  },
  {
    key: "sansi",
    name: "SANSI (산시)",
    type: "cafe24",
    baseUrl: "https://sansi.co.kr",
    brand: "SANSI (산시)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 42},
        {name: "Top", cateNo: 25},
        {name: "Bottom", cateNo: 26},
        {name: "Outer", cateNo: 60},
        {name: "Top", cateNo: 61},
        {name: "Bottom", cateNo: 62},
        {name: "Outer", cateNo: 65},
        {name: "Top", cateNo: 66},
        {name: "Bottom", cateNo: 67},
        {name: "Top", cateNo: 87},
        {name: "Bottom", cateNo: 91},
        {name: "Jewelry", cateNo: 73},
        {name: "Hat", cateNo: 74},
        {name: "Acc", cateNo: 92},
      ],
    },
    notes: "brand_node id 없음(신규). gender 근거 부족 — 무신사 미검색, 상품명(slim-velvet-string-hoodie, bondage-t-shirt)도 남녀공용 그래픽 스트리트웨어라 단정 불가. defaultGender 미설정, 추가 조사 필요. Outer/Top/Bottom 이 3벌(42/25/26, 60/61/62, 65/66/67) 중복 존재 — 시즌/라인별 구분으로 추정, 전부 포함.",
  },
  {
    key: "selectedo-store",
    name: "selectedo (셀렉티도)",
    type: "cafe24",
    baseUrl: "https://selectedo-store.com",
    brand: "selectedo (셀렉티도)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Necklace", cateNo: 44},
        {name: "Bracelet", cateNo: 70},
        {name: "Anklet", cateNo: 71},
        {name: "Bodychain", cateNo: 73},
        {name: "Choker", cateNo: 78},
        {name: "Ring", cateNo: 80},
        {name: "Earring", cateNo: 81},
        {name: "Bangle", cateNo: 82},
        {name: "Etc", cateNo: 46},
      ],
    },
    notes: "brand_node id 없음(신규). 주얼리 전문 브랜드 — gender 근거 부족(무신사 미검색, 크로셰 반지 등 상품명도 결정적이지 않음). defaultGender 미설정, 추가 조사 필요.",
  },
  {
    key: "soonsuofficial",
    name: "SOONSU (순수)",
    type: "cafe24",
    baseUrl: "https://soonsuofficial.com",
    brand: "SOONSU (순수)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outerwear", cateNo: 225},
        {name: "Tops", cateNo: 226},
        {name: "Bottoms", cateNo: 227},
        {name: "Dresses", cateNo: 228},
        {name: "Acc", cateNo: 229},
        {name: "Knitwear", cateNo: 255},
      ],
    },
    notes: "brand_node id 없음(신규). defaultGender 는 gender-defaults.ts 의 기존 검증값(women, Dresses/Skirts/Swimwear 공식 카탈로그 근거)이 getSiteConfig 에서 채운다 — 여기에 중복 선언하지 않는다.",
  },
  {
    key: "surfaceedition",
    name: "SURFACE EDITION (서피스에디션)",
    type: "cafe24",
    baseUrl: "https://surfaceedition.com",
    brand: "SURFACE EDITION (서피스에디션)",
    defaultGender: ["men"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 44, gender: ["men"]},
        {name: "Top", cateNo: 45, gender: ["men"]},
        {name: "Bottom", cateNo: 46, gender: ["men"]},
        {name: "Acc/Bag", cateNo: 47, gender: ["men"]},
      ],
    },
    notes: "brand_node id 없음(신규). 무신사 취급처 표본 30건 전량 '남성' — men 확정.",
  },
  {
    key: "thescotwreck",
    name: "THE SCOT WRECK (더 스캇 렉)",
    type: "cafe24",
    baseUrl: "https://thescotwreck.com",
    brand: "THE SCOT WRECK (더 스캇 렉)",
    defaultGender: ["men"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 24, gender: ["men"]}],
    },
    notes: "brand_node id 없음(신규). 무신사 취급처 표본 30건 중 남성 16·공용 10·여성 4 로 남성이 최다 — men 확정(그래픽 스트리트웨어 특성상 교차 판매분 존재, 문서화된 한계로 감수).",
  },
  {
    key: "thomasmore",
    name: "THOMASMORE (토마스모어)",
    type: "cafe24",
    baseUrl: "https://thomasmore.co.kr",
    brand: "THOMASMORE (토마스모어)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "WOMEN", cateNo: 98, gender: ["women"]},
        {name: "MEN", cateNo: 111, gender: ["men"]},
      ],
    },
    notes: "brand_node id 없음(신규). 공식 내비 자체가 WOMEN(98)/MEN(111)/KIDS(101, 제외)으로 명시 분리 — 카테고리 단위 gender 확정.",
  },
  {
    key: "vacationspot-99",
    name: "vacation spot (베케이션스팟)",
    type: "cafe24",
    baseUrl: "https://vacationspot-99.com",
    brand: "vacation spot (베케이션스팟)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 42}],
    },
    notes: "brand_node id 없음(신규). gender 근거 부족 — 무신사 미검색, 상품이 캡·티·토트백 등 남녀공용 스트리트 베이직 위주라 단정 불가. defaultGender 미설정, 추가 조사 필요.",
  },
  {
    key: "veining",
    name: "VEINING (베이닝)",
    type: "cafe24",
    baseUrl: "https://veining.co.kr",
    brand: "VEINING (베이닝)",
    defaultGender: ["women"],
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outers", cateNo: 26, gender: ["women"]},
        {name: "Tops", cateNo: 27, gender: ["women"]},
        {name: "Bottoms", cateNo: 28, gender: ["women"]},
        {name: "Dresses", cateNo: 29, gender: ["women"]},
        {name: "Accessories", cateNo: 30, gender: ["women"]},
      ],
    },
    notes: "brand_node id 없음(신규). Dresses 카테고리 상품명(layered-sheer-volume-ruffle-dress, lace-mini-dress)이 명백한 여성복 — women 확정.",
  },
  {
    key: "whateverwewant",
    name: "Whateverwewant (왓에버위원트)",
    type: "cafe24",
    baseUrl: "https://whateverwewant.co.kr",
    brand: "Whateverwewant (왓에버위원트)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Coat", cateNo: 55},
        {name: "Cardigan", cateNo: 53},
        {name: "Hoodie", cateNo: 79},
        {name: "One-piece", cateNo: 70},
        {name: "Bag", cateNo: 46},
        {name: "Beanie", cateNo: 44},
        {name: "Muffler", cateNo: 45},
      ],
    },
    notes: "brand_node id 없음(신규). defaultGender 는 gender-defaults.ts 의 기존 검증값(men, 2026-08-13~14 공식 카탈로그 검증)이 getSiteConfig 에서 채운다 — 여기에 중복 선언하지 않는다. 공식 내비가 홈페이지 정적 크롤로는 안 잡혀 sitemap.xml 의 실제 category 슬러그로 매핑.",
  },
  {
    key: "yiyae",
    name: "Yiyae (이야에)",
    type: "cafe24",
    baseUrl: "https://yiyae.co.kr",
    brand: "Yiyae (이야에)",
    trustedCategory: true,
    paginate: true,
    maxPages: 100,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "All", cateNo: 247, gender: ["men"]}],
    },
    selectors: {
      productPrice: ".custom",
    },
    notes: "brand_node id 없음(신규). discovery:auto 가 0개였던 원인은 SPA/로그인 문제가 아니라 순수 타이밍 — 홈페이지 nav 링크(cate_no=)가 domcontentloaded+2초 대기로는 아직 안 그려지고 5초는 돼야 나타난다(엔진의 discoverCategories 는 2초 고정 대기라 항상 0개). 실측: 실제 cate_no 링크는 2개뿐 — cate_no=23('Collection', /product/campainlist.html)은 상품이 아니라 시즌 룩북(26 SPRING SUMMER 등, campain_detail.html 로 연결 — 실제 구매 가능 상품 아님)이라 제외, cate_no=247('2026', 전체상품 리스트, 39건)만 진짜 카테고리라 discovery:manual 로 고정. 가격도 기본 셀렉터 8종 전부 미스매치(.price 가 주석 처리돼 있고 실제는 <p class=\"custom\">) — selectors 오버라이드로 해결, 할인가는 <p class=\"sale\"> 가 기존 [class*=sale] 폴백 로직으로 자동 처리됨. defaultGender 는 gender-defaults.ts 의 기존 검증값(men, 2026-08-13~14 공식 카탈로그 검증)이 getSiteConfig 에서 채운다.",
  },
  {
    key: "hormoneapparel",
    name: "Hormone Apparel (호르몬)",
    type: "cafe24",
    baseUrl: "https://hormoneapparel.com",
    brand: "Hormone Apparel (호르몬)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Headwear", cateNo: 45},
        {name: "Acc", cateNo: 48},
      ],
    },
    notes: "product_crawl_status 0건 원인 실측(2026-08-20): generate-platform-configs.ts 기본 폴백 cateNo 9/13 이 이 사이트엔 실존하지 않아 매 크롤이 빈 카테고리만 반복했다. 홈페이지 nav 실측 결과 실제 cateNo 는 45(Headwear)/48(Acc) 둘뿐 — discovery:manual 로 교체. 상품 목록은 구형 li[id^=anchorBoxId] 테마라 기본 셀렉터 8종 그대로 작동(selectors 오버라이드 불필요, probe-list.ts 로 확인).",
  },
  {
    key: "backalleydream",
    name: "backalleydream",
    type: "cafe24",
    baseUrl: "https://backalleydream.com",
    brand: "backalleydream",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer Wear", cateNo: 25},
        {name: "Tops", cateNo: 27},
        {name: "Bottoms", cateNo: 28},
        {name: "Accessories", cateNo: 43},
      ],
    },
    notes: "product_crawl_status 0건 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13/42 가 이 사이트엔 실존하지 않음. 홈페이지 nav 실측으로 실제 cateNo 4개(25/27/28/43) 확인해 discovery:manual 로 교체. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "hoyeon",
    name: "호연",
    type: "cafe24",
    baseUrl: "https://hoyeon.store",
    brand: "호연",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 43},
        {name: "Top", cateNo: 44},
        {name: "Bottom", cateNo: 45},
        {name: "Dress", cateNo: 46},
        {name: "Acc", cateNo: 47},
      ],
    },
    notes: "product_crawl_status 0건 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13 이 이 사이트엔 실존하지 않음. 홈페이지 nav 실측으로 실제 leaf 카테고리 5개(43/44/45/46/47) 확인해 discovery:manual 로 교체 — cateNo=59(Best)는 다른 카테고리 상품을 다시 모아 보여주는 집계 카테고리라 중복 수집을 피하려 제외. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "neutrosin",
    name: "NEUTROSIN (뉴트로신)",
    type: "cafe24",
    baseUrl: "https://neutrosin.kr",
    brand: "NEUTROSIN (뉴트로신)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outerwear", cateNo: 44},
        {name: "Tops", cateNo: 45},
        {name: "Bottoms", cateNo: 46},
        {name: "Dresses", cateNo: 47},
        {name: "Accessories", cateNo: 48},
      ],
    },
    notes: "product_crawl_status status=qc_failed 원인 실측(2026-08-20): generate-platform-configs.ts 폴백 cateNo 9/13/23 이 사이트 리뉴얼로 전부 죽은 카테고리가 됐다(cate_no=23 은 이제 nav 브레드크럼의 'Shop' 링크일 뿐 상품 목록이 아님). 홈페이지 nav 실측으로 실제 leaf 카테고리 5개(44~48) 확인 — cateNo=42(New arrivals)/43(All) 은 다른 카테고리 상품을 재노출하는 집계 카테고리라 제외. cateNo=44(Outerwear)는 실측 시점 재고 0건이지만 실존하는 카테고리라 유지. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인) — cate_no=44 가 0개로 나온 건 셀렉터 문제가 아니라 그 카테고리가 그냥 비어 있었기 때문이었다(cate_no=43 'All' 로 재확인).",
  },
  {
    key: "centaur",
    name: "CENTAUR.KR (센토르)",
    type: "cafe24",
    baseUrl: "https://centaur.kr",
    brand: "CENTAUR.KR (센토르)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 277},
        {name: "Top", cateNo: 264},
        {name: "Bottom", cateNo: 263},
        {name: "Knit", cateNo: 262},
        {name: "Dress", cateNo: 401},
        {name: "Cap", cateNo: 276},
        {name: "Accessories", cateNo: 278},
      ],
    },
    notes: "product_crawl_status status=qc_failed 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13/30/428/281 이 사이트 리뉴얼로 전부 죽은 카테고리가 됐다. 홈페이지 nav 실측으로 실제 leaf 카테고리 7개 확인 — cateNo=432(Arrival)/259(Best)는 다른 카테고리 상품을 재노출하는 집계 카테고리라 제외. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "bnfrom",
    name: "BNFROM",
    type: "cafe24",
    baseUrl: "https://bnfrom.com",
    brand: "BNFROM",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 99},
        {name: "Top", cateNo: 94},
        {name: "Bottoms", cateNo: 95},
        {name: "Dress", cateNo: 96},
        {name: "Swimwear", cateNo: 97},
        {name: "Acc", cateNo: 98},
      ],
    },
    notes: "recollect chunk crawl/classify 실패 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13 이 이 사이트엔 실존하지 않음. 홈페이지 nav 실측으로 실제 leaf 카테고리 6개(94~99) 확인해 discovery:manual 로 교체. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "casacenido",
    name: "casacenido (까사쎄니도)",
    type: "cafe24",
    baseUrl: "https://casacenido.com",
    brand: "casacenido (까사쎄니도)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 25},
        {name: "Bottom", cateNo: 27},
        {name: "Headwear", cateNo: 45},
        {name: "Jewelry", cateNo: 28},
      ],
    },
    notes: "recollect chunk crawl/classify 실패 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13/55 이 이 사이트엔 실존하지 않음. 홈페이지 nav 실측으로 실제 leaf 카테고리 4개 확인해 discovery:manual 로 교체 — cateNo=43(All)은 다른 카테고리 상품을 재노출하는 집계 카테고리라 제외. 구형 li[id^=anchorBoxId] 테마(anyImg alt 폴백), 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "euct",
    name: "EUCT (이유씨티)",
    type: "cafe24",
    baseUrl: "https://euct.kr",
    brand: "EUCT (이유씨티)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 45},
        {name: "Top", cateNo: 46},
        {name: "Bottom", cateNo: 47},
        {name: "Acc", cateNo: 48},
      ],
    },
    notes: "recollect chunk crawl/classify 실패 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13 이 이 사이트엔 실존하지 않음. 홈페이지 nav 실측으로 실제 leaf 카테고리 4개(45~48) 확인해 discovery:manual 로 교체 — cateNo=44(New)는 다른 카테고리 상품을 재노출하는 집계 카테고리라 제외. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "teensy",
    name: "TEENSY (틴시)",
    type: "cafe24",
    baseUrl: "https://teensy.co.kr",
    brand: "TEENSY (틴시)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 25},
        {name: "Top", cateNo: 26},
        {name: "Bottom", cateNo: 27},
        {name: "Dress", cateNo: 28},
        {name: "Shoes & Bag", cateNo: 42},
        {name: "Acc", cateNo: 43},
      ],
    },
    notes: "recollect chunk crawl/classify 실패 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13/45 이 이 사이트엔 실존하지 않음. 홈페이지 nav 실측으로 실제 leaf 카테고리 6개 확인해 discovery:manual 로 교체 — cateNo=23(New in)/24(See all)는 다른 카테고리 상품을 재노출하는 집계 카테고리라 제외. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "venecy",
    name: "Venecy (벤에시)",
    type: "cafe24",
    baseUrl: "https://venecy.com",
    brand: "Venecy (벤에시)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Clothing", cateNo: 53}],
    },
    notes: "recollect chunk crawl/classify 실패 원인 실측(2026-08-20): 기본 폴백 cateNo 9/13/106 이 이 사이트엔 실존하지 않음. 홈페이지 nav 실측 결과 실제 leaf 카테고리는 Clothing(53) 하나뿐이라 discovery:manual 로 고정. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "wknd-project",
    name: "WKND Project",
    type: "cafe24",
    baseUrl: "https://wknd-project.co.kr",
    brand: "WKND Project",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 30},
        {name: "Top", cateNo: 31},
        {name: "Bottom", cateNo: 42},
        {name: "Shoes", cateNo: 104},
        {name: "Accessories", cateNo: 105},
      ],
    },
    notes: "crawl 0건 원인 실측(2026-08-20): 기존 cateNo=151(Cat151 placeholder)은 현재 nav에 없는 죽은 카테고리. 홈페이지 nav 실측으로 실제 leaf 카테고리 5개 확인해 discovery:manual 로 교체 — cateNo=128(Restock)/96(Project, 실제로는 collection.html 콘텐츠 페이지)은 제외. 단, 실측 시점(2026-08-20) 사이트 전체가 'WKND 26FW 1ST DROP 8/27(THU) OPEN' 배너를 띄운 상태라 현재 상품 대부분이 COMING SOON/품절 상태 — cateNo를 고쳐도 8/27 드롭 전까지는 크롤 결과가 여전히 0~소량일 수 있다(config 버그 아님, 재고 상태). name/price 는 구형 .name/.spec 마크업이라 기본 셀렉터로 정상 추출.",
  },
  {
    key: "en-3885",
    name: "ENZO BLUES",
    type: "cafe24",
    baseUrl: "https://en.enzoblues.com",
    brand: "ENZO BLUES",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 97},
        {name: "Top", cateNo: 98},
        {name: "Bottom", cateNo: 99},
        {name: "Dress", cateNo: 118},
        {name: "Acc", cateNo: 101},
        {name: "Bag", cateNo: 100},
      ],
    },
    selectors: {
      productItem: 'div[id^="anchorBoxId"]',
      productName: ".prdName",
      productPrice: 'li[rel="Price"]',
    },
    notes: "\"imported\" 상태였지만 실측 결과 cateNo 9/13/103 전부 죽은 값(status는 과거 정상이던 시점의 마지막 기록일 뿐, 재크롤 시점의 실제 상태를 보장하지 않는다). 홈페이지 nav 실측으로 실제 leaf 카테고리 6개(97~101,118) 확인 — cateNo=95(Shop)는 전체 재노출 집계 카테고리라 제외. 신형 EC 테마: 상품 컨테이너가 li가 아니라 div[id^=anchorBoxId]라 기본 셀렉터 9종이 전부 미스매치 — selectors 오버라이드로 해결(name은 .prdName, price는 li[rel=Price]).",
  },
  {
    key: "slyisis",
    name: "SLYISIS",
    type: "cafe24",
    baseUrl: "https://slyisis.com",
    brand: "SLYISIS",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 60},
        {name: "Tops", cateNo: 61},
        {name: "Bottoms", cateNo: 62},
        {name: "Dress", cateNo: 63},
        {name: "Acc", cateNo: 64},
        {name: "Swim", cateNo: 66},
      ],
    },
    notes: "\"imported\" 상태였지만 실측 결과 cateNo 9/13/57 전부 죽은 값. 홈페이지 nav 실측으로 실제 leaf 카테고리 6개(60~64,66) 확인해 discovery:manual 로 교체 — cateNo=58(New in)/59(View all)은 집계 카테고리라 제외. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "auber",
    name: "오베르 (AUBER)",
    type: "cafe24",
    baseUrl: "https://auber.co.kr",
    brand: "오베르 (AUBER)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Foldable Series", cateNo: 52},
        {name: "Pad Cup Series", cateNo: 78},
        {name: "Top", cateNo: 29},
        {name: "Bottom", cateNo: 30},
        {name: "Outwear", cateNo: 28},
        {name: "One & Done", cateNo: 31},
        {name: "Active", cateNo: 27},
        {name: "Swimwear", cateNo: 64},
        {name: "Acc", cateNo: 68},
      ],
    },
    notes: "\"imported\" 상태였지만 실측 결과 cateNo 9/13 전부 죽은 값. 홈페이지 nav 실측으로 실제 leaf 카테고리 9개 확인해 discovery:manual 로 교체 — cateNo=24(New arrivals)/25(Most loved)/26(All items)는 집계 카테고리라 제외. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "a82",
    name: "A82",
    type: "cafe24",
    baseUrl: "https://a82.co.kr",
    brand: "A82",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Shorts", cateNo: 43},
        {name: "Tops", cateNo: 44},
      ],
    },
    notes: "\"imported\" 상태였지만 실측 결과 cateNo 9/13/47 전부 죽은 값. 홈페이지 nav 실측으로 실제 leaf 카테고리 2개(43,44) 확인해 discovery:manual 로 교체 — cateNo=54(Best)는 집계 카테고리라 제외. 구형 li[id^=anchorBoxId] 테마(anyImg alt 폴백), 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "leface",
    name: "LEFACE",
    type: "cafe24",
    baseUrl: "https://leface.kr",
    brand: "LEFACE",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "Shop", cateNo: 24}],
    },
    notes: "\"imported\" 상태였지만 실측 결과 cateNo 9/13/43/47 전부 죽은 값. 홈페이지 nav 실측 결과 실제 leaf 카테고리는 Shop(24) 하나뿐이라 discovery:manual 로 고정. 구형 li[id^=anchorBoxId] 테마, 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "ignota",
    name: "IGNOTA (이그노타)",
    type: "cafe24",
    baseUrl: "https://ignota.kr",
    brand: "IGNOTA (이그노타)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outerwear", cateNo: 24},
        {name: "Top", cateNo: 25},
        {name: "Bottom", cateNo: 26},
        {name: "Accessories", cateNo: 46},
      ],
    },
    notes: "\"imported\" 상태였지만 실측 결과 cateNo 9/13/42 전부 죽은 값. 홈페이지 nav 실측으로 실제 leaf 카테고리 4개 확인해 discovery:manual 로 교체. 구형 li[id^=anchorBoxId] 테마(anyImg alt 폴백), 기본 셀렉터로 name/price 정상 추출(probe-list.ts 확인).",
  },
  {
    key: "acontur",
    name: "acontur",
    type: "cafe24",
    baseUrl: "https://acontur.com",
    brand: "acontur",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "GO LOOK", cateNo: 42},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "borseoul",
    name: "Bőr",
    type: "cafe24",
    baseUrl: "https://borseoul.kr",
    brand: "Bőr",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "JEWELRY", cateNo: 42},
        {name: "OBJECT", cateNo: 43},
        {name: "ACC", cateNo: 44},
        {name: "Bracelet", cateNo: 45},
        {name: "Earrings", cateNo: 46},
        {name: "Necklace", cateNo: 47},
        {name: "Ring", cateNo: 48},
        {name: "Exclusive", cateNo: 50},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "cerofar",
    name: "Cerofar",
    type: "cafe24",
    baseUrl: "https://cerofar.com",
    brand: "Cerofar",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Rings", cateNo: 30},
        {name: "Earrings", cateNo: 31},
        {name: "Necklaces", cateNo: 42},
        {name: "Item", cateNo: 46},
        {name: "Last Piece", cateNo: 65},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "dadakarada",
    name: "dadakarada (다다카라다)",
    type: "cafe24",
    baseUrl: "https://dadakarada.com",
    brand: "dadakarada (다다카라다)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Tops", cateNo: 52},
        {name: "Accessories", cateNo: 59},
        {name: "Bags", cateNo: 63},
        {name: "Lifestyles", cateNo: 64},
        {name: "Bottoms", cateNo: 67},
        {name: "Outerwear", cateNo: 68},
        {name: "Cover-up", cateNo: 70},
        {name: "EPISODE", cateNo: 71},
        {name: "△", cateNo: 75},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "dandel",
    name: "DANDEL",
    type: "cafe24",
    baseUrl: "https://dandel.kr",
    brand: "DANDEL",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "SHOP", cateNo: 45},
        {name: "Clearance!", cateNo: 49},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "einpflanzin",
    name: "einpflanzin (아인플란진)",
    type: "cafe24",
    baseUrl: "https://einpflanzin.com",
    brand: "einpflanzin (아인플란진)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outwear", cateNo: 44},
        {name: "Tops", cateNo: 45},
        {name: "Bottoms", cateNo: 46},
        {name: "Accessories", cateNo: 48},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "eireve",
    name: "Eireve",
    type: "cafe24",
    baseUrl: "https://eireve.shop",
    brand: "Eireve",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "BagCharm", cateNo: 47},
        {name: "Etc", cateNo: 80},
        {name: "HairAcc", cateNo: 124},
        {name: "Jewelry", cateNo: 125},
        {name: "Headwear", cateNo: 126},
        {name: "Neckwear", cateNo: 127},
        {name: "Clothes", cateNo: 128},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "en-5363",
    name: "SUNDAY OFF CLUB (선데이오프클럽)",
    type: "cafe24",
    baseUrl: "https://en.sundayoffclub.com",
    brand: "SUNDAY OFF CLUB (선데이오프클럽)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "OUTER", cateNo: 127},
        {name: "ARCHIVE", cateNo: 45},
        {name: "TOP", cateNo: 129},
        {name: "BOTTOM", cateNo: 130},
        {name: "ACC", cateNo: 131},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "en-5510",
    name: "subcategory (서브카테고리)",
    type: "cafe24",
    baseUrl: "https://en.sub-category.com",
    brand: "subcategory (서브카테고리)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Rain Boots", cateNo: 46},
        {name: "Subcategory Sneakers Collection", cateNo: 63},
        {name: "2023 Spring", cateNo: 88},
        {name: "2024 Summer", cateNo: 91},
        {name: "Footwear", cateNo: 100},
        {name: "2025 Summer", cateNo: 114},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "eng",
    name: "MYSTEPHENM",
    type: "cafe24",
    baseUrl: "https://eng.mystephenm.com",
    brand: "MYSTEPHENM",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "PHENOMENON", cateNo: 48},
        {name: "VOL. 4.0", cateNo: 76},
        {name: "VOL. 3.0", cateNo: 77},
        {name: "VOL. 2.5", cateNo: 78},
        {name: "VOL. 2.0", cateNo: 79},
        {name: "VOL. 1.5", cateNo: 80},
        {name: "VOL. 4.5", cateNo: 81},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "equa",
    name: "equa (에쿠아)",
    type: "cafe24",
    baseUrl: "https://equa.kr",
    brand: "equa (에쿠아)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "package", cateNo: 25},
        {name: "acc", cateNo: 27},
        {name: "core", cateNo: 43},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "everybirthday",
    name: "everybirthday",
    type: "cafe24",
    baseUrl: "https://everybirthday.co.kr",
    brand: "everybirthday",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Earring", cateNo: 26},
        {name: "Necklace", cateNo: 28},
        {name: "Ring", cateNo: 43},
        {name: "Etc", cateNo: 48},
        {name: "Obj", cateNo: 49},
        {name: "Wear", cateNo: 63},
        {name: "2025'SS KITTY CAT COLLECTION", cateNo: 73},
        {name: "2025'FW CUTE+ COLLECTION", cateNo: 74},
        {name: "2026 dig·i·tal doll COLLECTION", cateNo: 84},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "evesage",
    name: "evesage (이브세이지)",
    type: "cafe24",
    baseUrl: "https://evesage.kr",
    brand: "evesage (이브세이지)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 30},
        {name: "Top", cateNo: 31},
        {name: "Bottom", cateNo: 42},
        {name: "Dress", cateNo: 45},
        {name: "Accessories", cateNo: 46},
        {name: "25 S/S CAPSULE 1", cateNo: 64},
        {name: "25 S/S CAMPAGIN 1", cateNo: 65},
        {name: "25 SUMMER CAPSULE", cateNo: 81},
        {name: "25 SUMMER CAPSULE 2", cateNo: 84},
        {name: "25 AUTUMN CAPSULE 1", cateNo: 117},
        {name: "Bags", cateNo: 121},
        {name: "25 WINTER CAPSULE 1", cateNo: 126},
        {name: "26 SPRING CAPSULE 1", cateNo: 138},
        {name: "26 SUMMER CAPSULE 1", cateNo: 142},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "fadingmarket",
    name: "페이딩마켓",
    type: "cafe24",
    baseUrl: "https://fadingmarket.com",
    brand: "페이딩마켓",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Cat48", cateNo: 48},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "faezsix",
    name: "페이즈식스",
    type: "cafe24",
    baseUrl: "https://faezsix.com",
    brand: "페이즈식스",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Cat24", cateNo: 24},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "febor",
    name: "febor",
    type: "cafe24",
    baseUrl: "https://febor.kr",
    brand: "febor",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Earring", cateNo: 34},
        {name: "Necklace", cateNo: 35},
        {name: "Bracelet", cateNo: 43},
        {name: "Ring", cateNo: 44},
        {name: "Etc", cateNo: 45},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "housemce",
    name: "House MotComposé",
    type: "cafe24",
    baseUrl: "https://housemce.com",
    brand: "House MotComposé",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "ROOM1", cateNo: 24},
        {name: "ROOM2", cateNo: 25},
        {name: "ROOM0", cateNo: 26},
        {name: "24 Toujours en élan", cateNo: 32},
        {name: "Tokyo in November", cateNo: 50},
        {name: "Un souffle", cateNo: 57},
        {name: "Open your eyes", cateNo: 65},
        {name: "VINTAGE", cateNo: 73},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "ifeellucky",
    name: "IFEELLUCKY ARCHIVE",
    type: "cafe24",
    baseUrl: "https://ifeellucky.co.kr",
    brand: "IFEELLUCKY ARCHIVE",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "PANTS", cateNo: 29},
        {name: "TOP", cateNo: 30},
        {name: "ACC", cateNo: 31},
        {name: "OUTER", cateNo: 61},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "kaposhka",
    name: "Kaposhka",
    type: "cafe24",
    baseUrl: "https://kaposhka.com",
    brand: "Kaposhka",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Cat47", cateNo: 47},
        {name: "SHOP", cateNo: 65},
        {name: "Cat68", cateNo: 68},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "karasindustry",
    name: "KARAS INDUSTRY",
    type: "cafe24",
    baseUrl: "https://karasindustry.co.kr",
    brand: "KARAS INDUSTRY",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "SYSTEM ONLINE", cateNo: 24},
        {name: "DIVISION 01", cateNo: 29},
        {name: "COLLAB UNIT", cateNo: 49},
        {name: "DIVISION 02", cateNo: 50},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "khaksli",
    name: "KHAK",
    type: "cafe24",
    baseUrl: "https://khaksli.cafe24.com",
    brand: "KHAK",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outerwear", cateNo: 24},
        {name: "Tops", cateNo: 25},
        {name: "Bottoms", cateNo: 27},
        {name: "Accessories", cateNo: 42},
        {name: "In Progress", cateNo: 44},
        {name: "Index", cateNo: 45},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "losesleepover",
    name: "LOSESLEEPOVER",
    type: "cafe24",
    baseUrl: "https://losesleepover.kr",
    brand: "LOSESLEEPOVER",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Tops", cateNo: 48},
        {name: "Dresses", cateNo: 49},
        {name: "Skirts", cateNo: 50},
        {name: "Accessories", cateNo: 52},
        {name: "Pants", cateNo: 116},
        {name: "Outer", cateNo: 118},
        {name: "Shoes", cateNo: 119},
        {name: "25 ALL SEASON", cateNo: 124},
        {name: "More View", cateNo: 128},
        {name: "26HS SUPER \"FLOWER\" MARKET", cateNo: 148},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "new-ge",
    name: "NEW-GE",
    type: "cafe24",
    baseUrl: "https://new-ge.com",
    brand: "NEW-GE",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "TOP", cateNo: 32},
        {name: "BOTTOM", cateNo: 33},
        {name: "PANTS", cateNo: 43},
        {name: "SKIRT", cateNo: 45},
        {name: "OUTER", cateNo: 50},
        {name: "DRESS", cateNo: 54},
        {name: "ACC", cateNo: 58},
        {name: "HS 26", cateNo: 75},
        {name: "SWIMWEAR", cateNo: 76},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "nousselect",
    name: "NOUS SELECT (누셀렉)",
    type: "cafe24",
    baseUrl: "https://nousselect.com",
    brand: "NOUS SELECT (누셀렉)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "NOUS", cateNo: 24},
        {name: "쥬얼리", cateNo: 29},
        {name: "라이프", cateNo: 58},
        {name: "향수", cateNo: 81},
        {name: "가방", cateNo: 83},
        {name: "모자", cateNo: 90},
        {name: "엽서", cateNo: 91},
        {name: "모두보기", cateNo: 92},
        {name: "스카프", cateNo: 94},
        {name: "ROË", cateNo: 97},
        {name: "목걸이", cateNo: 99},
        {name: "팔찌", cateNo: 100},
        {name: "반지", cateNo: 101},
        {name: "벨트", cateNo: 102},
        {name: "키링", cateNo: 103},
        {name: "모두보기", cateNo: 104},
        {name: "귀걸이", cateNo: 106},
        {name: "후르츠키링", cateNo: 109},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "nuagehouse",
    name: "NUAGE HOUSE (누아즈하우스)",
    type: "cafe24",
    baseUrl: "https://nuagehouse.com",
    brand: "NUAGE HOUSE (누아즈하우스)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "BAG", cateNo: 24},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "oddkidoutfit",
    name: "ODDKIDOUTFIT (오드키드아웃핑)",
    type: "cafe24",
    baseUrl: "https://oddkidoutfit.com",
    brand: "ODDKIDOUTFIT (오드키드아웃핑)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Shop", cateNo: 24},
        {name: "Outers", cateNo: 25},
        {name: "Tops", cateNo: 27},
        {name: "Bottoms", cateNo: 28},
        {name: "Accessories", cateNo: 45},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "oldequalnew",
    name: "OLDEQUALNEW (올디콜뉴)",
    type: "cafe24",
    baseUrl: "https://oldequalnew.com",
    brand: "OLDEQUALNEW (올디콜뉴)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Shop", cateNo: 43},
        {name: "Archive", cateNo: 56},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "paarphy",
    name: "PAAR PHY (파르피)",
    type: "cafe24",
    baseUrl: "https://paarphy.com",
    brand: "PAAR PHY (파르피)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "SHOES", cateNo: 53},
        {name: "FLATS", cateNo: 55},
        {name: "HEELS", cateNo: 56},
        {name: "BOOTS", cateNo: 57},
        {name: "BAGS", cateNo: 59},
        {name: "SANDALS", cateNo: 73},
        {name: "LOAFERS", cateNo: 126},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "paradigmfilm",
    name: "paradigm film (패러다임 필름)",
    type: "cafe24",
    baseUrl: "https://paradigmfilm.kr",
    brand: "paradigm film (패러다임 필름)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "OUTER", cateNo: 112},
        {name: "TOP", cateNo: 114},
        {name: "BOTTOM", cateNo: 115},
        {name: "ACC", cateNo: 116},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "parentsarewatching",
    name: "Parentarewatching (PAW)",
    type: "cafe24",
    baseUrl: "https://parentsarewatching.co.kr",
    brand: "Parentarewatching (PAW)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "BOTTOMS", cateNo: 26},
        {name: "ACC", cateNo: 28},
        {name: "OUTER", cateNo: 30},
        {name: "TOPS", cateNo: 31},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "pinoki",
    name: "피노키 PINOKI",
    type: "cafe24",
    baseUrl: "https://pinoki.kr",
    brand: "피노키 PINOKI",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Shoes", cateNo: 24},
        {name: "· Lace Ups & Oxfords", cateNo: 29},
        {name: "· Loafers", cateNo: 30},
        {name: "· Moccasins & Tyrolean", cateNo: 31},
        {name: "· Sneakers", cateNo: 43},
        {name: "· Boots", cateNo: 45},
        {name: "Footwear Accessories", cateNo: 46},
        {name: "· Insoles", cateNo: 47},
        {name: "· Mules", cateNo: 51},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "pogservice",
    name: "POG : SERVICE",
    type: "cafe24",
    baseUrl: "https://pogservice.co.kr",
    brand: "POG : SERVICE",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "jewerly", cateNo: 25},
        {name: "clothes", cateNo: 45},
        {name: "acc", cateNo: 47},
        {name: "exposed core", cateNo: 59},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "seasalt",
    name: "Sea Salt",
    type: "cafe24",
    baseUrl: "https://seasalt.contact",
    brand: "Sea Salt",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "All wear", cateNo: 32},
        {name: "Book", cateNo: 51},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "shopready2wear",
    name: "R2W",
    type: "cafe24",
    baseUrl: "https://shopready2wear.com",
    brand: "R2W",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "New Arrivals", cateNo: 57},
        {name: "Preview", cateNo: 165},
        {name: "Restock", cateNo: 445},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "shopverso",
    name: "VERSO",
    type: "cafe24",
    baseUrl: "https://shopverso.kr",
    brand: "VERSO",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Clothing", cateNo: 42},
        {name: "26 Summer", cateNo: 43},
        {name: "Jewelry", cateNo: 48},
        {name: "Private", cateNo: 53},
        {name: "VERSO 26 SUMMER", cateNo: 69},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "sodinkybread",
    name: "Sodinkybread (쓸딩키브레드)",
    type: "cafe24",
    baseUrl: "https://sodinkybread.cafe24.com",
    brand: "Sodinkybread (쓸딩키브레드)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "TOP", cateNo: 55},
        {name: "BOTTOM", cateNo: 56},
        {name: "DRESS", cateNo: 57},
        {name: "ACCESSORY", cateNo: 61},
        {name: "KNITWEAR", cateNo: 67},
        {name: "26 SUMMER", cateNo: 109},
        {name: "OUTER", cateNo: 125},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "sorvetroom",
    name: "SORVETROOM",
    type: "cafe24",
    baseUrl: "https://sorvetroom.com",
    brand: "SORVETROOM",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outwear", cateNo: 43},
        {name: "Tops", cateNo: 44},
        {name: "Bottoms", cateNo: 45},
        {name: "Dresses", cateNo: 46},
        {name: "Acc", cateNo: 47},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "temporahaus",
    name: "Tempora",
    type: "cafe24",
    baseUrl: "https://temporahaus.com",
    brand: "Tempora",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "tempora", cateNo: 24},
        {name: "Outer", cateNo: 29},
        {name: "Top", cateNo: 30},
        {name: "Bottom", cateNo: 31},
        {name: "Accessories", cateNo: 42},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "tiles-house",
    name: "tiles (타일즈)",
    type: "cafe24",
    baseUrl: "https://tiles-house.com",
    brand: "tiles (타일즈)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outwear", cateNo: 25},
        {name: "Top", cateNo: 26},
        {name: "Bottom", cateNo: 27},
        {name: "Things", cateNo: 28},
        {name: "Dress", cateNo: 46},
        {name: "26 Room 006", cateNo: 54},
        {name: "26 Room 6.5", cateNo: 55},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "u-co",
    name: "U.C.O (UNICO)",
    type: "cafe24",
    baseUrl: "https://u-co.shop",
    brand: "U.C.O (UNICO)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "SELECTED", cateNo: 63},
        {name: "VINTAGE", cateNo: 64},
        {name: "JEWELLERY", cateNo: 78},
        {name: "OBJECTS", cateNo: 89},
        {name: "* ALL WATCHES 39,000 *", cateNo: 100},
        {name: "EVERYTHING", cateNo: 107},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인). 2026-08-24 재확인: batch3가 cateNo=63(SELECTED, 5페이지·상품 다수)을 누락시켰던 걸 발견해 복원 — u-co 재크롤이 계속 멈추던 문제와 연관 가능성 있어 원인 후보로도 기록.",
  },
  {
    key: "vvv-en",
    name: "VVV SOCIETY",
    type: "cafe24",
    baseUrl: "https://vvv-en.com",
    brand: "VVV SOCIETY",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "ONLINE STORE", cateNo: 50},
        {name: "26ss", cateNo: 252},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "vyl",
    name: "YYYY",
    type: "cafe24",
    baseUrl: "https://vyl.yyyystudio.com",
    brand: "YYYY",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "OUTERWEAR", cateNo: 31},
        {name: "TOPS", cateNo: 44},
        {name: "BOTTOMS", cateNo: 45},
        {name: "ACCESSORIES", cateNo: 46},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
  {
    key: "wettag",
    name: "WET TAG (웻태그)",
    type: "cafe24",
    baseUrl: "https://wettag.kr",
    brand: "WET TAG (웻태그)",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "shop", cateNo: 28},
      ],
    },
    notes: "batch3 야간 스윕(2026-08-20): 기본 폴백 cateNo 9/13 등이 죽은 값이라 qc_failed 상태였음. 홈페이지 nav + 카테고리별 실제 상품 존재 여부(li.xans-record- 등 표준 셀렉터 카운트)를 전수 실측해 discovery:manual 로 교체. 셀렉터 오버라이드 불필요(표준 폴백 체인 내에서 매칭 확인).",
  },
]

export const PLATFORMS: SiteConfig[] = [...MANUAL_PLATFORMS, ...GENERATED_PLATFORMS]

// AUTO-GENERATED 플랫폼에도 사람 검증이 필요한 kids 오탐 예외가 있다.
// generated 파일을 직접 수정하면 재생성 때 사라지므로 이 보강 맵에서 합성한다.
const SITE_KIDS_GENDER_NOISE_PATTERNS: Record<string, RegExp[]> = {
  // 공식 여성/Unisex 성인 카탈로그의 티셔츠 핏 이름이다. 실제 키즈 부서가 아니다.
  // https://lowclassic.com/product/detail.html?product_no=12094
  // https://lowclassic.com/product/detail.html?product_no=12149
  // 크롤 결과는 색상을 공백 없이 붙이기도 한다(`Baby TeeYellow`).
  lowclassic: [/\bbaby[-\s]+tee/gi],
  // 공식 옵션이 성인 S/M/L/XL인 그래픽명이며 아동복이 아니다.
  // https://eastpacifictrade.com/products/spray-boy-t-shirt-blue.js
  eastpacifictrade: [/\bspray[-\s]+boy[-\s]+t[-\s]*shirt\b/gi],
  // 공식 여성 카탈로그의 성인 티셔츠 상품형이며 실제 아동 라인은 없다.
  // https://loading-room.com/products/baby-tee-black
  "loading-room": [/\bbaby[-\s]+tee\b/gi],
  // 여성용 슬림핏 티셔츠의 상품형 이름. 실제 아동 라인은 없다.
  toomuch: [/\bbaby[-\s]?(?:t|tee|t[-\s]?shirt)\b/gi],
  // 공식 여성 컬렉션의 성인 XXS-2XL 상품에서 쓰는 색상명이다.
  // `baby pink`의 baby만으로 아동복으로 분류하면 여성 기본값이 막힌다.
  stapleandhue: [
    /\bbaby[-\s]+pink\b/gi,
  ],
  // 공식 성인 XS-XL 의류에 쓰인 색상명이라 아동복 신호에서 제외한다.
  // https://carnebollente.com/products/burn-baby-burn-baby-blue
  "carnebollente-1704": [
    /\bbaby\b/gi,
  ],
  // MARGE SHERWOOD 성인 여성 상품의 색상/Peanuts 협업명. 실제 아동 라인이 아니다.
  margesherwood: [
    /baby[-\s]?pink/gi,
    /\bsummer[-\s]girls\b/gi,
    /\bgirls[-\s]club\b/gi,
  ],
  // Cold Culture 성인 상품의 색상명/그래픽명. 실제 아동 라인은 아니다.
  coldcultureworldwide: [
    /\bbaby[-\s]+(?:blue|pink)\b/gi,
    /\b(?:good|top)[-\s]+boy\b/gi,
  ],
  // 모두 공식 성인 사이즈(XS-XXL)와 남녀 모델로 확인한 상품/컬렉션명이다.
  // 범용 baby/boy/kids 제거는 실제 아동복을 통과시키므로 확인된 조합만 좁게 제거한다.
  scuffers: [
    /\bscff[-\s]+baby\b/gi,
    /\bbaby[-\s]+tee\b/gi,
    /\bboys?[-\s]+or[-\s]+girls?\b/gi,
    /\bboys?[-\s]+(?:green|grey)[-\s]+striped[-\s]+t[-\s]?shirt\b/gi,
    /\bkids?[-\s]+(?:orange|purple|green)[-\s]+t[-\s]?shirt\b/gi,
  ],
  // threetimes 공식 여성 라인의 상품명이다. baby shower/boo는 컬렉션명이고,
  // boy short는 여성 속옷 실루엣명이므로 kids 가드에서만 제거한다.
  threetimes333: [
    /\bbaby[-\s]+(?:shower|boo)\b/gi,
    /\bboy[-\s]+short\b/gi,
  ],
  // 공식 남성 브랜드의 성인 FREE 사이즈 캡에 쓰인 그래픽/상품명이다.
  // 실제 옵션도 BLACK-FREE 단일 성인 액세서리로 확인했다.
  churchillromper: [
    /\bkids[-\s]+vintage[-\s]+5[-\s]+panel[-\s]+cap\b/gi,
  ],
}

// defaultGender=unisex는 이 목록에 공식 근거가 기록된 사이트만 허용한다.
// 성별 메뉴가 없다는 사실만으로는 여기에 추가하지 않는다.
const SITE_VERIFIED_UNISEX_DEFAULTS = new Set([
  "sport-chamber", // 공식 취급처가 의류·헤드웨어·소품을 모두 공용으로 명시
  "libere-official", // 공식 브랜드 콘텐츠가 유니섹스 패션 브랜드로 명시
  "rollingstudios", // 공식 About이 캐주얼 유니섹스 브랜드이며 모든 제품으로 범위를 명시
  "roaringrad", // 공식 취급처가 일반 RR 상품을 공용, W. 접두 별도 라인을 여성으로 명시
  "werkstatt-muenchen", // 공식 통합 주얼리 컬렉션에서 남·여 모델 착용 예시를 함께 제공
  "meller", // 동일 Nayah SKU가 공식 MEN/WOMEN 선글라스 컬렉션 양쪽에 소속
  "cayl", // 공식 의류 상세가 동일 SKU에 남·여 모델 착용 사이즈를 함께 명시
  "plasticproduct", // 공식 의류 상세가 동일 SKU에 Man/Woman 모델 착용 사이즈를 함께 명시
  "blackpurple", // 성별 구획 없는 액세서리 카탈로그와 동일 SKU의 남·여 착용자 근거
  "goyowear", // 일반 상품은 W/M 모델을 함께 명시하며 W 접두 상품만 우먼즈 예외
  "eastpacifictrade", // 공식 신발 W/M·EU 전 사이즈와 의류 상세의 Unisex 명시
  "te-ket", // 일반 상품 상세에 동일 SKU의 남·여 모델 착용 사이즈를 함께 명시
  "brand", // Bite The Bullet: 남·여 모델 착용 + 공식 상품 설명의 Unisex 명시
  "reaven", // 공식 홈페이지·Instagram 기반 2026-07-15 브랜드 리서치
  "vicinityclo", // 공식 홈페이지·Instagram 기반 2026-07-15 브랜드 리서치
  "scuffers", // 일반 상품 상세에 남녀 모델을 함께 명시하고 별도 Just Women 라인을 운영
  "enlowool", // 공식 소개에서 진주·혼합 소재를 genderless products로 명시
  "iyso", // 공식 KLOGG 설명: gender와 무관하게 everyone을 위해 제작
  "maziuntitled", // 공식 가방 설명에 남녀 모두에게 어울리는 크기로 명시
  "en-2706", // 공식 취급처가 유니섹스 슈즈 전문 브랜드로 명시
  "nomanual-shop", // 공식 브랜드 취급처의 현재 전개가 유니섹스
  "carnebollente-1704", // 공식 상품 설명의 Unisex 및 남녀 모델 착용 근거
  "ceciletulkens", // 공식 브랜드·상품 설명이 남녀를 모두 명시
  "avvattev", // 공식 AW26이 남녀 룩을 하나의 워드로브로 제시
  "sansangear-5471", // 공식 TOJI 동일 SKU에 남녀 모델 사이즈를 함께 명시
  "fandco", // 공식 상품 여러 건이 동일 헤드웨어를 him/her 모두에게 적합하다고 명시
  "luvz", // 공식 발라클라바 상세가 One size, unisex로 명시
  "worthwhilemovement", // 공식 카탈로그가 남녀공용 라인으로 전개됨
  "eriist", // 공식 카탈로그가 남녀공용 라인으로 전개됨
  "gimcontext", // 공식 카탈로그가 남녀공용 라인으로 전개됨
  "conichiwabonjour", // 공식 카탈로그가 남녀공용 라인으로 전개됨
  "sagega", // 공식 카탈로그가 남녀공용 라인으로 전개됨
])

const SITE_GENDER_DEPARTMENT_TAG_PREFIXES: Record<string, {men: string[]; women: string[]; unisex?: string[]}> = {
  // Kith 공식 Shopify 부서 태그. `wmns`는 범용 성별 사전에 없는 축약형이라
  // 사이트가 실제로 부서 태그로 쓰는 이 범위에서만 판정한다.
  kith: {men: ["mens"], women: ["wmns"]},
  // 공식 Shopify 태그: M_ACCESSORIES / W_ACCESSORIES, man_product / woman_product.
  "nude-project": {men: ["M_", "man_product"], women: ["W_", "woman_product"]},
  // 공식 Woman 컬렉션의 태그: woman, women, womanpants, womantees, ea#woman 등.
  coldcultureworldwide: {men: ["MEN"], women: ["woman", "women", "ea#woman"]},
  // woman/women/mujer/hombre는 공용 성별 사전이 처리한다. 사이트 전용 규칙은
  // 아동복이 아니라 실제 공용 컬렉션명으로 확인된 태그에만 한정한다.
  scuffers: {
    men: [],
    women: [],
    unisex: ["BOYS OR GIRLS DROP"],
  },
}

// `/products.json`에 컬렉션 소속이 빠지는 Shopify 혼성몰용 공식 근거.
// 상품 handle이 아래 공식 부서 컬렉션에 속할 때만 engine 성별을 부여한다.
const SITE_SHOPIFY_GENDER_COLLECTIONS: Record<string, NonNullable<SiteConfig["shopifyGenderCollections"]>> = {
  // 공식 편집샵의 현재 남녀 신상품 부서. 동일 handle이 양쪽에 있으면 엔진에서
  // unisex로 합치며, 레거시 복구 도구도 같은 공식 소속을 사용한다.
  // https://kith.com/collections/menswear-new-arrivals
  // https://kith.com/collections/womens-new-arrivals
  kith: {men: ["menswear-new-arrivals"], women: ["womens-new-arrivals"]},
  // https://bdgastore.com/collections/mens
  // https://bdgastore.com/collections/womens-apparel
  // https://bdgastore.com/collections/womens-footwear
  bodega: {men: ["mens"], women: ["womens-apparel", "womens-footwear"]},
  // https://www.amiparis.com/collections/women-view-all
  // https://www.amiparis.com/collections/men-view-all
  // https://www.amiparis.com/collections/unisex-ami-must-haves
  "amiparis-689": {
    women: ["women-view-all"],
    men: ["men-view-all"],
    unisex: ["unisex-ami-must-haves", "denim-unisexe"],
  },
  // https://www.camielfortgens.com/collections/shop-men
  // https://www.camielfortgens.com/collections/shop-women
  camielfortgens: {men: ["shop-men"], women: ["shop-women"]},
  // 현재 공식 시즌이 MAN/WOMAN으로 분리되어 있다.
  // https://haikure.com/collections/fw-26-man
  // https://haikure.com/collections/pre-fw-26-woman
  haikure: {
    men: ["fw-26-man", "ss-26-man"],
    women: ["pre-fw-26-woman", "pre-ss-26-woman"],
  },
  // https://ophyeyewear.com/collections/man
  // https://ophyeyewear.com/collections/woman
  // https://ophyeyewear.com/collections/unisex
  ophyeyewear: {men: ["man"], women: ["woman"], unisex: ["unisex"]},
  // 공식 Rick Owens/DRKSHDW 라인별 남녀 컬렉션.
  // https://www.rickowens.eu/collections/men-rick-owens
  // https://www.rickowens.eu/collections/rick-owens-women
  "rickowens-1997": {
    men: ["men-rick-owens", "men-drkshdw", "men-fw26-tower"],
    women: ["rick-owens-women", "line-drk-women", "all-fw25"],
  },
  // 여성 카탈로그 안의 명시적 공용 예외. 나머지는 검증된 women 기본값.
  // https://charoruiz.com/collections/unisex
  charoruiz: {unisex: ["unisex"]},
}

const SITE_GENDER_TEXT_PATTERNS: Record<string, NonNullable<SiteConfig["genderTextPatterns"]>> = {
  // 공식 취급처에서 `W.` 품번/상품명은 여성, 일반 RR 상품은 공용으로 분리된다.
  roaringrad: {women: [/^\s*W\./i]},
  // 공식 상품명이 남녀 핏을 `(m)` / `(w)`로 직접 구분한다.
  // https://nuakle.com/category/men/75/ / https://nuakle.com/category/women/74/
  nuakle: {men: [/^\s*\(m\)/i], women: [/^\s*\(w\)/i]},
  // 공식 상품명의 W 접두사는 별도 우먼즈 핏이다. 나머지는 남녀 모델을 함께 쓴다.
  goyowear: {women: [/^W(?:OMEN(?:'S)?|OMENS)?\b/i]},
  // 협업 신발처럼 상품명에 성별을 직접 명시한 예외가 있다.
  cayl: {women: [/여성/u, /\bWOMEN(?:'S)?\b/i], men: [/남성/u, /\bMEN(?:'S)?\b/i]},
  // 일반 라인은 남녀 모델이 함께 착용하지만 Women 상품은 별도 슬림핏·사이즈로 명시한다.
  "te-ket": {women: [/\bWomen\b/i]},
  // 공식 메인 컬렉션의 두 상품명이 INNERPASSION VOL.01 HER / HIM이고,
  // 각 링크도 공식몰에서 별도 HER/HIM 상세로 제공된다.
  // https://a82.co.kr/collection/list.html?cate_no=47
  a82: {women: [/\bHER\b/i], men: [/\bHIM\b/i]},
  // NOMANUAL 공식 상세 페이지가 이 상품군을 `MODEL WOMAN`으로 명시한다.
  // 범용 `baby` 아동복 방어 로직에서 여성 근거가 누락되지 않게 한다.
  "nomanual-shop": {women: [/\bBABY\s+TEE\b/i]},
}

const SITE_GENDER_MODEL_DESCRIPTION_SITES = new Set([
  // 상세 설명이 `남녀 모두`, `남성모델`/`여성모델` 라벨을 일관되게 제공한다.
  "horlisun",
  "the-nockin",
  "suade",
  // 공식 상품 설명에 Male (키): 사이즈 / Female (키): 사이즈 형식이 일관되게 존재한다.
  "coldcultureworldwide",
  // 공식 상품 설명에 `男性着用モデル`/`女性着用モデル`과 착용 사이즈를 명시한다.
  "phingerin",
  // 공식 상품 설명에 `Classic unisex fit`이 있는 상품만 제품 단위로 인식한다.
  "ihnomuhnit",
  // 폐지된 레거시 카테고리(cate_no=61)에 남은 33건이 (m)/(w) 이름 접두사도,
  // 현재 부서 카테고리(74/75)도 없어 unverified_legacy 로 남았다. 상세 페이지가
  // 상품마다 `woman model : 173cm` / `man model : 187cm` 형태로 성별을 명시한다
  // (2026-08-18 실측: crop camisole 시리즈 등). cafe24-engine 은 이 신호를
  // genderTextPatterns/카테고리 신호가 없을 때만 보강으로 쓴다.
  "nuakle",
])

// AUTO-GENERATED Cafe24 설정의 카테고리에 공식 부서 성별을 보강한다.
// generated 파일을 직접 고치면 재생성 때 사라지므로 여기서 cate_no별로 합성한다.
const SITE_CAFE24_CATEGORY_GENDERS: Record<string, Record<number, ProductGender[]>> = {
  // 공식 메뉴의 MEN/WOMEN 하위 부서.
  // https://aieul.co/
  aieul: {
    88: ["men"], 90: ["men"], 91: ["men"], 92: ["men"], 93: ["men"],
    94: ["women"], 95: ["women"], 96: ["women"], 97: ["women"], 98: ["women"],
  },
  // 현재 MEN/WOMEN 최상위와 같은 상품명의 (m)/(w) 표기로 검증한 과거 부서.
  nuakle: {
    29: ["men"], 30: ["men"], 31: ["men"], 56: ["men"], 75: ["men"],
    32: ["women"], 33: ["women"], 36: ["women"], 57: ["women"], 74: ["women"],
  },
  // 공식 메뉴가 일반 JEWELRY와 WOMEN을 분리한다. WOMEN 하위 부서 번호는
  // 현재 페이지 소스에도 보존돼 있어 일반 남성 기본값보다 먼저 적용한다.
  aekki: {
    401: ["women"], 367: ["women"], 368: ["women"], 369: ["women"],
    370: ["women"], 371: ["women"],
  },
  // 공식 내비게이션의 Lc/LOW CLASSIC Unisex 부서.
  // https://lowclassic.com/product/lc-list.html?cate_no=467
  // https://lowclassic.com/product/lc-list.html?cate_no=468
  lowclassic: {467: ["unisex"], 468: ["unisex"]},
  // 공식 MAN/WOMAN 최상위 부서. 상세의 명시적 남녀공용 문구가 더 우선한다.
  suade: {24: ["men"], 83: ["women"]},
  // 공식 SHOP 내 WOMEN 전용 부서. 나머지 SHOP은 일괄 성별을 가정하지 않는다.
  not4nerd: {88: ["women"]},
  // 2026-08 이전 공식 메뉴의 WOMEN/MEN 부서 번호. 같은 product_no가 양쪽에
  // 동시에 실린 상품은 repair 도구가 두 근거를 합쳐 unisex로 판정한다.
  // https://theinnrs.com/ (공식 메뉴 및 검색 캐시의 breadcrumb)
  theinnrs: {
    30: ["women"], 29: ["women"], 139: ["women"], 31: ["women"],
    46: ["women"], 47: ["women"], 161: ["women"], 43: ["women"],
    45: ["women"], 146: ["women"],
    48: ["men"], 33: ["men"], 49: ["men"], 50: ["men"],
    51: ["men"], 151: ["men"],
    167: ["unisex"], 168: ["unisex"], 169: ["unisex"], 180: ["unisex"],
  },
}

// generated 설정을 다시 만들더라도 유지돼야 하는, 공식몰 전체 상품군 기본값.
const SITE_DEFAULT_CATEGORIES: Record<string, string> = {
  // 공식 About이 FANE을 가방 라인으로 명시한다. BRA/LOGE/LISSE/MIE는 가방 모델명이다.
  // https://www.faneofficiel.fr/pages/about
  faneofficiel: "bags",
  // 공식몰 전체가 헤드웨어 상품군으로 구성된다.
  // https://fandco.co.nz/collections/all-headwear
  fandco: "headwear",
  // 공식몰 전체가 발라클라바 단일 상품군이다.
  // https://www.luvz.ch/collections/all
  luvz: "headwear",
}

// 목록 템플릿이 모든 상품에 품절 아이콘을 렌더링하지만 상세 옵션에는 실제 재고가 있는 사이트.
const SITE_CAFE24_DETAIL_STOCK_SITES = new Set([
  "opening-project",
  // Listing cards do not reliably expose sold-out state; product options do.
  "wouldbe",
])

/** key로 사이트 설정 조회 */
export function getSiteConfig(key: string): SiteConfig | undefined {
  const config = PLATFORMS.find((p) => p.key === key)
  if (!config) return undefined
  // 사이트가 자체 defaultGender 를 갖고 있으면 그대로 둔다. 없을 때만
  // 사람이 검증한 보강 맵에서 채운다 — platforms.generated.ts 는
  // AUTO-GENERATED 라 여기에 값을 넣을 수 없기 때문이다.
  // 근거 규칙은 src/configs/gender-defaults.ts 헤더 참조.
  const fallback = config.defaultGender && config.defaultGender.length > 0
    ? config.defaultGender
    : SITE_GENDER_DEFAULTS[key]
  const kidsGenderNoisePatterns = SITE_KIDS_GENDER_NOISE_PATTERNS[key] ?? config.kidsGenderNoisePatterns
  const verifiedUnisexDefault = SITE_VERIFIED_UNISEX_DEFAULTS.has(key) || config.verifiedUnisexDefault
  const genderDepartmentTagPrefixes = SITE_GENDER_DEPARTMENT_TAG_PREFIXES[key] ?? config.genderDepartmentTagPrefixes
  const shopifyGenderCollections = SITE_SHOPIFY_GENDER_COLLECTIONS[key] ?? config.shopifyGenderCollections
  const genderTextPatterns = SITE_GENDER_TEXT_PATTERNS[key] ?? config.genderTextPatterns
  const genderFromModelDescription = SITE_GENDER_MODEL_DESCRIPTION_SITES.has(key) || config.genderFromModelDescription
  const defaultCategory = SITE_DEFAULT_CATEGORIES[key] ?? config.defaultCategory
  const verifyStockFromDetail = SITE_CAFE24_DETAIL_STOCK_SITES.has(key) || config.verifyStockFromDetail
  const categoryGenders = SITE_CAFE24_CATEGORY_GENDERS[key]
  const category = categoryGenders
    ? (() => {
        const existing = config.category && "categories" in config.category
          ? config.category.categories ?? []
          : []
        const existingNumbers = new Set(existing.map(({cateNo}) => cateNo))
        return {
          discovery: "manual" as const,
          categories: [
            ...existing.map((entry) => ({
              ...entry,
              ...(categoryGenders[entry.cateNo] ? {gender: categoryGenders[entry.cateNo]} : {}),
            })),
            ...Object.entries(categoryGenders)
              .map(([cateNo, gender]) => ({cateNo: Number(cateNo), gender}))
              .filter(({cateNo}) => !existingNumbers.has(cateNo))
              .map((entry) => ({name: `OfficialGender${entry.cateNo}`, ...entry})),
          ],
        }
      })()
    : config.category
  if (
    fallback === config.defaultGender
    && kidsGenderNoisePatterns === config.kidsGenderNoisePatterns
    && verifiedUnisexDefault === config.verifiedUnisexDefault
    && genderDepartmentTagPrefixes === config.genderDepartmentTagPrefixes
    && shopifyGenderCollections === config.shopifyGenderCollections
    && genderTextPatterns === config.genderTextPatterns
    && genderFromModelDescription === config.genderFromModelDescription
    && defaultCategory === config.defaultCategory
    && verifyStockFromDetail === config.verifyStockFromDetail
    && category === config.category
  ) return config
  return {
    ...config,
    ...(fallback ? {defaultGender: fallback} : {}),
    ...(kidsGenderNoisePatterns ? {kidsGenderNoisePatterns} : {}),
    ...(verifiedUnisexDefault ? {verifiedUnisexDefault: true} : {}),
    ...(genderDepartmentTagPrefixes ? {genderDepartmentTagPrefixes} : {}),
    ...(shopifyGenderCollections ? {shopifyGenderCollections} : {}),
    ...(genderTextPatterns ? {genderTextPatterns} : {}),
    ...(genderFromModelDescription ? {genderFromModelDescription: true} : {}),
    ...(defaultCategory ? {defaultCategory} : {}),
    ...(verifyStockFromDetail ? {verifyStockFromDetail: true} : {}),
    ...(category !== config.category ? {category} : {}),
  }
}

/** 활성화된 사이트만 반환 */
export function getActivePlatforms(): SiteConfig[] {
  return PLATFORMS.filter((p) => !p.disabled)
}

/** 타입별 필터 */
export function getPlatformsByType(type: SiteConfig["type"]): SiteConfig[] {
  return getActivePlatforms().filter((p) => p.type === type)
}
