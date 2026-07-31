/**
 * 크롤링 대상 플랫폼 설정
 *
 * 새 사이트 추가: 이 배열에 SiteConfig 객체만 추가하면 됨
 * Cafe24 사이트는 대부분 기본 셀렉터로 동작 — 안 되면 selectors 오버라이드
 */

import type {SiteConfig} from "../lib/types"
import {GENERATED_PLATFORMS} from "./platforms.generated"

export const MANUAL_PLATFORMS: SiteConfig[] = [
  // ─── Manual 설정 완료 (카테고리 구조 깔끔) ─────────

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
        {name: "Outer", cateNo: 450},
        {name: "Top", cateNo: 451},
        {name: "Knitwear", cateNo: 689},
        {name: "Bottom", cateNo: 460},
        {name: "Dress", cateNo: 465},
        {name: "Shoes", cateNo: 466},
        {name: "Bag", cateNo: 467},
        {name: "Accessories", cateNo: 469},
        // Men
        {name: "Outer", cateNo: 490},
        {name: "Top", cateNo: 491},
        {name: "Shirts", cateNo: 493},
        {name: "Knitwear", cateNo: 693},
        {name: "Bottom", cateNo: 501},
        {name: "Shoes", cateNo: 505},
        {name: "Bag", cateNo: 544},
        {name: "Accessories", cateNo: 507},
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
        {name: "Outer", cateNo: 683},
        {name: "Top", cateNo: 742},
        {name: "Knitwear", cateNo: 1020},
        {name: "Bottom", cateNo: 755},
        {name: "Shoes", cateNo: 783},
        {name: "Bag", cateNo: 1341},
        {name: "Accessories", cateNo: 798},
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
        {name: "Outer", cateNo: 121},
        {name: "Top", cateNo: 119},
        {name: "Bottom", cateNo: 118},
        {name: "Dress", cateNo: 123},
        {name: "Bag", cateNo: 117},
        {name: "Shoes", cateNo: 120},
        {name: "Accessories", cateNo: 116},
        // Men
        {name: "Outer", cateNo: 115},
        {name: "Top", cateNo: 113},
        {name: "Bottom", cateNo: 112},
        {name: "Bag", cateNo: 111},
        {name: "Shoes", cateNo: 114},
        {name: "Accessories", cateNo: 110},
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
    notes: "unisex. Coat/Jacket 분리, 10개 카테고리",
  },
  {
    key: "visualaid",
    name: "VISUAL AID",
    type: "cafe24",
    baseUrl: "https://visualaid.kr",
    multiBrand: true, // 상품이 "[BRAND] 제품명" 형식 — 브랜드가 상품명에 있어 name 파싱/LLM 추출 대상(8division과 달리 DOM에 없음). 단 아직 미검증.
    disabled: true, // 비활성 유지. 재활성 전 name-기반 브랜드 추출을 실제로 검증할 것(LLM-from-name 신뢰도 낮으면 name-prefix 파서 필요).
    paginate: true,
    maxPages: 300,
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 25},
        {name: "Top", cateNo: 26},
        {name: "Bottom", cateNo: 27},
        {name: "Dress", cateNo: 306},
        {name: "Bag", cateNo: 54},
        {name: "Shoes", cateNo: 42},
        {name: "Accessories", cateNo: 28},
        {name: "Accessories", cateNo: 351}, // Headwear
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
    // 멀티브랜드 편집샵이지만 브랜드가 상품명이 아니라 cafe24 DOM(.brand/manufacturer)에
    // 있다 — 직접 크롤(cafe24-engine DOM 추출)이 실제 브랜드를 뽑는다. 따라서
    // multiBrand(온보딩 LLM-from-name) 경로가 아니라 직접 크롤 + import provenance
    // 가드로 처리한다: DOM 추출 성공분은 기존 brand_node 매칭 시 적재, 실패분은
    // 격리(플랫폼명 폴백 없음 → platform-as-brand 재오염 불가).
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 온라인샵 (unisex 편집샵 — 성별 구분 없음)
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
    notes: "unisex 편집샵. 700+ cate_no 중 의류 카테고리 9개만 사용. 브랜드(Needles, EG 등) 카테고리 제외",
  },
  {
    key: "sculpstore",
    name: "스컬프스토어",
    type: "cafe24",
    baseUrl: "https://sculpstore.com",
    brand: "SCULPTOR",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // 카테고리 (unisex — 성별 구분 없음)
        {name: "Top", cateNo: 77}, // 티셔츠
        {name: "Shirts", cateNo: 74}, // 셔츠
        {name: "Top", cateNo: 76}, // 스웻
        {name: "Knitwear", cateNo: 71}, // 니트
        {name: "Top", cateNo: 78}, // 베스트
        {name: "Outer", cateNo: 70}, // 자켓
        {name: "Outer", cateNo: 64}, // 코트
        {name: "Outer", cateNo: 66}, // 다운파카
        {name: "Bottom", cateNo: 72}, // 긴바지
        {name: "Bottom", cateNo: 73}, // 반바지
        {name: "Bottom", cateNo: 65}, // 데님
        {name: "Bottom", cateNo: 75}, // 스커트
        {name: "Shoes", cateNo: 68}, // 신발
        {name: "Shoes", cateNo: 390}, // 샌들
        {name: "Accessories", cateNo: 69}, // 모자
        {name: "Bag", cateNo: 52}, // 가방 & 지갑
        {name: "Accessories", cateNo: 51}, // 액세서리
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
        {name: "Top", cateNo: 47}, // t-shirts
        {name: "Top", cateNo: 522}, // sweats
        {name: "Shirts", cateNo: 48}, // shirts
        {name: "Top", cateNo: 49}, // vests
        {name: "Knitwear", cateNo: 50}, // knitwear
        {name: "Outer", cateNo: 393}, // jackets
        {name: "Outer", cateNo: 525}, // leather
        {name: "Outer", cateNo: 394}, // coats
        {name: "Bottom", cateNo: 52}, // pants
        {name: "Bottom", cateNo: 1574}, // skirt
        {name: "Bottom", cateNo: 53}, // shorts
        {name: "Shoes", cateNo: 55}, // shoes
        {name: "Accessories", cateNo: 523}, // headwear
        {name: "Accessories", cateNo: 54}, // accessories
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
        {name: "Top", cateNo: 226},       // t-shirts
        {name: "Top", cateNo: 227},       // sweats
        {name: "Shirts", cateNo: 228},
        {name: "Top", cateNo: 229},       // vests
        {name: "Knitwear", cateNo: 230},
        {name: "Outer", cateNo: 231},     // jackets
        {name: "Outer", cateNo: 232},     // leather
        {name: "Outer", cateNo: 233},     // coats
        {name: "Outer", cateNo: 234},     // down jackets
        {name: "Bottom", cateNo: 235},    // pants
        {name: "Bottom", cateNo: 236},    // shorts
        {name: "Shoes", cateNo: 241},
        {name: "Accessories", cateNo: 237}, // headwear
        {name: "Accessories", cateNo: 238},
        // Women
        {name: "Top", cateNo: 207},     // t-shirts
        {name: "Top", cateNo: 208},     // sweats
        {name: "Shirts", cateNo: 209},
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
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 54},
        {name: "Top", cateNo: 44},
        {name: "Knitwear", cateNo: 78},
        {name: "Bottom", cateNo: 49},
        {name: "Dress", cateNo: 55},
        {name: "Bag", cateNo: 183},
        {name: "Accessories", cateNo: 56},
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
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 519},      // TSHIRT
        {name: "Top", cateNo: 520},      // TOPS
        {name: "Shirts", cateNo: 522},
        {name: "Top", cateNo: 521},      // SWEATSHIRT
        {name: "Bottom", cateNo: 525},
        {name: "Dress", cateNo: 526},
        {name: "Knitwear", cateNo: 523},
        {name: "Outer", cateNo: 524},
        {name: "Accessories", cateNo: 527},
        {name: "Bag", cateNo: 528},
        {name: "Shoes", cateNo: 553},
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
    category: {
      discovery: "manual",
      categories: [
        {name: "Top",         cateNo: 43},
        {name: "Accessories", cateNo: 44},
        {name: "Bottom",      cateNo: 46},
        {name: "Dress",       cateNo: 47},
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
        {name: "Outer", cateNo: 1500},
        {name: "Knitwear", cateNo: 1546},
        {name: "Top", cateNo: 1547},       // Sweatshirt
        {name: "Shirts", cateNo: 1556},
        {name: "Top", cateNo: 1574},       // T-Shirt
        {name: "Bottom", cateNo: 1499},
        {name: "Bottom", cateNo: 1577},    // Shorts
        {name: "Bag", cateNo: 1548},
        {name: "Shoes", cateNo: 1776},
        {name: "Accessories", cateNo: 1501}, // Headgear
        // Women
        {name: "Outer", cateNo: 1508},
        {name: "Knitwear", cateNo: 1568},
        {name: "Top", cateNo: 1569},     // Sweatshirt
        {name: "Top", cateNo: 1593},
        {name: "Dress", cateNo: 1725},
        {name: "Bottom", cateNo: 1507},
        {name: "Bag", cateNo: 1558},
        {name: "Shoes", cateNo: 1778},
        {name: "Accessories", cateNo: 1505}, // Headgear
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
    category: {
      discovery: "manual",
      categories: [{ name: "모두 보기", cateNo: 1152 }],
    },
    notes: "성수동 편집샵. Crepuscule, Toga, Blurhms, Aton 등 50+ 브랜드. 10~50만원대",
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
        {name: "Outer", cateNo: 137},
        {name: "Top", cateNo: 135},
        {name: "Bottom", cateNo: 136},
        {name: "Bag", cateNo: 138},
        {name: "Accessories", cateNo: 139}, // 모자
        {name: "Accessories", cateNo: 141},
        {name: "Shoes", cateNo: 1111},
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
        {name: "Outer", cateNo: 29},
        {name: "Top", cateNo: 30},
        {name: "Bottom", cateNo: 31},
        {name: "Shoes", cateNo: 42},
        {name: "Bag", cateNo: 43},
        {name: "Accessories", cateNo: 44}, // Hats
        {name: "Accessories", cateNo: 45},
      ],
    },
    notes: "국내외 브랜드 편집샵. 7개 카테고리. 5~30만원대",
  },
  {
    key: "havati",
    name: "하바티",
    type: "cafe24",
    baseUrl: "https://havatishop.com",
    paginate: true,
    maxPages: 300,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        // Outer 하위
        {name: "Outer", cateNo: 131},  // Jacket/Blouson
        {name: "Outer", cateNo: 132},  // Jumper/Parka
        {name: "Outer", cateNo: 323},  // Leather
        {name: "Outer", cateNo: 133},  // Coat
        {name: "Outer", cateNo: 135},  // Vest
        {name: "Outer", cateNo: 136},  // Padding
        {name: "Knitwear", cateNo: 137}, // Cardigan
        // Tops 하위
        {name: "Top", cateNo: 32},     // Tee
        {name: "Shirts", cateNo: 33},   // Shirt
        {name: "Top", cateNo: 125},    // Sweatshirt
        {name: "Knitwear", cateNo: 126}, // Knitwear
        // Bottoms 하위
        {name: "Bottom", cateNo: 138},  // Denim
        {name: "Bottom", cateNo: 280},  // Chino
        {name: "Bottom", cateNo: 281},  // Trousers
        {name: "Bottom", cateNo: 282},  // Easy Pants
        {name: "Bottom", cateNo: 283},  // Work Pants
        {name: "Bottom", cateNo: 284},  // Shorts
        // 나머지
        {name: "Shoes", cateNo: 28},
        {name: "Bag", cateNo: 80},
        {name: "Accessories", cateNo: 79}, // Hats
        {name: "Accessories", cateNo: 42},
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
    paginate: true,
    maxPages: 300,
    category: { discovery: "auto" },
    disabled: true,
    notes: "컨템포러리 캐주얼. 커스텀 셀렉터 필요 (기본 셀렉터로 상품 못 찾음). 5~30만원대",
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
        {name: "Beslow", cateNo: 126},          // 자사 메인 (6p)
        {name: "Beslow Purple", cateNo: 76},    // 퍼플 라인 (2p)
        {name: "Slowboy", cateNo: 133},         // 슬로우보이 (1p)
        {name: "Selected Brands", cateNo: 127}, // 셀렉 브랜드 (16p)
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
        {name: "Outer", cateNo: 44},
        {name: "Top", cateNo: 45},
        {name: "Bottom", cateNo: 46},
        {name: "Accessories", cateNo: 47},
        // Women
        {name: "Top", cateNo: 80},
        {name: "Bottom", cateNo: 81},
        {name: "Dress", cateNo: 95},
        {name: "Accessories", cateNo: 82},
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
        {name: "All", cateNo: 64}, // SHOPNOW (전체 상품 — 단일 카테고리)
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
        {name: "Outer", cateNo: 62},
        {name: "Outer", cateNo: 63},       // 재킷
        {name: "Bottom", cateNo: 27},
        {name: "Shirts", cateNo: 64},
        {name: "Knitwear", cateNo: 65},
        {name: "Top", cateNo: 66},         // 컷앤소운
        {name: "Accessories", cateNo: 53},
        // Women
        {name: "Outer", cateNo: 81},
        {name: "Top", cateNo: 86},
        {name: "Bottom", cateNo: 83},
        {name: "Knitwear", cateNo: 85},
        {name: "Dress", cateNo: 84},
        {name: "Accessories", cateNo: 87},
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
        {name: "Outer", cateNo: 87},
        {name: "Knitwear", cateNo: 51},
        {name: "Shirts", cateNo: 80},
        {name: "Top", cateNo: 30},
        {name: "Bottom", cateNo: 31},
        {name: "Bottom", cateNo: 188}, // Denim
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
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "noah-ny",
    name: "Noah NY",
    type: "shopify",
    baseUrl: "https://noahny.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-07-28 재수집 배치 2에서 발견: URL/상품명에 성별 신호가 전혀 없어
    // gender_missing 으로 크롤 634행 중 66행만 살아남았다(게이트가 정상
    // 차단). 기존 DB 634행 실측: men=634, women=3(예외적 오분류로 보임),
    // 상품명 women 계열 키워드 0건 — 사실상 남성 전용 헤리티지 멘즈웨어
    // 브랜드(sack jacket/sport jacket 등 클래식 테일러링 어휘)라 men 으로 명시.
  },
  {
    key: "brain-dead",
    name: "Brain Dead",
    type: "shopify",
    baseUrl: "https://wearebraindead.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "cpfm",
    name: "Cactus Plant Flea Market",
    type: "shopify",
    baseUrl: "https://cactusplantfleamarket.com",
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-07-28 재수집 파일럿에서 발견: 상품 9개 전부 성별 신호가 없어
    // gender_missing 으로 QC 게이트에 전량 걸려 writeProductsFile 이 파일을
    // 아예 안 썼다 (크롤 "0개"로 보였던 원인). 스트리트웨어 브랜드로 사이트에
    // 남녀 구분이 없어 unisex 로 명시.
  },
  {
    key: "drakes",
    name: "Drake's",
    type: "shopify",
    baseUrl: "https://www.drakes.com",
    sourceCurrency: "GBP",
    maxPages: 300,
    crawlDelay: 1500,
    // 2026-07-28 재수집 배치 2에서 발견: gender_missing 으로 1816개 중
    // 1639개 드랍(46→942행 게이트 실패). 기존 DB 942행 전량 men, women 0건
    // — Drake's 는 영국 헤리티지 멘즈웨어 전문 브랜드라 men 으로 명시.
    // (참고: 같은 배치의 stussy/aime-leon-dore 는 반대로 실제 혼성 브랜드다.)
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
    sourceCurrency: "EUR",
    maxPages: 300,
    crawlDelay: 1500,
  },
  {
    key: "apc-us",
    name: "A.P.C. (US)",
    type: "shopify",
    baseUrl: "https://apc-us.com",
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
    sourceCurrency: "EUR",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "Slam Jam Milan, 1989-est, streetwear/contemporary multi-brand editorial. ~127 vendors observed 2026-05-07; Nike/OAMC/adidas/Undercover/Puma top. Shopify Markets routes EUR via localization=DE cookie. SPEC-PLATFORM-EXPANSION-007. maxPages bumped 50→100 (2026-05-07).",
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

  // ─── 29CM (KR) — second Playwright engine, Cloudflare-passive ───────
  // SPEC: SPEC-PLATFORM-EXPANSION-004
  // Engine: pure Playwright with vanilla `headless: true` (Cloudflare on
  //   29CM is passive — verified 2026-05-06: 5/5 attempts, no challenge,
  //   100% reliability). XHR interception of display-bff-api.29cm.co.kr/
  //   api/v1/listing/items carries full product JSON.
  // Pacing: 2 sec/category (Cloudflare-friendly + browser overhead).
  // ToS: captured live 2026-05-06 by hansangho via Playwright at
  //   /home/agreement. 제11조 제2항 9호 names "크롤러(Crawler)" verbatim
  //   (FORBIDS literal reading). OWNER OVERRIDE: hansangho 2026-05-06,
  //   conditioned on portal.ai-internal-use only + halt-on-cease-and-
  //   desist + 90-day re-verification. Verbatim clauses embedded at top
  //   of src/lib/29cm-engine.ts per REQ-008.
  // apiCategoryCodes: 10 Women + Men L1 fashion codes (research.md §1.6),
  //   live-verified 2026-05-06 via display-bff-api response sample.
  {
    key: "29cm-kr",
    name: "29CM (KR)",
    type: "29cm",
    baseUrl: "https://www.29cm.co.kr",
    sourceCurrency: "KRW",
    crawlDelay: 2000,
    apiCategoryCodes: [
      // Women fashion L1 codes
      268100100, // 여성의류
      269100100, // 여성가방
      270100100, // 여성슈즈
      271100100, // 여성액세서리
      305100100, // 여성주얼리
      // Men fashion L1 codes
      272100100, // 남성의류
      273100100, // 남성가방
      274100100, // 남성슈즈
      275100100, // 남성액세서리
      306100100, // 남성주얼리
    ],
    notes: "29CM KR Playwright + XHR-interception engine. Cloudflare passive (no JS challenge); vanilla headless:true sufficient — channel:'chrome' is documented escalation path. KRW-native, 2 sec/category, 5-UA rotation (one UA per browser context), robots-check enforced. ToS captured 2026-05-06: 제11조 제2항 9호 verbatim names '크롤러' (FORBIDS literal); OWNER OVERRIDE by hansangho 2026-05-06 conditioned on portal.ai-internal-use only + halt-on-cease-and-desist + 90-day re-verification. Lifestyle/design/books/kitchen/beauty/electronics categories out of scope.",
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
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 290},
        {name: "Knitwear", cateNo: 59},
        {name: "Outer", cateNo: 47},
        {name: "Bottom", cateNo: 291},
        {name: "Dress", cateNo: 28},
        {name: "Accessories", cateNo: 43},
      ],
    },
    notes: "brand_nodes id=258, gender_scope=unisex. 홈 nav 확인: NEW/BEST/REFURB/SAMPLE SALE 등 컬렉션성 cate_no는 타입 카테고리와 중복이라 제외.",
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
    category: {
      discovery: "manual",
      categories: [
        {name: "Outer", cateNo: 260},
        {name: "Top", cateNo: 261},
        {name: "Dress", cateNo: 262},
        {name: "Bottom", cateNo: 263},
        {name: "Shoes", cateNo: 264},
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
    category: {
      discovery: "manual",
      categories: [
        {name: "Top", cateNo: 36},
        {name: "Outer", cateNo: 28},
        {name: "Bottom", cateNo: 38},
        {name: "Shoes", cateNo: 43},
        {name: "Bag", cateNo: 42},
        {name: "Accessories", cateNo: 44},
        {name: "Accessories", cateNo: 39}, // HEAD GEAR
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
        {name: "Washed Pajama", cateNo: 48},
        {name: "Loungewear", cateNo: 56},
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
        {name: "Outwear", cateNo: 30},
        {name: "Top", cateNo: 31},
        {name: "Bottom", cateNo: 34},
        {name: "Acc", cateNo: 35},
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
      categories: [{name: "Shop", cateNo: 49}],
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
      categories: [{name: "Shop", cateNo: 24}],
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
      categories: [{name: "All", cateNo: 42}],
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
        {name: "Outer", cateNo: 46},
        {name: "Top", cateNo: 48},
        {name: "Dress", cateNo: 50},
        {name: "Bag", cateNo: 51},
        {name: "Shoes", cateNo: 52},
        {name: "Inner", cateNo: 53},
        {name: "Acc", cateNo: 54},
        {name: "Pants", cateNo: 63},
        {name: "Skirt", cateNo: 64},
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
        {name: "Coats, Jackets", cateNo: 30},
        {name: "Trousers", cateNo: 31},
        {name: "Tops, Shirts", cateNo: 43},
        {name: "Skirts", cateNo: 44},
        {name: "Accessories", cateNo: 46},
      ],
    },
    notes: "dry-run으로 확인된 실제 카테고리 5개(SHOP=24는 상위 all, ARCHIVES는 lookbook이라 제외)",
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
    paginate: true,
    category: {discovery: "auto"},
    disabled: true,
    notes: "BLOCKED — 표준 카테고리 없음, collection/lookbook 페이지에 개별 product_no 링크만 존재하고 그마저 극소수(2~3개). 상품 자체가 거의 없는 신생몰로 추정 — 우선순위 낮음.",
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
        {name: "Poster", cateNo: 52},
        {name: "DNA", cateNo: 54},
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
    notes: "Shopify, /products.json 가격이 이미 KRW(예: 38000) — sourceCurrency 생략(기본값 KRW). 2026-07-06: gender_scope/wiki 미완료라 상품군(반다나/캡 등 액세서리) 기준 unisex로 시드.",
  },
  // BLOCKED — 아래 3개는 PlatformType(cafe24/shopify/uniqlo/zara/29cm/farfetch)에 없는
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
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
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
    category: {discovery: "auto"},
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
    // 구조라 여성 라인 상품은 "상의"/"아우터" 에도 함께 걸린다.
    notes: "3차 배치 draft — dry-run 필요.",
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
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
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
    name: "아웃도어서비스",
    type: "cafe24",
    baseUrl: "https://outdoorservice.works",
    brand: "아웃도어서비스",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "rewind",
    name: "리와인드메이드",
    type: "cafe24",
    baseUrl: "https://re-wind.co.kr",
    brand: "리와인드메이드",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "enseennees",
    name: "SEEN NEES",
    type: "cafe24",
    baseUrl: "https://en.seen-nees.com",
    brand: "SEEN NEES",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "aftrsmmr",
    name: "애프터썸머",
    type: "cafe24",
    baseUrl: "https://aftrsmmr.com",
    brand: "애프터썸머",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
  },
  {
    key: "ensundayceremony",
    name: "SUNDAY CEREMONY",
    type: "cafe24",
    baseUrl: "https://en.sunday-ceremony.com",
    brand: "SUNDAY CEREMONY",
    paginate: true,
    category: {discovery: "auto"},
    notes: "3차 배치 draft — dry-run 필요",
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
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5724. meta.json currency=USD. /products.json 정상.",
  },
  {
    key: "becay",
    name: "Becay",
    type: "shopify",
    baseUrl: "https://becay.store",
    brand: "Becay",
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
    paginate: true,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [{name: "SHOP", cateNo: 23}],
    },
    notes: "brand_node id=5723. dry-run 확인: SHOP(23) 단일 상품 피드(li[id^=anchorBoxId] 셀렉터 정상). COLLECTION(43)/EDITORIAL(45)은 lookbook이라 제외.",
  },
  {
    key: "blank03",
    name: "BLANK03",
    type: "cafe24",
    baseUrl: "https://blank03.com",
    brand: "BLANK03",
    paginate: true,
    crawlDetails: true,
    category: {
      discovery: "manual",
      categories: [
        {name: "Category A", cateNo: 50},
        {name: "Category B", cateNo: 51},
      ],
    },
    notes: "brand_node id=5726. dry-run 확인: cate_no=50/51 상품 피드(각 14개, 셀렉터 정상). cate_no=29는 프로모션 배너라 제외. 엔진이 productUrl로 dedup하므로 겹쳐도 안전.",
  },
  {
    key: "nocle",
    name: "NOCLE",
    type: "cafe24",
    baseUrl: "https://nocle.co.kr",
    brand: "NOCLE",
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
    sourceCurrency: "USD",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5361. meta.json currency=USD, /products.json reachable. detect=shopify.",
  },
  {
    key: "nofaithstudios",
    name: "NO/FAITH STUDIOS",
    type: "shopify",
    baseUrl: "https://nofaithstudios.com",
    brand: "NO/FAITH STUDIOS",
    sourceCurrency: "EUR",
    maxPages: 300,
    crawlDelay: 1500,
    notes: "brand_node id=5418. meta.json currency=EUR, /products.json reachable. detect=shopify.",
  },
  {
    key: "cayl",
    name: "Cayl",
    type: "cafe24",
    baseUrl: "https://cayl.co.kr",
    brand: "Cayl",
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
    brand: "AUBOUR",
    notes: "imweb 파일럿 — brand_node_id=5575, detect platform_family=imweb",
  },
  {
    key: "heretic",
    name: "HERETIC",
    type: "imweb",
    baseUrl: "https://heretic.kr",
    brand: "HERETIC",
    notes: "imweb 파일럿 — brand_node_id=5608, detect platform_family=imweb",
  },
  {
    key: "questandguest",
    name: "QG",
    type: "imweb",
    baseUrl: "https://questandguest.com",
    brand: "QG",
    notes: "imweb 파일럿 — brand_node_id=2459, detect platform_family=imweb",
  },
  {
    key: "differentis",
    name: "DIFFERENTIS",
    type: "imweb",
    baseUrl: "https://www.differentis.kr",
    brand: "DIFFERENTIS",
    notes: "imweb 파일럿 — brand_node_id=5285, detect platform_family=imweb",
  },
  {
    key: "service-en",
    name: "604service",
    type: "imweb",
    baseUrl: "http://604service-en.com",
    brand: "604service",
    sourceCurrency: "USD",
    notes: "imweb 파일럿 — brand_node_id=823, detect platform_family=imweb. 2026-07-21: 사이트 실측 currency=USD 확인 (기존엔 미설정으로 KRW 오판정 → id 605827 등 가격 오적재, crawler SPEC 수정과 함께 반영).",
  },
  {
    key: "youche-pa",
    name: "YOUCHE PRETAPORTER",
    type: "imweb",
    baseUrl: "https://youche-pa.kr",
    brand: "YOUCHE PRETAPORTER",
    notes: "imweb 파일럿 — brand_node_id=5229, detect platform_family=imweb",
  },
  {
    key: "sacredt",
    name: "사크레드티",
    type: "imweb",
    baseUrl: "https://sacredt.kr",
    brand: "사크레드티",
    notes: "imweb 파일럿 — brand_node_id=5233, detect platform_family=imweb",
  },
  {
    key: "noobstore",
    name: "Noobstore",
    type: "imweb",
    baseUrl: "https://www.noobstore.co.kr",
    brand: "Noobstore",
    notes: "imweb 파일럿 — brand_node_id=5506, detect platform_family=imweb",
  },
  {
    key: "eonts",
    name: "Eonts",
    type: "imweb",
    baseUrl: "https://www.eonts.kr",
    brand: "Eonts",
    notes: "imweb 파일럿 — brand_node_id=5290, detect platform_family=imweb",
  },
  {
    key: "bluesf",
    name: "bluesf",
    type: "imweb",
    baseUrl: "https://bluesf.kr",
    brand: "bluesf",
    notes: "imweb 파일럿 — brand_node_id=5295, detect platform_family=imweb",
  },
  {
    key: "durt",
    name: "durt",
    type: "imweb",
    baseUrl: "https://durt.co.kr",
    brand: "durt",
    notes: "imweb 파일럿 — brand_node_id=5365, detect platform_family=imweb",
  },
  {
    key: "corebrass",
    name: "COREBRASS",
    type: "imweb",
    baseUrl: "https://corebrass.com",
    brand: "COREBRASS",
    notes: "imweb 파일럿 — brand_node_id=2557, detect platform_family=imweb",
  },
  {
    key: "lost-town-supply",
    name: "Lost Town Supply",
    type: "imweb",
    baseUrl: "https://www.lost-town-supply.com",
    brand: "Lost Town Supply",
    notes: "imweb 파일럿 — brand_node_id=2474, detect platform_family=imweb",
  },
  {
    key: "homly",
    name: "Homly",
    type: "imweb",
    baseUrl: "https://homly.kr",
    brand: "Homly",
    notes: "imweb 파일럿 — brand_node_id=2170, detect platform_family=imweb",
  },
  {
    key: "monjagal",
    name: "Monja Gal",
    type: "imweb",
    baseUrl: "https://monjagal.com",
    brand: "Monja Gal",
    notes: "imweb 파일럿 — brand_node_id=5512, detect platform_family=imweb",
  },
  {
    key: "rarseoul",
    name: "RAR",
    type: "imweb",
    baseUrl: "https://rarseoul.com",
    brand: "RAR",
    notes: "imweb 파일럿 — brand_node_id=5341, detect platform_family=imweb",
  },
  {
    key: "taille",
    name: "Taille",
    type: "imweb",
    baseUrl: "https://taille.kr",
    brand: "Taille",
    notes: "imweb 파일럿 — brand_node_id=2205, detect platform_family=imweb",
  },
  {
    key: "dogmaehks",
    name: "DOGMA EHKS",
    type: "imweb",
    baseUrl: "https://dogmaehks.com",
    brand: "DOGMA EHKS",
    notes: "imweb 파일럿 — brand_node_id=5284, detect platform_family=imweb",
  },
  {
    key: "jimilii",
    name: "jimilii",
    type: "imweb",
    baseUrl: "https://jimilii.com",
    brand: "jimilii",
    notes: "imweb 파일럿 — brand_node_id=5316, detect platform_family=imweb",
  },
  {
    key: "amabe",
    name: "AMABE",
    type: "imweb",
    baseUrl: "http://amabe.kr",
    brand: "AMABE",
    notes: "imweb 파일럿 — brand_node_id=5227, detect platform_family=imweb",
  },
  {
    key: "singularisca",
    name: "singulari",
    type: "imweb",
    baseUrl: "https://singularisca.com",
    brand: "singulari",
    notes: "imweb 파일럿 — brand_node_id=5317, detect platform_family=imweb",
  },
  {
    key: "pulajournal",
    name: "PULA",
    type: "imweb",
    baseUrl: "https://pulajournal.com",
    brand: "PULA",
    notes: "imweb 파일럿 — brand_node_id=5445, detect platform_family=imweb",
  },
  {
    key: "hokuspokus",
    name: "HOKUSPOKUS (호쿠스포쿠스)",
    type: "imweb",
    baseUrl: "https://www.hokuspokus.co.kr",
    brand: "HOKUSPOKUS (호쿠스포쿠스)",
    notes: "imweb 파일럿 — brand_node_id=5511, detect platform_family=imweb",
  },
  {
    key: "minihorses",
    name: "Mini Horses",
    type: "imweb",
    baseUrl: "https://minihorses.co.kr",
    brand: "Mini Horses",
    notes: "imweb 파일럿 — brand_node_id=5528, detect platform_family=imweb",
  },
  {
    key: "hausou",
    name: "HAUSOU",
    type: "imweb",
    baseUrl: "https://www.hausou.com",
    brand: "HAUSOU",
    notes: "imweb 파일럿 — brand_node_id=5484, detect platform_family=imweb",
  },
]

export const PLATFORMS: SiteConfig[] = [...MANUAL_PLATFORMS, ...GENERATED_PLATFORMS]

/** key로 사이트 설정 조회 */
export function getSiteConfig(key: string): SiteConfig | undefined {
  return PLATFORMS.find((p) => p.key === key)
}

/** 활성화된 사이트만 반환 */
export function getActivePlatforms(): SiteConfig[] {
  return PLATFORMS.filter((p) => !p.disabled)
}

/** 타입별 필터 */
export function getPlatformsByType(type: SiteConfig["type"]): SiteConfig[] {
  return getActivePlatforms().filter((p) => p.type === type)
}
