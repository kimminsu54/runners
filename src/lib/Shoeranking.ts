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

/**
 * A yes/no catalog column. Only an explicit yes counts: a blank cell means the
 * row has not been classified yet, not that the answer is no. Ranking may act
 * on `true`, but must never read `false` as a verified "no".
 */
export function parseFlagCell(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const text = String(raw).trim().toUpperCase();
  return text === "Y" || text === "YES" || text === "TRUE" || text === "1";
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
  /**
   * Whether the caller can show this shoe. The card carries a photograph, and
   * the project's standing rule is that anything recommendable has one — so
   * between two shoes that scored the same and are equally specific, the one
   * that can be shown is the better card. It ranks below both of those on
   * purpose: a picture is not a reason to prefer a shoe, only a reason to
   * prefer it over an equal.
   */
  hasPhoto?: boolean;
  /** Only used to break a tie that everything else leaves level. */
  model?: string;
};

/**
 * How many strike patterns a catalog row claims to suit. Lower is a more
 * specific answer to the question that was asked.
 *
 * A row labelled `전체` serves all four pools and says nothing about the runner
 * in front of it; one labelled `미드풋` was put in that column deliberately.
 * Given two shoes that scored the same, the specific one is the better answer.
 */
function strikeReach(item: Rankable): number {
  const strikes = item.strikes;
  // No labels at all is the general path, where nothing was filtered and
  // specificity is not a question. Rank it last of the ties rather than first.
  if (!strikes?.length) return 9;
  return strikes.includes("any") ? 4 : strikes.length;
}

export type RankedRecommendation<T extends Rankable> =
  | { kind: "general" }
  | { kind: "matched"; primary: T[]; others: T[] };

/**
 * Filter by strike pool, sort by score, then emit Nike → Asics → Adidas.
 *
 * The sort has to settle every tie from the rows themselves, because the order
 * they arrive in is not this project's to control. The catalog is a CSV shared
 * with another implementation; re-sorting it there, or re-emitting it, must not
 * change which shoes this app recommends. It did: reversing the rows changed
 * four of six recommendation sets, swapping a Gel-Cumulus for a Gel-Nimbus and
 * an Adios Pro for a Takumi Sen — shoes that scored identically, so the winner
 * was whichever happened to be written down first.
 *
 * Score first, then the more specific strike label, then a shoe the card can
 * actually show, then brand and model by name. The last two decide nothing
 * about quality; they exist so that two equally good, equally specific shoes
 * come out in the same order every time.
 */
export function recommendShoes<T extends Rankable>(
  catalog: T[],
  strike: string,
  limit = 3,
): RankedRecommendation<T> {
  if (recommendationKind(strike) === "general") return { kind: "general" };

  const eligible = catalog
    .filter((item) => !item.strikes || shoeFitsStrike(item.strikes, strike))
    .sort(
      (a, b) =>
        b.score - a.score ||
        strikeReach(a) - strikeReach(b) ||
        Number(b.hasPhoto ?? false) - Number(a.hasPhoto ?? false) ||
        a.brand.localeCompare(b.brand) ||
        (a.model ?? "").localeCompare(b.model ?? ""),
    );

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
