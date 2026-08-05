/** Pure brand-node resolution shared by product import paths. */
export function resolveProductBrandNodeIdFromMaps(
  brand: string,
  platform: string,
  brandIdMap: ReadonlyMap<string, number>,
  platformBrandIdMap: ReadonlyMap<string, number>,
  retailerPlatformKeys: ReadonlySet<string>,
): number | null {
  const exactBrandId = brandIdMap.get(brand.toLocaleLowerCase("en-US"))
  if (exactBrandId !== undefined) return exactBrandId
  if (retailerPlatformKeys.has(platform)) return null
  return platformBrandIdMap.get(platform) ?? null
}

export function canUsePlatformBrandFallback(
  platform: string,
  retailerPlatformKeys: ReadonlySet<string>,
): boolean {
  return !retailerPlatformKeys.has(platform)
}
