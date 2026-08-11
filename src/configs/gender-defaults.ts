/**
 * 사이트별 defaultGender 보강 맵 — 사람이 검증해 관리한다.
 *
 * 2026-08 성별 추출 크롤러 회귀에서, URL·상품명에 성별 신호가 전혀 없는
 * cafe24 자사몰(대부분 `category: {discovery: "auto"}`)은 engine/url/text
 * 추론이 전부 실패해 상품이 100% 드랍된다. `platforms.ts` 의 hand-curated
 * `defaultGender` 를 복원해도 애초에 그 값을 가진 적 없는 사이트들이 남는다.
 *
 * 이 파일이 그 구멍을 메운다. `platforms.generated.ts` 를 손대지 않고
 * (AUTO-GENERATED 파일이며 재생성 때 날아간다), config 에 `defaultGender` 가
 * 없을 때만 `getSiteConfig()` 가 여기서 채운다.
 *
 * ─── 값을 추가하는 규칙 ───────────────────────────────────────────
 *
 * [HARD] brand_nodes.gender_scope 를 근거로 쓰지 않는다. 그 데이터는 감사
 *   도구도 수정 UI 도 없고, migration 091 이 13,942행을 거기서 일괄
 *   backfill 하는 바람에 DB 의 gender 분포 자체가 오염돼 있다.
 *   `tools/propose-site-gender.ts` 의 gender_source 화이트리스트가 이걸
 *   걸러낸다 — 근거 행이 154,403 → 20,843 건으로 줄어드는 게 오염 규모다.
 *
 * [HARD] "성별 카테고리가 없다"는 unisex 의 근거가 아니다. 그건 "모름"이고,
 *   검색 RPC 가 unisex 를 남녀 양쪽에 노출시키므로 여성 상품이 남성 검색으로
 *   새는 바로 그 세탁이다. unisex 는 사이트가 명시적으로 남녀공용을 표방할
 *   때만 넣는다. 근거가 없으면 **비워 둔다** — 그 사이트 상품이 드랍되는 것이
 *   틀린 성별로 적재되는 것보다 낫다.
 *
 * 절차:
 *   1. npx dotenv -e .env.local -- npx tsx tools/propose-site-gender.ts \
 *        --allow-null-source --out=data/gender-defaults-candidates.json
 *   2. 후보 사이트를 실제로 열어 확인하거나, data/<site>-products.json 의
 *      상품명에서 여성/남성 전용 의류 어휘를 센다 (공용 품목은 근거가 아니다).
 *   3. 확인된 것만 아래에 옮기고 근거를 주석으로 남긴다.
 *
 * 이 값은 항상 `genderSource: "config_default"` 로 기록되며 dedup rank 최하위다
 * — engine/url/text 근거가 하나라도 있으면 그쪽이 이긴다.
 */
import type {ProductGender} from "../lib/product-gender"

