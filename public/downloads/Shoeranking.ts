export const PRIORITY_BRANDS = ["Nike", "Asics", "Adidas"] as const;

export type ShoeRecommendationKind = "general" | "matched";

export function isPreferredBrand(brand: string) {
  return PRIORITY_BRANDS.some(
    (preferred) => preferred.toLowerCase() === brand.toLowerCase(),
  );
}

export function recommendationKind(
  strike: string | null | undefined,
): ShoeRecommendationKind {
  return !strike || strike === "unknown" ? "general" : "matched";
}

/** First occurrence of each preferred brand, then emit in PRIORITY_BRANDS order. */
export function preferredInPriorityOrder<T extends { shoe: { brand: string } }>(
  scored: T[],
  limit = 3,
): T[] {
  const bestByBrand = new Map<string, T>();
  for (const pick of scored) {
    if (!isPreferredBrand(pick.shoe.brand)) continue;
    const key = pick.shoe.brand.toLowerCase();
    if (!bestByBrand.has(key)) bestByBrand.set(key, pick);
  }
  const ordered: T[] = [];
  for (const brand of PRIORITY_BRANDS) {
    const pick = bestByBrand.get(brand.toLowerCase());
    if (pick) ordered.push(pick);
    if (ordered.length >= limit) break;
  }
  return ordered;
}
