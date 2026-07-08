import type {Cafe24Page} from "../../cafe24-page"

export interface DetailData {
  description: string | null
  color: string | null
  price?: number | null
  material: string | null
  productCode: string | null
}

export interface IDetailParser {
  parse(page: Cafe24Page, productUrl: string): Promise<DetailData>
}
