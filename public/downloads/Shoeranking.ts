export const PRIORITY_BRANDS = ["Nike", "Asics", "Adidas"] as const;

export type ShoeRecommendationKind = "general" | "matched";
export type CatalogStrike = "rearfoot" | "midfoot" | "forefoot" | "any";

export const STRIKE_POOL: Record<string, ReadonlySet<CatalogStrike>> = {
  rearfoot: new Set(["rearfoot", "any"]),
  midfoot: new Set(["midfoot", "any"]),
  forefoot: new Set(["forefoot", "any"]),
  mixed: new Set(["rearfoot", "midfoot", "forefoot", "any"]),
};

const STRIKE_LABEL: Record<string, CatalogStrike> = {
  리어풋: "rearfoot",
  미드풋: "midfoot",
  포어풋: "forefoot",
  전체: "any",
  rearfoot: "rearfoot",
  midfoot: "midfoot",
  forefoot: "forefoot",
  any: "any",
};

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

export function parseNumericCell(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || text.toUpperCase() === "N/A") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function parseStrikeCell(raw: string | null | undefined): CatalogStrike[] {
  if (raw == null) return [];
  const text = raw.trim();
  if (!text || text.toUpperCase() === "N/A") return [];
  const strikes: CatalogStrike[] = [];
  for (const part of text.split("|")) {
    const mapped = STRIKE_LABEL[part.trim()];
    if (mapped && !strikes.includes(mapped)) strikes.push(mapped);
  }
  return strikes;
}

export function shoeFitsStrike(
  strikes: CatalogStrike[],
  target: string,
): boolean {
  if (!strikes.length) return false;
  const pool = STRIKE_POOL[target];
  if (!pool) return false;
  return strikes.some((strike) => pool.has(strike));
}

export type Rankable = {
  brand: string;
  score: number;
  strikes?: CatalogStrike[];
};

export type RankedRecommendation<T extends Rankable> =
  | { kind: "general" }
  | { kind: "matched"; primary: T[]; others: T[] };

/** Filter by strike pool, sort by score, then emit Nike → Asics → Adidas. */
export function recommendShoes<T extends Rankable>(
  catalog: T[],
  strike: string,
  limit = 3,
): RankedRecommendation<T> {
  if (recommendationKind(strike) === "general") return { kind: "general" };

  const eligible = catalog
    .filter((item) => !item.strikes || shoeFitsStrike(item.strikes, strike))
    .sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand));

  const bestByBrand = new Map<string, T>();
  for (const item of eligible) {
    const key = item.brand.toLowerCase();
    if (!bestByBrand.has(key)) bestByBrand.set(key, item);
  }

  const primary: T[] = [];
  const used = new Set<T>();
  for (const brand of PRIORITY_BRANDS) {
    const pick = bestByBrand.get(brand.toLowerCase());
    if (!pick) continue;
    primary.push(pick);
    used.add(pick);
    if (primary.length >= limit) break;
  }

  const others: T[] = [];
  const otherBrands = new Set<string>();
  for (const item of eligible) {
    if (used.has(item) || isPreferredBrand(item.brand)) continue;
    if (otherBrands.has(item.brand)) continue;
    others.push(item);
    otherBrands.add(item.brand);
    if (others.length >= limit) break;
  }

  if (!primary.length && !others.length) return { kind: "general" };
  return { kind: "matched", primary, others };
}
