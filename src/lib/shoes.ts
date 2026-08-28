import type { FootStrike } from "@/lib/landing-analysis";
import {
  PRIORITY_BRANDS,
  isPreferredBrand,
  recommendShoes as rankShoes,
  shoeFitsStrike,
  type CatalogStrike,
} from "@/lib/Shoeranking";
import type { PaceBand, SessionSummary } from "@/lib/session-summary";
import catalog from "@/data/shoes.json";
// Catalog source of truth for editors: src/data/shoes.csv. Re-emit JSON if that file changes.

export type ShoeCategory = "쿠션화" | "안정화" | "제어화";
export type ShoeStrikeFit = CatalogStrike | "unspecified";

export type Shoe = {
  brand: string;
  model: string;
  category: ShoeCategory;
  recommendedStrike: ShoeStrikeFit;
  recommendedStrikes: CatalogStrike[];
  heelDropMm: number | null;
  weightG: number | null;
  features: string;
};

export type ShoePick = {
  shoe: Shoe;
  score: number;
  reasons: string[];
};

export type GeneralShoeRecommendation = {
  kind: "general";
};

export type MatchedShoeRecommendation = {
  kind: "matched";
  targetStrike: Exclude<FootStrike, "unknown"> | "mixed";
  headline: string;
  note: string;
  primary: ShoePick[];
  others: ShoePick[];
  picks: ShoePick[];
  secondaryPicks: ShoePick[];
};

export type ShoeRecommendation =
  | GeneralShoeRecommendation
  | MatchedShoeRecommendation;

export { PRIORITY_BRANDS, isPreferredBrand };

const SHOES = catalog as Shoe[];

const STRIKE_LABEL: Record<Exclude<FootStrike, "unknown"> | "mixed", string> = {
  rearfoot: "리어풋",
  midfoot: "미드풋",
  forefoot: "포어풋",
  mixed: "혼합",
};

/**
 * Weight bands, in grams. The catalog's prose mentions plates, but half of the
 * mentions are "무플레이트" / "플레이트 없는", so weight is the signal that can
 * actually be trusted for what a shoe is *for*.
 */
const RACING_WEIGHT_G = 215;
const DAILY_TRAINER_MIN_G = 240;
const DAILY_TRAINER_MAX_G = 320;

const REARFOOT_AVOID =
  /리어풋 (주자|착지).{0,12}(권장되지 않|부적합)|뒤꿈치 착지.{0,8}(부적합|적합하지 않|불리)|힐 스트라이커.{0,8}(부적합|불리|불안정)/;
const FOREFOOT_HINT =
  /전족(부)? 착지|포어풋|미드풋[·~\-～]?전족|중족[·~\-～]?전족|전족 푸시오프/;
const REARFOOT_HINT = /뒤꿈치 착지|리어풋 착지|힐 스트라이크|힐 스트라이커/;
const MIDFOOT_HINT = /미드풋 착지|중족 착지|중족~전족/;

export function listShoes(): Shoe[] {
  return SHOES;
}

