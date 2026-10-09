// R17-E — the ONE category rule for every provider work surface.
//
// The provider's authorised categories are an upper bound. A browse filter may
// narrow them, never replace or widen them:
//
//     effective = providerCategories ∩ requestedCategory
//
// Before R17-E the legacy and canonical feeds each wrote `requested ?? own`,
// so a provider could read any globally active category's requests by naming
// it, and a provider with no categories could name one to obtain work at all.
// Detail and bid submission never accept a filter and pass `null` here, so the
// three surfaces now answer from the same function.
//
// An empty result means "no work", and callers must return an empty page: the
// repository refuses an empty set rather than reading it as "no filter".
export function feedCategoryScope(
  providerCategoryIds: readonly string[],
  requestedCategoryId: string | null | undefined,
): string[] {
  if (!requestedCategoryId) return [...providerCategoryIds];
  return providerCategoryIds.includes(requestedCategoryId) ? [requestedCategoryId] : [];
}
