/**
 * Product 검증 게이트 (SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-001 / REQ-CRAWLER-002)
 *
 * 방침 A (HARD): 본 스키마는 **현재 파서 출력 형태를 박제**할 뿐이다.
 * 신규 필드 도입도, 현재 크롤러가 내보내는 product 를 reject 할 만큼 더 엄격한
 * 규칙 도입도 하지 않는다. 유효 product 는 변형 없이 그대로 통과하고, 무효
 * product (필수 필드 누락 / 타입 불일치) 만 write 에서 차단된다.
 *
 * 방침 A 예외 — category / color:
 * products 테이블에 NOT NULL 제약 적용(migration 091) 에 따라 두 필드는
 * 빈 문자열·null 모두 거부한다. 추출 불가 상품은 적재하지 않는다.
 *
 * 스키마 결정 근거 (cross-check 소스):
 *  - `src/lib/types.ts` 의 `Product` 인터페이스 (현재 출력 형 계약).
 *  - `tests/fixtures/uniqlo-kr-parse.golden.json` (100개 실제 출력 product —
 *    base 필드 항상 존재, salePrice 는 null 가능, 선택 detail 필드는 존재 시만).
 *  - `tests/fixtures/detail/*.golden.json` (18개 detail 스냅샷 — description /
 *    color / material / productCode 는 string 또는 null. preserve-findings 의
 *    "오염된 material 잡텍스트" / "전부 null" 같은 현재 깨진 동작도 통과해야 함).
 *
 * 따라서 detail 류 선택 필드는 `string | null` 을 모두 수용하고, price 류는
 * `Product` 타입대로 `number | null` 을 수용한다.
 */

import {z} from "zod"
import type {Product} from "../types.js"

// @MX:ANCHOR: [AUTO] validateProduct() is the crawler write-boundary contract —
//   every product crossing into JSON output or DB upsert passes through here.
// @MX:REASON: REQ-CRAWLER-001 mandates this as the single validation gate before
//   any persistence; new call sites must reuse it rather than re-deriving rules,
//   and the schema must stay shape-faithful to src/lib/types.ts Product (no
//   stricter-than-current rules — would reject products the crawler emits today).
// @MX:SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-001, REQ-CRAWLER-002

/** 현재 출력 detail 필드 패턴: 부재(undefined) / null / 임의 문자열 모두 수용. */
const optionalStringOrNull = z.string().nullish()

/**
 * 현재 `Product` 출력 형태를 박제한 Zod 스키마.
 *
 * - base 필드: golden 상 100% 존재. 단 `Product` 타입상 price 3종은
 *   `number | null`, salePrice 는 null 빈번 → number|null 수용.
 * - gender: `string[]` (항상 배열로 출력).
 * - detail/리뷰 필드: 모두 선택. 현재 출력에서 null 또는 잡텍스트가 나올 수
 *   있으므로 reject 하지 않는다 (방침 A — 깨진 동작 보존).
 * - passthrough: 알 수 없는 추가 키가 있어도 reject 하지 않고 그대로 통과
 *   (검증 게이트는 출력을 변형/축소하지 않는다).
 */
export const ProductSchema = z
  .object({
    brand: z.string(),
    name: z.string(),
    category: z.string().min(1),
    price: z.number().nullable(),
    originalPrice: z.number().nullable(),
    salePrice: z.number().nullable(),
    priceFormatted: z.string(),
    imageUrl: z.string(),
    productUrl: z.string(),
    inStock: z.boolean(),
    gender: z.array(z.string()),
    platform: z.string(),
    crawledAt: z.string(),
    // ── 상세 페이지 데이터 (선택) ──
    description: optionalStringOrNull,
    color: z.string().min(1),
    material: optionalStringOrNull,
    subcategory: optionalStringOrNull,
    images: z.array(z.string()).nullish(),
    sizeInfo: optionalStringOrNull,
    tags: z.array(z.string()).nullish(),
    productCode: optionalStringOrNull,
    sourceCurrency: z.enum(["USD", "EUR", "GBP", "KRW"]).optional(),
    sourcePrice: z.number().optional(),
    // ── 리뷰 데이터 (선택) ──
    reviewCount: z.number().optional(),
    reviews: z.array(z.unknown()).optional(),
  })
  // 알 수 없는 추가 키를 보존 — 게이트는 출력을 축소/변형하지 않는다.
  .passthrough()

export interface ValidateOk {
  ok: true
  value: Product
}

export interface ValidateErr {
  ok: false
  /** 첫 번째 실패 필드 경로 (예: "name", "gender"). */
  failedField: string
  /** 실패 필드의 원본 값 (직렬화, 200자 제한). */
  rawValue: string
  /** 사람이 읽을 수 있는 실패 메시지. */
  message: string
  /** zod 전체 이슈 (디버깅용). */
  issues: z.ZodIssue[]
}

export type ValidateResult = ValidateOk | ValidateErr

function serializeRaw(value: unknown): string {
  let s: string
  try {
    s = typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    s = String(value)
  }
  if (s === undefined) s = "undefined"
  return s.length > 200 ? s.slice(0, 200) + "…" : s
}

/**
 * 단일 product 를 ProductSchema 로 검증한다.
 *
 * 유효 → `{ ok: true, value }` (value 는 입력과 동일 객체 그래프 — 변형 없음).
 * 무효 → `{ ok: false, ... }` 첫 실패 필드/원본값/메시지 포함.
 *
 * @MX:NOTE: [AUTO] Returns the validated object by reference (no transform):
 *   a valid product is byte-identical to its input — required for the
 *   golden-master byte-identical invariant.
 */
export function validateProduct(p: unknown): ValidateResult {
  const parsed = ProductSchema.safeParse(p)
  if (parsed.success) {
    // .passthrough() 로 알 수 없는 키까지 보존되므로 입력과 동형.
    return {ok: true, value: parsed.data as unknown as Product}
  }

  const issues = parsed.error.issues
  const first = issues[0]
  const failedField = first.path.length > 0 ? first.path.join(".") : "(root)"

  // 실패 필드의 원본 값 추출 (객체일 때만 경로 1-depth 접근).
  let rawValue: unknown = p
  if (
    p !== null &&
    typeof p === "object" &&
    first.path.length > 0 &&
    typeof first.path[0] === "string"
  ) {
    rawValue = (p as Record<string, unknown>)[first.path[0] as string]
  }

  return {
    ok: false,
    failedField,
    rawValue: serializeRaw(rawValue),
    message: first.message,
    issues,
  }
}
