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
  // ── 2026-08-16 low-coverage Shopify official-site review ────────
  baserange: ["women"], // Official About describes the label as an underwear line for women that evolved into its current broader collection.
  // https://baserange.com/pages/about
  khaite: ["women"], // Official About explicitly calls the house's output womenswear and accessories; the shop labels its full RTW collection Women's Designer Ready-to-Wear.
  // https://khaite.com/pages/about
  // https://khaite.com/collections/ready-to-wear
  // ── 2026-08-16 Korean/KRW inactive batch official-site review ──
  omirad: ["men"], // Official mission explicitly describes the catalogue as street fashion for a young man.
  // https://omirad.com/pages/about-omirad
  "james-coward": ["men"], // Official stockist Neighbour lists the complete label under James Coward Mens and describes its menswear basis.
  // https://www.shopneighbour.com/collections/james-coward-mens
  rodo: ["women"], // Official About says the bags and shoes are created to enhance the femininity of every woman.
  // https://rodo.it/en/pages/about-rodo
  areyou: ["women"], // Dresses throughout the official catalogue; detail pages consistently publish a female model's bust/waist/hips.
  // https://areyou.kr/category/shop/48/
  // https://areyou.kr/product/detail.html?product_no=821
  "east-sea": ["women"], // Official swimwear size guide uses Korean women sizes 44-66 and bust-cup sizing.
  // https://east-sea.kr/product/detail.html?product_no=219
  erikacavallini: ["women"], // Official full shop is dresses/skirts/women silhouettes with no men's department.
  // https://erikacavallini.com/en-eu
  // ── 2026-08-13~14 신규 한국몰 공식 카탈로그 검증 ──────────────
  girlsgirls: ["women"],
  hannui: ["women"],
  whateverwewant: ["men"],
  yiyae: ["men"],
  noregret: ["women"],
  roompauline: ["women"],
  "s-sil": ["women"],
  towtowarchive: ["women"],
  gochagocha: ["women"],
  pacosply: ["women"],
  piarche: ["women"],
  shopattends: ["women"],
  fanyoung: ["women"],
  "hata-official": ["women"],
  odna: ["women"],
  kindred: ["women"],
  yileeonline: ["women"],
  s2asuras2: ["women"],
  lyex2: ["women"],
  "emostanceclub-global": ["men"],
  "our-nation": ["men"],
  personalobject: ["men"],
  nghtysvg: ["men"],
  twentyoneaugust: ["women"],
  tangojae: ["women"],
  worthwhilemovement: ["unisex"],
  eriist: ["unisex"],
  picea: ["women"],
  findoubt: ["women"],
  jabberwocky: ["men"],
  sirena: ["women"],
  gimcontext: ["unisex"],
  conichiwabonjour: ["unisex"],
  sagega: ["unisex"],
  tape00: ["unisex"],
  hyxia: ["women"],
  moraehouse: ["women"],
  en3ai: ["women"],
  twodul: ["women"],
  yinandyang: ["women"],
  moroa: ["women"],
  crushagain: ["women"],
  "afb-afb-afb": ["men"], // WMS 여성 라인은 상품명으로 분리되고 나머지 본선은 MENS 근거 확인
  amiment: ["women"], // Dress/Skirt/Swimwear 공식 카탈로그, 남성 라인 없음
  soonsuofficial: ["women"], // Dresses/Skirts/Swimwear 공식 카탈로그, 남성 라인 없음
  sculptorpage: ["women"], // 공식 상세 전반이 Female Model 치수·착용 사이즈를 명시하고 여성 전용 의류를 판매
  // https://sculptorpage.com/product/detail.html?cate_no=1033&product_no=10281
  // https://sculptorpage.com/product/supima-banding-bra-top-white/7683/
  archthe: ["women"], // 공식 내비게이션이 SHOP WOMEN으로 의류 전 부서를 명시
  // https://archthe.com/?country=KR
  percentis: ["men"], // Rakuten Fashion Week 공식 분류: Men's / Ready To Wear
  // https://rakutenfashionweektokyo.com/en/brands/detail/99is/
  "en-2706": ["unisex"], // 공식 취급처가 TAW&TOE를 유니섹스 슈즈 전문 브랜드로 명시
  // https://www.acrmtsm.jp/brands/175
  "nomanual-shop": ["unisex"], // 공식 브랜드 취급처의 현재 스타일 분류가 unisex
  // https://www.nugu.jp/director/nomanual
  // ── 2026-08-12 import=0 55개 공식몰 재검증 ────────────────────
  // 아래 값은 공식몰의 현재 전체 컬렉션/소개에서 여성 상품군을 명시하고,
  // 남성 부서가 없음을 함께 확인한 사이트만 기록한다. 여성 카테고리 하나가
  // 있다는 이유만으로 넣지 않았다. 별도 공용 컬렉션이 있는 charoruiz는
  // Shopify 컬렉션 근거가 이 기본값보다 먼저 적용된다(platforms.ts).
  aeyde: ["women"], // 공식 All Women's Footwear / Jewelry 컬렉션
  // https://www.aeyde.com/collections/all-footwear
  alessandrarich: ["women"], // 공식 RTW 전체: Dresses/Skirts/Swimwear, 남성 부서 없음
  // https://alessandrarich.com/collections/ready-to-wear
  aminamuaddi: ["women"], // 공식 여성 슈즈·백·주얼리 하우스 카탈로그
  // https://www.aminamuaddi.com/collections/view-all-shoes
  charoruiz: ["women"], // 여성 리조트웨어 + 별도 공식 Unisex 컬렉션
  // https://charoruiz.com/collections/all
  chopovalowena: ["women"], // Dresses/Skirts/Lingerie/Swimwear, 남성 부서 없음
  // https://chopovalowena.com/collections/clothing
  demellierlondon: ["women"], // 공식 Women's Bags 컬렉션
  // https://demellierlondon.com/collections/womens-bags
  estermanas: ["women"], // Dresses/Skirts/Lingerie/Bump, 남성 부서 없음
  // https://estermanas.com/collections/all
  foreu: ["women"], // 공식 메타 설명: "미니멀 여성의류"
  // https://foreu.kr/
  chicks: ["women"], // 공식몰 스커트/드레스 등 여성 전용 어휘 44건, 남성 어휘 0건(n=322)
  // https://chicks.co.kr/
  fakiii: ["women"], // 공식몰 one-piece/skirt/blouse 21건, 남성 어휘 0건(n=110)
  // https://fakiii.com/
  moifaire: ["women"], // 공식몰 bralette/skirt/blouse/dress 43건, 남성 어휘 0건(n=158)
  // https://moifaire.com/
  sorbee: ["women"], // 공식몰 off-shoulder dress/skirt/blouse, 남성 어휘 0건(n=54)
  // https://sorbee.co.kr/
  taey: ["women"], // 공식몰 shirring dress/blouse/skirt, 남성 어휘 0건(n=92)
  // https://taey.kr/
  frankiesbikinis: ["women"], // 공식 여성 swim/clothing 카탈로그
  // https://frankiesbikinis.com/collections/swimwear
  heidiklein: ["women"], // 공식 women’s swimwear/bikinis/dresses 카탈로그
  // https://heidiklein.com/collections/swimwear
  leset: ["women"], // Dresses/Skirts/Mama & Bebe, 남성 부서 없음
  // https://leset.com/collections/all
  marahoffman: ["women"], // 공식 women’s ready-to-wear/swim 카탈로그
  // https://marahoffman.com/collections/all
  marieadamleenaerdt: ["women"], // 공식 DRESSES & SKIRTS 전체 컬렉션, 남성 부서 없음
  // https://marieadamleenaerdt.com/collections/all
  nayarea: ["women"], // Dresses/Skirts/Co-Ord Sets, 남성 부서 없음
  // https://nayarea.com/collections/all-products
  norba: ["women"], // Bras/Leggings/Lingerie/Dresses 공식 카탈로그, 남성 부서 없음
  // https://norba.clothing/collections/shop-all
  odorshop: ["women"], // 공식 전체몰 DRESS/UNDERWEAR + bra/brief 상품군
  // https://odorshop.co.kr/category/all/42/
  enseennees: ["women"], // 공식 전체몰 tube top/mesh skirt 등 여성복, 남성 부서 없음
  // https://en.seen-nees.com/
  kanari: ["women"], // 공식 전체몰 ONE PIECE 및 여성 의류, 남성 부서 없음
  // https://kanari.co.kr/category/all/23/
  notfoursix: ["women"], // 공식 Dress / Onepiece 부서, 남성 부서 없음
  // https://notfoursix.kr/category/all/24/
  poev: ["women"], // 공식몰 off-shoulder/tank-top 여성 컬렉션, 남성 부서 없음
  // https://poev.kr/
  "self-service": ["women"], // 공식 DRESS/JEWELRY 의류몰, 남성 부서 없음
  // https://self-service.kr/
  yuheelee: ["women"], // 공식 DRESS 및 여성 실루엣 전체 컬렉션, 남성 부서 없음
  // https://yuheelee.com/
  otiumberg: ["women"], // 공식 Gifts For Her 및 women 대상 주얼리 설명
  // https://otiumberg.com/collections/gifts-for-her
  racil: ["women"], // 공식 dresses/skirts/smoking suits 여성 RTW, 남성 부서 없음
  // https://racil.com/collections/ready-to-wear
  shopdoen: ["women"], // 공식 women’s dresses/tops/skirts 카탈로그
  // https://shopdoen.com/collections/clothing
  pommedor: ["women"], // 공식 홈이 브랜드를 "feminine style" 슈즈로 명시
  // https://pommedor.it/
  "sineadodwyer-1472": ["women"], // 공식 전체몰이 dresses/bridal/briefs/leotards 여성 컬렉션으로 구성
  // https://sineadodwyer.com/collections/all
  stapleandhue: ["women"], // 공식 컬렉션 설명이 feminine으로 명시되고 dresses/pumps 중심
  // https://stapleandhue.co/collections/pointelle
  "carnebollente-1704": ["unisex"], // 공식 상품이 남녀 모델 착용을 보여주고 상품 설명도 Unisex로 명시
  // https://carnebollente.com/en-jp/products/love-chronicles-grey
  // https://carnebollente.com/products/benefits-with-friends
  abagavelli: ["men"], // 공식 About이 컬렉션을 menswear staples/elegance로 설명
  // https://abagavelli.com/pages/about-us
  ceciletulkens: ["unisex"], // 공식 안내가 남녀 의류임을 밝히고 상품 설명에 남녀 사이즈를 명시
  // https://www.ceciletulkens.com/pages/information
  // https://www.ceciletulkens.com/products/irregular-rib-socks-natural
  avvattev: ["unisex"], // 공식 AW26이 남녀 룩을 하나의 통합된 워드로브로 제시
  // https://www.avvattev.com/blogs/collections/autumn-winter-26-nocturne
  "sansangear-5471": ["unisex"], // 공식 TOJI 동일 SKU에 남녀 모델 착용 사이즈를 함께 명시
  // https://sansangear.com/en/products/breeze-basic-t-shirt
  faneofficiel: ["women"], // 공식 보도자료가 브랜드 가방이 여성을 대상으로 한다고 명시
  // https://www.faneofficiel.fr/pages/fane-in-the-press
  fandco: ["unisex"], // 공식 상품 여러 건이 동일 헤드웨어를 him/her 모두에게 적합하다고 명시
  // https://fandco.co.nz/products/heart-monogram-cap-wide-brim-5-panel-off-white-trucker
  // https://fandco.co.nz/products/floral-patch-cap-short-brim-5-panel-brown
  luvz: ["unisex"], // 공식 발라클라바 상세가 전 상품군을 One size, unisex로 명시
  // https://www.luvz.ch/products/swiss-light-red-white

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
  // IYSO describes KLOGG as made for everyone regardless of gender, and its
  // official footwear size range spans 230-300. Product categories carry the
  // same explicit seed; this default only covers future uncategorized items.
  // https://iyso.kr/product/klogg-black/476/
  iyso: ["unisex"],
  // The official March 2026 notice calls its popup-only shirt the brand's
  // first women's project. That item is absent from the current online store;
  // current inventory is the main men's range (FRESH/OLD/NEXT MAN). Explicit
  // future women evidence still outranks this fallback at product level.
  // https://refomed.jp/blogs/news/shibuya-parco-popup-store
  // https://refomed.jp/collections/online-store
  refomed: ["men"],
  // Official bag descriptions explicitly say the size suits both men and
  // women. The catalogue is bags/accessories rather than gendered apparel.
  // https://maziuntitled.com/product/suede-nook-bag-brown/967/
  maziuntitled: ["unisex"],
  // Current official inventory has two explicitly named WOMEN'S JACKET
  // products; product-level evidence keeps those women. The remaining denim
  // fits use the brand's main 28-40 / jacket 36-44 men's size system and its
  // official partner list points to menswear heritage retailers. This value
  // is therefore only the fallback for the 28 non-women products.
  // https://omotodenim.jp/en/products/womens-3115-13-5oz-type-1-denim-jacket
  // https://omotodenim.jp/en/pages/retailer
  omotodenim: ["men"],
  // 창업자들이 2025 Hypebeast 인터뷰와 브랜드 인터뷰에서 TwoJeys를
  // "men's jewelry brand"로 반복 정의. Shopify 상품 태그에는 성별 신호가
  // 없으므로 상품 단위 추론 대신 검증된 브랜드 타깃을 최하위 기본값으로 쓴다.
  twojeys: ["men"],
  toomuch: ["women"], // 여성 의류/드레스/란제리/스윔웨어 카탈로그, 남성 라인 없음
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

/** 혼성 사이트에서 공식 상품명 표기가 제공하는 상품 단위 성별 근거. */
export function inferVerifiedSiteGenderFromName(
  site: string,
  name: unknown,
): ProductGender | null {
  if (typeof name !== "string") return null
  if (site === "afb-afb-afb" && /^WMS\b/i.test(name.trim())) return "women"
  if (
    site === "whateverwewant" &&
    (/(?:^|\W)(?:WOMAN|WOMEN|W'S)(?:\W|$)/i.test(name) || /^W(?:\s|[-_])/i.test(name.trim()))
  ) return "women"
  if (site === "yiyae" && /(?:^|\W)W'S(?:\W|$)/i.test(name)) return "women"
  return null
}
