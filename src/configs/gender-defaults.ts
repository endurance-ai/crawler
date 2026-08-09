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

/** 사이트 문맥상 아동복 신호가 아닌 상품명 표현을 kids 가드에서만 제거한다. */
export const SITE_KIDS_GENDER_NOISE_PATTERNS: Record<string, RegExp[]> = {
  // 여성용 슬림핏 티셔츠의 상품형 이름. 실제 아동 라인은 없다.
  toomuch: [/\bbaby[-\s]?(?:t|tee|t[-\s]?shirt)\b/gi],
}
