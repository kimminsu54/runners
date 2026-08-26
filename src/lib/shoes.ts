import type { FootStrike } from "@/lib/landing-analysis";
import type { PaceBand, SessionSummary } from "@/lib/session-summary";
import catalog from "@/data/shoes.json";
// Catalog source of truth for editors: src/data/shoes.csv. Re-emit JSON if that file changes.

export type ShoeCategory = "쿠션화" | "안정화" | "제어화";
export type ShoeStrikeFit = "rearfoot" | "midfoot" | "any" | "unspecified";

export type Shoe = {
  brand: string;
  model: string;
  category: ShoeCategory;
  recommendedStrike: ShoeStrikeFit;
  heelDropMm: number | null;
  weightG: number | null;
  features: string;
};

export type ShoePick = {
  shoe: Shoe;
  score: number;
  reasons: string[];
};

export type ShoeRecommendation = {
  targetStrike: FootStrike | "mixed";
  headline: string;
  note: string;
  picks: ShoePick[];
};

const SHOES = catalog as Shoe[];

const STRIKE_LABEL: Record<Exclude<FootStrike, "unknown"> | "mixed", string> = {
  rearfoot: "리어풋",
  midfoot: "미드풋",
  forefoot: "포어풋",
  mixed: "혼합",
};

const REARFOOT_AVOID =
  /리어풋 (주자|착지).{0,12}(권장되지 않|부적합)|뒤꿈치 착지.{0,8}(부적합|적합하지 않|불리)|힐 스트라이커.{0,8}(부적합|불리|불안정)/;
const FOREFOOT_HINT =
  /전족(부)? 착지|포어풋|미드풋[·~\-～]?전족|중족[·~\-～]?전족|전족 푸시오프/;
const REARFOOT_HINT = /뒤꿈치 착지|리어풋 착지|힐 스트라이크|힐 스트라이커/;
const MIDFOOT_HINT = /미드풋 착지|중족 착지|중족~전족/;

export function listShoes(): Shoe[] {
  return SHOES;
}

export function recommendShoes(
  summary: Pick<
    SessionSummary,
    "dominantStrike" | "strikeCounts" | "pace" | "meanPeakGrfBw" | "patterns"
  >,
  limit = 3,
): ShoeRecommendation | null {
  const target = summary.dominantStrike;
  if (target === "unknown") return null;

  const preferStability =
    summary.meanPeakGrfBw >= 2.8 ||
    summary.patterns.some((pattern) => pattern.level !== "monitor");
  const scored = SHOES.flatMap((shoe) => {
    const pick = scoreShoe(shoe, target, summary.pace, preferStability);
    return pick ? [pick] : [];
  }).sort((a, b) => b.score - a.score || brandModel(a) - brandModel(b));

  const picks = diversify(scored, limit);
  if (!picks.length) return null;

  return {
    targetStrike: target,
    headline:
      target === "mixed"
        ? "혼합 주법에는 착지를 가리지 않는 신발을 먼저 봅니다."
        : `${STRIKE_LABEL[target]} 착지에 구조가 맞는 신발을 골랐습니다.`,
    note:
      target === "forefoot"
        ? "카탈로그에는 포어풋 전용 라벨이 없어, 저드롭·전족 전환이 빠른 미드풋 계열을 올렸습니다. 피팅과 부상 병력이 최종 기준입니다."
        : "주법에 맞는 드롭과 롤링일 뿐, 발 모양·부상 병력·코스를 대신하지 않습니다. 매장에서 신어 보세요.",
    picks,
  };
}

export function scoreShoe(
  shoe: Shoe,
  target: Exclude<FootStrike, "unknown"> | "mixed",
  pace: PaceBand,
  preferStability: boolean,
): ShoePick | null {
  if (shoe.recommendedStrike === "unspecified") return null;
  if (shoe.category === "제어화" && !preferStability) return null;
  if (target === "rearfoot" && REARFOOT_AVOID.test(shoe.features)) return null;
  if (
    target === "forefoot" &&
    shoe.recommendedStrike === "rearfoot" &&
    (shoe.heelDropMm == null || shoe.heelDropMm >= 8)
  ) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];

  if (target === "mixed") {
    if (shoe.recommendedStrike === "any") {
      score += 40;
      reasons.push("리어풋·미드풋 모두 받는 전 주법 대응");
    } else {
      score += 16;
      reasons.push(
        shoe.recommendedStrike === "rearfoot"
          ? "혼합 주법 중 리어풋 구간에 맞춤"
          : "혼합 주법 중 미드풋·전족 구간에 맞춤",
      );
    }
  } else if (shoe.recommendedStrike === target) {
    score += 40;
    reasons.push(`${STRIKE_LABEL[target]} 착지용으로 분류된 모델`);
  } else if (target === "forefoot" && shoe.recommendedStrike === "midfoot") {
    score += 34;
    reasons.push("포어풋과 가까운 미드풋·전족 전환 구조");
  } else if (shoe.recommendedStrike === "any") {
    score += 24;
    reasons.push("착지 위치를 가리지 않는 롤링");
  } else if (target === "midfoot" && shoe.recommendedStrike === "rearfoot") {
    score += 8;
  } else if (target === "rearfoot" && shoe.recommendedStrike === "midfoot") {
    if (shoe.heelDropMm != null && shoe.heelDropMm <= 3) return null;
    score += 10;
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
      reasons.push("충격이 큰 편이라 안정화 구조를 우선");
    } else if (shoe.category === "제어화") {
      score += 6;
    } else {
      score -= 2;
    }
  } else if (shoe.category === "쿠션화") {
    score += 6;
  }

  if (isEasyPace(pace)) {
    if (shoe.weightG != null && shoe.weightG >= 240 && shoe.weightG <= 320) {
      score += 6;
    }
    if (shoe.weightG != null && shoe.weightG <= 200) score -= 6;
  } else if (isFastPace(pace)) {
    if (shoe.weightG != null && shoe.weightG <= 240) {
      score += 8;
      reasons.push(`무게 ${shoe.weightG}g · 빠른 페이스에 부담이 적음`);
    }
    if (shoe.weightG != null && shoe.weightG >= 310) score -= 6;
  }

  if (reasons.length === 0) {
    reasons.push(`${shoe.category} · ${strikeFitLabel(shoe.recommendedStrike)}`);
  }

  return { shoe, score, reasons: unique(reasons).slice(0, 3) };
}

function diversify(picks: ShoePick[], limit: number): ShoePick[] {
  const chosen: ShoePick[] = [];
  const brands = new Set<string>();
  for (const pick of picks) {
    if (brands.has(pick.shoe.brand)) continue;
    chosen.push(pick);
    brands.add(pick.shoe.brand);
    if (chosen.length >= limit) return chosen;
  }
  for (const pick of picks) {
    if (chosen.includes(pick)) continue;
    chosen.push(pick);
    if (chosen.length >= limit) break;
  }
  return chosen;
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

function brandModel(pick: ShoePick) {
  return `${pick.shoe.brand} ${pick.shoe.model}`.localeCompare(" ");
}