export const SITE_GENDER_DEFAULTS: Record<string, ProductGender[]> = {
  // 공식 상품 설명에 남·여 모델 착용이 함께 나오고, 상품 자체에도 Unisex 명시.
  // https://bitethebullet.xyz/products/bite-the-bullet-tee
  brand: ["unisex"],
  // 2026-07-15 브랜드 리서치: 공식 홈페이지·Instagram 출처로 유니섹스 확인.
  // https://www.reaven.co/en / https://www.instagram.com/reaven/
  reaven: ["unisex"],
  // 2026-07-15 브랜드 리서치: 공식 홈페이지·Instagram 및 판매 상품군 교차 확인.
  // https://www.vicinityclo.de/ / https://www.instagram.com/vicinity_de/
  vicinityclo: ["unisex"],
  // 공식몰은 일반/Man 상품군과 별도 Woman 컬렉션을 운영한다. Woman 상품은
  // Shopify 태그로 먼저 판정하고, 그 신호가 없는 일반 상품군에만 men을 적용한다.
  // https://coldcultureworldwide.com/collections/all-products
  // https://coldcultureworldwide.com/collections/woman
  coldcultureworldwide: ["men"],
  // 공식몰의 일반 상품 상세는 Model (man)과 Model (woman)을 함께 명시하며, 별도로
  // Just Women 상품군을 운영한다. 여성/남성 전용 태그를 먼저 판정하고 일반 라인만 공용 처리한다.
  // https://scuffers.com/collections/all/products/eggplant-green-shorts
  // https://scuffers.com/collections/new-arrivals-men/products/roster-brown-jorts
  scuffers: ["unisex"],
  // 공식 영문몰 소개: "We use pearls and various materials in genderless products."
  // https://en.lowool.com/index.html
  enlowool: ["unisex"],
  // 공식몰은 dresses/skirts/bras/underwear 등 여성 상품군과 별도 unisex 컬렉션을 운영한다.
  // 명시적 unisex 태그는 엔진 근거가 우선하고, 그 외 상품에만 women을 적용한다.
  // https://threetimes333.com/collections/dresses
  // https://threetimes333.com/collections/unisex
  threetimes333: ["women"],
  // ── 사이트 직접 확인 (2026-08-03) ────────────────────────────
  // 내비게이션에 DRESS/SKIRT 등 여성 전용 카테고리가 있고 남성 라인이 없음.
  aru: ["women"], // Dresses/Tops/Bottoms
  bergwerk: ["women"], // OUTERWEAR/TOP/DRESSES + DRAPE WRAP TOP, VINTAGE FLOWER SKIRT
  editablescenario: ["women"], // Tops/Bottoms/Dress + Square Neck Bra Top
  funfromfun: ["women"], // Outers/Tops/Bottoms/Dresses, "GIRLISH, YOUNG AND KITSCH"
  geegee: ["women"], // jewelry/acc — flower pop earring, organza volume scrunchie
  kupidomovingwear: ["women"], // Clothing/Moving/Vacance + Mermaid Swimsuit
  mausoleum: ["women"], // OUTERWEAR/TOPS/DRESSES + Pleated Skirt, Satin Blouse
  ordes: ["women"], // "contemporary take on femininity"
  porterna: ["women"], // Official storefront has dresses/skirts/blouses and no men's department; current corpus includes halter/off-shoulder/blouse items.
  margesherwood: ["women"], // Official storefront collections include DRESS and other womenswear alongside bags/shoes, with no men's department.
  // 공식몰의 반지·목걸이·헤어 액세서리 카탈로그와 일치하는 무신사 상품들이
  // 성별 '여'로 명시되어 있다. 남성/공용 상품 또는 별도 남성 부문은 확인되지 않았다.
  // https://www.musinsa.com/products/5670923
  // https://www.musinsa.com/products/5758840
  // https://www.musinsa.com/products/5654447
  mosxe: ["women"],
  // 공식 소개는 페미닌 주얼리로 정의하고, 무신사 동일 상품도 성별 '여'로 명시한다.
  // https://butter-ring.com/shopinfo/company.html
  // https://www.musinsa.com/products/6041628
  "butter-ring": ["women"],
  // 공식몰 카탈로그가 bikini/swimsuit/brief 여성 컬렉션으로만 구성된다.
  // https://orogee.com/category/lets-swim/24/
  orogee: ["women"],
  // 공식 상세에는 성별 문자열이 없지만 공식 룩북은 184cm 모델/size 2로
  // 전개하며, 현재 공식 취급처 NOCLAIM은 별도 '여성상품' 카테고리 밖의
  // 일반 아우터/상의/하의에 OSCITARE 전 상품을 분류한다.
  // https://blog.naver.com/ghr11192/223798673041
  // https://noclaim.co.kr/product/list.html?cate_no=1925
  oscitare: ["men"],
  // 공식몰 제작사가 해당 프로젝트를 "남성 브랜드 처칠롬퍼"로 명시한다.
  // 공식몰 상품·카테고리에는 개별 성별 표기가 없어 사이트 기본값으로만 보완한다.
  // https://kmong.com/portfolio/view/152027
  // https://churchillromper.com/product/list.html?cate_no=52
  churchillromper: ["men"],
  // 브랜드 사전은 KIBATA를 "데님 중심의 도메스틱 남성 브랜드"로 명시한다.
  // 공식몰의 현행 데님 사이즈도 성인 남성 28–36 체계이고 상품별 성별 필드는 없다.
  // https://fruitsfamily.com/brand/KIBATA
  // https://www.kibata.kr/Online-Store/?idx=48
  kibata: ["men"],
  // 공식 About이 빈티지 밀리터리·워크웨어·스포츠웨어를 "남성복의 근간"으로
  // 명시하고 이를 PUBLIC FIGURE의 현재 의류로 재해석한다고 설명한다.
  // https://publicfigure.kr/about
  publicfigure: ["men"],
  // The official product description explicitly says BANTS focuses on the
  // fabrics and patterns important in men's wear. The brand-only category is
  // configured separately so retailer inventory cannot inherit this value.
  // https://bants.co.kr/product/bants-bgs-vintage-baseball-coach-jacket-navy/588/
  bants: ["men"],
  // 창업자들이 2025 Hypebeast 인터뷰와 브랜드 인터뷰에서 TwoJeys를
  // "men's jewelry brand"로 반복 정의. Shopify 상품 태그에는 성별 신호가
  // 없으므로 상품 단위 추론 대신 검증된 브랜드 타깃을 최하위 기본값으로 쓴다.
  twojeys: ["men"],
  rense: ["women"], // OUTWEAR/TOPS/BOTTOMS/DRESS/ACC
  treemingbird: ["women"], // DRESSES/SKIRTS/SWIMWEAR + Halter Neck Backless Knit Top
  yahnsisi: ["women"], // Tops/Knits/Basics/Bottoms/Dresses + Lazy Summer Dress

  // ── 크롤 캐시 상품명 어휘 판정 (2026-08-03) ──────────────────
  // data/<site>-products.json 에서 여성 전용 의류 어휘(원피스/스커트/블라우스/
  // 뷔스티에/크롭 등) 출현 건수 대 남성 전용 어휘 건수. 남성 0건이 조건.
  hagamos: ["women"], // 여성 12 / 남성 0 (n=104)
  kiibi: ["women"], // 여성 1 / 남성 0 (n=77) — 약하지만 남성 신호 0
  miuki: ["women"], // 여성 4 / 남성 0 (n=19)
  moringaearth: ["women"], // 여성 24 / 남성 0 (n=92)
  muarvo: ["women"], // 여성 304 / 남성 0 (n=727)
  newrim: ["women"], // 여성 10 / 남성 0 (n=24)
  ordinaryholiday: ["women"], // 여성 77 / 남성 0 (n=399)
  // ↑ DB 에는 unisex 560행이 있으나 gender_source=unverified_legacy 라
  //   신뢰 대상이 아니다. 상품 어휘가 여성 전용을 가리키므로 women 으로 둔다.
  portraitseoul: ["women"], // 여성 20 / 남성 0 (n=88)
  saengin: ["women"], // 여성 113 / 남성 0 (n=407)
  sankofapuella: ["women"], // 여성 6 / 남성 0 (n=21)
  saurusgirl: ["women"], // 여성 8 / 남성 0 (n=32)
  theepel: ["women"], // 여성 154 / 남성 0 (n=941)
  wonet: ["women"], // 여성 14 / 남성 0 (n=80)

  // ── 2차: refresh-candidates 경로 유입 브랜드 (2026-08-03) ─────
  // 위와 같은 기준. 사이트 직접 확인:
  birrot: ["women"], // Dresses/Skirts/Tops + Coats & Jackets/Knitwear
  birthdayeve: ["women"], // Outer/Top(blouse,sleeveless)/Bottom(skirt)/Acc
  // 상품 코퍼스 어휘 판정 (여성 전용 어휘 있음 / 남성 전용 어휘 0):
  apoem: ["women"], // 여성 57 / 남성 0 (n=206)
  aetoa: ["women"], // 여성 17 / 남성 0 (n=97)
  asymmetry: ["women"], // 여성 6 / 남성 0 (n=30)

  // ── 3차: CatN 생성 config 사이트 (2026-08-04) ─────────────────
  //
  // 배경: 이 사이트들은 crawl→import 경로에서 상품이 전량 드랍된다. 진단해 보니
  // 원인은 카테고리가 아니라 **성별**이었다 — 상품명·URL·태그 어디에도 성별
  // 신호가 없어 미해결률이 84~100% 다 (204개 사이트 / 37,022건).
  //
  // 자동 판정은 포기했다. 상품 코퍼스의 여성 어휘로 후보를 뽑아 사이트를 하나씩
  // 확인했더니 **14개 중 8개가 혼성(MEN/WOMEN 내비 분리)** 이었다. 혼성 브랜드도
  // 여성 라인에 DRESS/SKIRT 카테고리가 있으니 어휘가 잡힌다 — 어휘는 "여성 상품이
  // 있다"는 신호이지 "여성 전용"의 신호가 아니다.
  //
  // 아래는 사이트를 열어 여성 전용임을 확인한 것만 넣는다.
  bittercells: ["women"], // OUTER/TOP/BOTTOM(PANTS,SKIRT,DRESS)/ACC — 남성 섹션 없음
  kindersalmon: ["women"], // DRESSES / SHIRTS & BLOUSE / KNITWEAR — 남성 섹션 없음
  magnetarchive: ["women"], // Outer/Top/Bottom/Dress/Swimwear/Jewelry (+Magnet Kids)
  "brand-4cb9": ["women"], // 더핑크 — "여성의류 쇼핑몰" 명시, OPS&SKIRT 카테고리

  // ── 의도적으로 비워둔 사이트 (근거 불충분) ────────────────────
  //
  // 아래는 defaultGender 를 넣지 않는다. 이 사이트 상품은 engine/url/text
  // 추론이 실패하면 드랍된다 — 의도된 동작이다.
  //
  //   oryany          핸드백/지갑 전용(SHOULDER/CROSS/TOTE/WALLET/BACKPACK).
  //                   의류가 아니라 성별 판정 근거가 상품에 없다. n=504.
  //   roaringrad      사이트에 성별 구분이 없음 — "구분 없음"은 unisex 의
  //   samostuff       근거가 아니라 "모름"이다. 명시적 남녀공용 표방 필요.
  //   nuakle          DB(men 51.9%)와 캐시 어휘(여성 17/남성 0)가 충돌.
  //   ceyesseoul      표본 2~21건으로 판정 불가.
  //   dearunknown
  //   groundiam
  //   kanari
  //   parrtofficial
  //
  //   aekki           주얼리 전용(반지/팔찌/귀걸이). 사이트가 남녀 컬렉션을
  //                   함께 운영 — 혼성이라 사이트 기본값이 성립하지 않는다.
  //   a-cold-wall-2808  카탈로그 119건 전체에 성별 신호 없음(상품명이 순수
  //                   제품 서술, 태그·URL 모두 무신호). 재크롤로도 해결 안 됨.
  //   beheavyer       상품 코퍼스에 성별 어휘 0.
  //   borseoul
  //   9999archive     여성 어휘 1/231 — 표본 대비 너무 약함.
  //   annexearchives  여성 어휘 1/85.
  //   aieul           여성 어휘 2/43.
  //   sportyandrich   혼성 브랜드. 태그·URL 근거로 재크롤 시 100% 해결되므로
  //                   기본값이 필요 없다 (platforms.ts 주석 참조).
  //   jadedldn        혼성 브랜드. 재크롤 시 engine 근거로 100% 해결.
  //
  //   ── 2026-08-04 사이트 확인 결과 혼성(MEN/WOMEN 내비 분리) ──
  //   기본값을 넣으면 상품 절반이 반대 성별로 적재된다. 상품 단위 근거도 없어
  //   (미해결 84~100%) 재크롤 + 카테고리 URL 기반 성별이 선행돼야 한다.
  //   어휘 집계로는 전부 "여성"으로 잘못 나왔던 것들이라 특히 주의.
  //     matin-kim      Outerwears/Tops/Bottoms/Dresses + KIMMATIN 서브브랜드
  //     wooyoungmi     여성/남성 분리 내비, "남녀 통합 컬렉션" 명시
  //     uniformbridge  MEN / WOMEN 쇼핑 구획 분리
  //     humanity       MEN(OUTER,TOP..) / WOMEN(..SKIRTS)
  //     erer           WOMEN / MEN 섹션 분리
  //     en-1111 (coor) MEN'S / WOMEN'S 캠페인 분리
  //     glowny         WOMEN + GLOWNY CLASSIC(유니섹스) + GIRLS(아동)
  //     millowomen     MEN(Pokémon..) / WOMEN(miffy..) — 이름과 달리 혼성
  //
  //   ── 판정 불가 (카테고리는 여성형이나 명시 없음) ──
  //     oheshio        OUTERWEAR/TOP/BOTTOMS/DRESS/BAG/ACC
  //     nuuanu         Shop/Lookbook/About 뿐
}
