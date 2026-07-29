import type {Cafe24Page} from "../../cafe24-page"

/**
 * 상세 페이지에서 뽑아오는 필드.
 *
 * 2026-07-29: color/description 제거 — color 는 VLM(product_features
 * .primary_color)이 단일 출처가 됐고, description 은 소비처가 없어 폐기됐다.
 * material 은 migration 079 에서 DB 컬럼이 드롭됐지만 추출 로직은 향후 부활
 * 대비로 남겨둔 상태(import-products.ts:681) 라 여기서도 유지한다.
 */
export interface DetailData {
  material: string | null
  productCode: string | null
}

export interface IDetailParser {
  parse(page: Cafe24Page, productUrl: string): Promise<DetailData>
}
