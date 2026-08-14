/** Pure brand-node resolution shared by product import paths. */
export function resolveProductBrandNodeIdFromMaps(
  brand: string,
  platform: string,
  brandIdMap: ReadonlyMap<string, number>,
  platformBrandIdMap: ReadonlyMap<string, number>,
  retailerPlatformKeys: ReadonlySet<string>,
): number | null {
  // 단일 브랜드몰은 크롤 상태의 platform_key가 가리키는 노드가 정식 대상이다.
  // 동일한 brand_name 중복 노드가 있으면 전역 이름 맵의 마지막 행이 우연히
  // 선택될 수 있으므로, 플랫폼 매핑을 정확한 이름보다 먼저 사용한다.
  if (!retailerPlatformKeys.has(platform)) {
    const platformBrandId = platformBrandIdMap.get(platform)
    if (platformBrandId !== undefined) return platformBrandId
  }
  const exactBrandId = brandIdMap.get(brand.toLocaleLowerCase("en-US"))
  if (exactBrandId !== undefined) return exactBrandId
  if (retailerPlatformKeys.has(platform)) return null
  return null
}

export function canUsePlatformBrandFallback(
  platform: string,
  retailerPlatformKeys: ReadonlySet<string>,
): boolean {
  return !retailerPlatformKeys.has(platform)
}