export function shoeSlug(shoe: Pick<Shoe, "brand" | "model">): string {
  return `${shoe.brand} ${shoe.model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const SHOE_PHOTOS = new Set([
  "adidas-adizero-adios-pro-4",
  "adidas-adizero-boston-12",
  "adidas-adizero-sl-2",
  "adidas-supernova-rise",
  "adidas-supernova-solution",
  "altra-fwd-via",
  "altra-provision-8",
  "altra-vanish-carbon-2",
  "asics-gel-cumulus-26",
  "asics-gel-kayano-30",
  "asics-gt-1000-12",
  "asics-magic-speed-4",
  "asics-metaspeed-sky-paris",
  "asics-novablast-4",
  "brooks-glycerin-21",
  "brooks-glycerin-gts-21",
  "brooks-hyperion-elite-4",
  "brooks-hyperion-max-2",
  "brooks-launch-10",
  "hoka-arahi-7",
  "hoka-bondi-8",
  "hoka-cielo-x1",
  "hoka-clifton-9",
  "hoka-mach-6",
  "mizuno-wave-horizon-7",
  "mizuno-wave-inspire-20",
  "mizuno-wave-rebellion-flash-2",
  "mizuno-wave-rebellion-pro-2",
  "new-balance-fresh-foam-x-880-v14",
  "new-balance-fresh-foam-x-vongo-v6",
  "new-balance-fuelcell-sc-pacer-v2",
  "new-balance-fuelcell-sc-trainer-v3",
  "nike-infinity-run-4-infinityrn-4",
  "nike-pegasus-plus",
  "nike-streakfly",
  "nike-structure-25",
  "nike-vomero-17",
  "nike-zoom-fly-6",
  "on-cloudboom-echo-3",
  "on-cloudboom-strike",
  "on-cloudrunner-2",
  "on-cloudsurfer",
  "puma-deviate-nitro-3",
  "puma-foreverrun-nitro",
  "saucony-endorphin-pro-4",
  "saucony-hurricane-24",
  "saucony-kinvara-14",
  "saucony-ride-17",
  "saucony-tempus",
  "saucony-triumph-22",
]);

export function shoeImageSrc(shoe: Pick<Shoe, "brand" | "model">): string | null {
  const slug = shoeSlug(shoe);
  return SHOE_PHOTOS.has(slug) ? `/images/shoes/${slug}.jpg` : null;
}

export function recommendShoes(
  summary: Pick<
    SessionSummary,
    "dominantStrike" | "strikeCounts" | "pace" | "meanPeakGrfBw" | "patterns"
  >,
  limit = 3,
): ShoeRecommendation {
  const target = summary.dominantStrike;
  if (target === "unknown") return { kind: "general" };

  // Two different findings ask for a stability shoe, and they do not mean the
  // same thing. Keep them apart so the card can say which one it saw: a 2.0 BW
  // session flagged only by a pattern must not be told its impact was large.
  const stability: StabilityReason =
    summary.meanPeakGrfBw >= 2.8
      ? "impact"
      : summary.patterns.some((pattern) => pattern.level !== "monitor")
        ? "pattern"
        : "none";
  const scored = SHOES.flatMap((shoe) => {
    const pick = scoreShoe(shoe, target, summary.pace, stability);
    return pick
      ? [
          {
            ...pick,
            brand: shoe.brand,
            score: pick.score,
            strikes: shoe.recommendedStrikes,
          },
        ]
      : [];
  });
  const ranked = rankShoes(scored, target, limit);
  if (ranked.kind === "general") return { kind: "general" };

  return {
    kind: "matched",
    targetStrike: target,
    headline:
      target === "mixed"
        ? "혼합 주법에는 착지를 가리지 않는 신발을 먼저 봅니다."
        : `${STRIKE_LABEL[target]} 착지에 구조가 맞는 신발을 골랐습니다.`,
    note: "나이키·아식스·아디다스를 우선하고, 그다음 다른 브랜드를 둡니다. 주법에 맞는 드롭과 롤링일 뿐 피팅을 대신하지 않습니다.",
    primary: ranked.primary,
    others: ranked.others,
    picks: ranked.primary,
    secondaryPicks: ranked.others,
  };
}

/**
 * Why a stability shoe is being favoured, or `"none"` if it is not.
 * `"impact"` is a high mean GRF; `"pattern"` is a flagged load pattern at any
 * impact level. The reason text on the card depends on which one fired.
 */
export type StabilityReason = "none" | "impact" | "pattern";

export function scoreShoe(
  shoe: Shoe,
  target: Exclude<FootStrike, "unknown"> | "mixed",
  pace: PaceBand,
  stability: StabilityReason,
): ShoePick | null {
  const preferStability = stability !== "none";
  const strikes = shoe.recommendedStrikes ?? [];
  if (!strikes.length || shoe.recommendedStrike === "unspecified") return null;
  if (!shoeFitsStrike(strikes, target)) return null;
  if (shoe.category === "제어화" && !preferStability) return null;
  if (target === "rearfoot" && REARFOOT_AVOID.test(shoe.features)) return null;

  let score = 0;
  const reasons: string[] = [];

  if (target === "mixed") {
    if (strikes.includes("any")) {
      score += 40;
      reasons.push("리어풋·미드풋 모두 받는 전 주법 대응");
    } else {
      score += 16;
      reasons.push(
        strikes.includes("rearfoot")
          ? "혼합 주법 중 리어풋 구간에 맞춤"
          : "혼합 주법 중 미드풋·전족 구간에 맞춤",
      );
    }
  } else if (strikes.includes(target)) {
    score += 40;
    reasons.push(`${STRIKE_LABEL[target]} 착지용으로 분류된 모델`);
  } else if (strikes.includes("any")) {
    score += 24;
    reasons.push("착지 위치를 가리지 않는 롤링");
  } else {
    return null;
  }

  const drop = shoe.heelDropMm;
  if (drop != null) {
    if (target === "rearfoot") {
      if (drop >= 10) {
        score += 16;
        reasons.push(`힐 드롭 ${formatDrop(drop)}로 뒤꿈치 착지 전환이 수월`);
      } else if (drop >= 8) {
        score += 10;
        reasons.push(`힐 드롭 ${formatDrop(drop)}`);
      } else if (drop <= 4) {
        score -= 14;
      }
    } else if (target === "midfoot") {
      if (drop <= 6) {
        score += 14;
        reasons.push(`힐 드롭 ${formatDrop(drop)}로 중족 착지에 가깝게 붙음`);
      } else if (drop <= 8) {
        score += 8;
        reasons.push(`힐 드롭 ${formatDrop(drop)}`);
      } else if (drop >= 12) {
        score -= 8;
      }
    } else if (target === "forefoot") {
      if (drop <= 4) {
        score += 18;
        reasons.push(`힐 드롭 ${formatDrop(drop)}의 저드롭·전족 친화 구조`);
      } else if (drop <= 6.5) {
        score += 12;
        reasons.push(`힐 드롭 ${formatDrop(drop)}`);
      } else if (drop >= 10) {
        score -= 16;
      }
    } else if (target === "mixed" && drop >= 5 && drop <= 10) {
      score += 6;
    }
  }

  if (target === "forefoot" && FOREFOOT_HINT.test(shoe.features)) {
    score += 10;
    reasons.push("전족 착지·푸시오프를 전제로 한 지오메트리");
  }
  if (target === "rearfoot" && REARFOOT_HINT.test(shoe.features)) {
    score += 8;
  }
  if (target === "midfoot" && MIDFOOT_HINT.test(shoe.features)) {
    score += 6;
  }

  if (preferStability) {
    if (shoe.category === "안정화") {
      score += 10;
      reasons.push(
        stability === "impact"
          ? "추정 반력이 큰 편이라 안정화 구조를 우선"
          : "반복된 부담 패턴이 있어 안정화 구조를 우선",
      );
    } else if (shoe.category === "제어화") {
      score += 6;
    } else {
      score -= 2;
    }
  } else if (shoe.category === "쿠션화") {
    score += 6;
  }

  if (shoe.weightG != null) {
    if (isEasyPace(pace)) {
      if (shoe.weightG <= RACING_WEIGHT_G) {
        // Purpose has to beat geometry here. A racing flat fits a midfoot
        // strike on paper — low drop, close to the ground — and collects the
        // full geometry bonus for it, but it is not the shoe for an easy daily
        // run. The largest geometry bonus a shoe can gather is 20 (drop 14 +
        // strike hint 6), so this penalty is sized to outweigh that rather
        // than picked to taste.
        score -= 22;
        reasons.push(`${shoe.weightG}g 레이싱 지향 · 편한 페이스에는 가벼운 편`);
      } else if (shoe.weightG < DAILY_TRAINER_MIN_G) {
        // A graded step, not a cliff: the old rule turned on at 200 g, so a
        // 201 g racer slipped through untouched.
        score -= 8;
      } else if (shoe.weightG <= DAILY_TRAINER_MAX_G) {
        score += 6;
        reasons.push(`무게 ${shoe.weightG}g · 편한 페이스 데일리 중량`);
      } else if (shoe.weightG >= 340) {
        score -= 4;
      }
    } else if (isFastPace(pace)) {
      if (shoe.weightG <= 240) {
        score += 8;
        reasons.push(`무게 ${shoe.weightG}g · 빠른 페이스에 부담이 적음`);
      }
      if (shoe.weightG >= 310) score -= 6;
    }
  }

  if (reasons.length === 0) {
    reasons.push(`${shoe.category} · ${strikeFitLabel(shoe.recommendedStrike)}`);
  }

  return { shoe, score, reasons: unique(reasons).slice(0, 3) };
}

function isEasyPace(pace: PaceBand) {
  return pace === "walk" || pace === "easy" || pace === "steady";
}

function isFastPace(pace: PaceBand) {
  return pace === "brisk" || pace === "fast" || pace === "sprint";
}

function formatDrop(mm: number) {
  return Number.isInteger(mm) ? `${mm}mm` : `${mm}mm`;
}

function strikeFitLabel(fit: ShoeStrikeFit) {
  if (fit === "rearfoot") return "리어풋 권장";
  if (fit === "midfoot") return "미드풋 권장";
  if (fit === "any") return "전 주법";
  return "주법 미분류";
}

function unique(values: string[]) {
  return [...new Set(values)];
}
