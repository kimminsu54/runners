/**
 * A saved session, small enough to keep in the browser forever.
 *
 * The report tells the runner to change one thing and compare — five separate
 * copy sites do. This is what makes that possible: the numbers behind one
 * report, without the clip. Storing the analysis instead of the video keeps
 * "영상은 브라우저 안에서만 처리됩니다" literally true and a saved run at a
 * couple of hundred bytes.
 */
import {
  DISPLAY_FRAME_MS,
  cadenceSpm,
  type AnalysisResult,
  type QualityLevel,
} from "./landing-analysis";
import type { PaceBand, SessionSummary } from "./session-summary";
import type { FootStrike } from "./Footstrike";

export const SNAPSHOT_VERSION = 1;

export type SessionSnapshot = {
  version: number;
  id: string;
  /** Epoch ms. Passed in — this module never reads the clock itself. */
  savedAt: number;
  label: string;
  quality: QualityLevel;
  durationS: number;
  landingCount: number;
  cadenceSpm: number;
  pace: PaceBand;
  dominantStrike: FootStrike | "mixed";
  strikePercents: Record<Exclude<FootStrike, "unknown">, number>;
  meanDutyFactor: number;
  meanContactMs: number;
  meanFlightMs: number;
  meanPeakGrfBw: number;
  meanLoadingRateBwS: number;
  meanKneeFlexContact: number;
  meanScore: number;
  asymmetryPct: number;
};

export function buildSnapshot(input: {
  id: string;
  savedAt: number;
  label: string;
  result: AnalysisResult;
  summary: SessionSummary;
}): SessionSnapshot {
  const { id, savedAt, label, result, summary } = input;
  const percents: Record<Exclude<FootStrike, "unknown">, number> = {
    rearfoot: 0,
    midfoot: 0,
    forefoot: 0,
  };
  for (const row of summary.strikeCounts) {
    if (row.type !== "unknown") percents[row.type] = row.percent;
  }
  const series = result.series;
  return {
    version: SNAPSHOT_VERSION,
    id,
    savedAt,
    label: label.trim() || "이름 없는 세션",
    quality: result.quality.level,
    durationS: series.length ? series[series.length - 1].t - series[0].t : 0,
    landingCount: result.landings.length,
    cadenceSpm: cadenceSpm(result.landings),
    pace: summary.pace,
    dominantStrike: summary.dominantStrike,
    strikePercents: percents,
    meanDutyFactor: summary.meanDutyFactor,
    meanContactMs: summary.meanContactMs,
    meanFlightMs: summary.meanFlightMs,
    meanPeakGrfBw: summary.meanPeakGrfBw,
    meanLoadingRateBwS: summary.meanLoadingRateBwS,
    meanKneeFlexContact: summary.meanKneeFlexContact,
    meanScore: summary.meanScore,
    asymmetryPct: summary.asymmetryPct,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

type NumericKey =
  | "meanPeakGrfBw"
  | "meanLoadingRateBwS"
  | "meanKneeFlexContact"
  | "meanScore"
  | "meanContactMs"
  | "meanFlightMs"
  | "cadenceSpm"
  | "meanDutyFactor"
  | "asymmetryPct";

export type ComparableMetric = {
  key: NumericKey;
  label: string;
  format: (value: number) => string;
  /**
   * Which way reads as a softer landing, or null when the metric only
   * describes the run. Contact and flight are null on purpose: a short contact
   * is a symptom of pace, never something to flag (rule §GRF).
   */
  gentler: "lower" | "higher" | null;
  /** Below this the two runs are the same run twice, not a change. */
  noise: number;
};

export const COMPARABLE_METRICS: ComparableMetric[] = [
  {
    key: "meanPeakGrfBw",
    label: "평균 반력",
    format: (v) => `${v.toFixed(1)} BW`,
    gentler: "lower",
    noise: 0.1,
  },
  {
    key: "meanLoadingRateBwS",
    label: "부하율",
    format: (v) => `${Math.round(v)} BW/s`,
    gentler: "lower",
    noise: 2,
  },
  {
    key: "meanKneeFlexContact",
    label: "접지 순간 무릎",
    format: (v) => `약 ${Math.round(v)}°`,
    gentler: "higher",
    noise: 2,
  },
  {
    key: "meanScore",
    label: "평균 점수",
    format: (v) => String(Math.round(v)),
    gentler: "lower",
    noise: 2,
  },
  {
    key: "cadenceSpm",
    label: "케이던스",
    format: (v) => `분당 약 ${Math.round(v)}보`,
    gentler: null,
    noise: 3,
  },
  {
    key: "meanContactMs",
    label: "접지 시간",
    format: (v) => `약 ${Math.round(v / DISPLAY_FRAME_MS) * DISPLAY_FRAME_MS} ms`,
    gentler: null,
    // One frame. Anything smaller was never observed, only interpolated.
    noise: DISPLAY_FRAME_MS,
  },
  {
    key: "meanFlightMs",
    label: "체공 시간",
    format: (v) => `약 ${Math.round(v / DISPLAY_FRAME_MS) * DISPLAY_FRAME_MS} ms`,
    gentler: null,
    noise: DISPLAY_FRAME_MS,
  },
  {
    key: "meanDutyFactor",
    label: "듀티 팩터",
    format: (v) => v.toFixed(2),
    gentler: null,
    noise: 0.02,
  },
  {
    key: "asymmetryPct",
    label: "좌우 차이",
    format: (v) => `${Math.round(v)}%`,
    gentler: "lower",
    noise: 3,
  },
];

export type MetricChange = {
  metric: ComparableMetric;
  before: number;
  after: number;
  diff: number;
  /** "flat" also covers a change smaller than the metric's own noise floor. */
  direction: "softer" | "firmer" | "flat" | "descriptive" | "unavailable";
};

export type ComparisonBlock =
  | { kind: "blocked"; reason: string }
  | { kind: "ready"; changes: MetricChange[] };

/**
 * Rule §품질 게이팅 is all-or-nothing, and it applies to saved runs too: a
 * `poor` clip publishes no numbers, so it cannot be half of a comparison
 * either. Refusing here beats rendering a delta against a blank.
 */
export function compareSnapshots(
  before: SessionSnapshot,
  after: SessionSnapshot,
): ComparisonBlock {
  const poor = [before, after].filter((s) => s.quality === "poor");
  if (poor.length) {
    return {
      kind: "blocked",
      reason:
        poor.length === 2
          ? "두 세션 모두 촬영 품질이 부족해 수치를 비교하지 않습니다. 옆모습으로 다시 찍어 주세요."
          : `${poor[0].label}의 촬영 품질이 부족해 수치를 비교하지 않습니다. 옆모습으로 다시 찍어 주세요.`,
    };
  }

  const changes = COMPARABLE_METRICS.map<MetricChange>((metric) => {
    const a = before[metric.key];
    const b = after[metric.key];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return { metric, before: a, after: b, diff: Number.NaN, direction: "unavailable" };
    }
    const diff = b - a;
    let direction: MetricChange["direction"];
    if (Math.abs(diff) < metric.noise) direction = "flat";
    else if (metric.gentler === null) direction = "descriptive";
    else if (metric.gentler === "lower") direction = diff < 0 ? "softer" : "firmer";
    else direction = diff > 0 ? "softer" : "firmer";
    return { metric, before: a, after: b, diff, direction };
  });

  return { kind: "ready", changes };
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export const BUNDLE_KIND = "stride-lab-sessions";

export type SnapshotBundle = {
  kind: typeof BUNDLE_KIND;
  version: number;
  exportedAt: number;
  sessions: SessionSnapshot[];
};

export function toBundle(
  sessions: SessionSnapshot[],
  exportedAt: number,
): SnapshotBundle {
  return { kind: BUNDLE_KIND, version: SNAPSHOT_VERSION, exportedAt, sessions };
}

const NUMBER_FIELDS = [
  "savedAt",
  "durationS",
  "landingCount",
  "cadenceSpm",
  "meanDutyFactor",
  "meanContactMs",
  "meanFlightMs",
  "meanPeakGrfBw",
  "meanLoadingRateBwS",
  "meanKneeFlexContact",
  "meanScore",
  "asymmetryPct",
] as const;

function isSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (s.version !== SNAPSHOT_VERSION) return false;
  if (typeof s.id !== "string" || !s.id) return false;
  if (typeof s.label !== "string") return false;
  if (s.quality !== "good" && s.quality !== "fair" && s.quality !== "poor") return false;
  // NaN is expected (a gated field), so only the type is checked here.
  for (const key of NUMBER_FIELDS) {
    if (typeof s[key] !== "number") return false;
  }
  const p = s.strikePercents as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return false;
  for (const key of ["rearfoot", "midfoot", "forefoot"]) {
    if (typeof p[key] !== "number") return false;
  }
  return true;
}

/**
 * Parse a file someone hands back to the app. It is untrusted input from
 * outside the browser, so every field is checked rather than cast — a bad file
 * should say so, not surface as `NaN` halfway down a comparison.
 */
export function parseBundle(
  text: string,
): { ok: true; sessions: SessionSnapshot[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "JSON 파일이 아닙니다." };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "내용을 읽을 수 없는 파일입니다." };
  }
  const bundle = parsed as Record<string, unknown>;
  if (bundle.kind !== BUNDLE_KIND) {
    return { ok: false, reason: "이 앱에서 내보낸 파일이 아닙니다." };
  }
  if (bundle.version !== SNAPSHOT_VERSION) {
    return {
      ok: false,
      reason: `저장 형식이 다릅니다 (파일 v${String(bundle.version)}, 현재 v${SNAPSHOT_VERSION}).`,
    };
  }
  if (!Array.isArray(bundle.sessions)) {
    return { ok: false, reason: "세션 목록이 없습니다." };
  }
  const sessions = bundle.sessions.filter(isSnapshot);
  if (!sessions.length) {
    return { ok: false, reason: "가져올 수 있는 세션이 없습니다." };
  }
  return { ok: true, sessions };
}

/** One sentence over the whole comparison. Counts only the scored metrics. */
export function comparisonHeadline(changes: MetricChange[]): string {
  const softer = changes.filter((c) => c.direction === "softer").length;
  const firmer = changes.filter((c) => c.direction === "firmer").length;
  if (!softer && !firmer) {
    return "두 세션의 차이가 측정 해상도 안에 있습니다. 같은 조건에서 한 가지만 더 크게 바꿔 보세요.";
  }
  if (softer && !firmer) return "두 번째 세션이 전반적으로 더 부드럽게 받았습니다.";
  if (firmer && !softer) return "두 번째 세션이 전반적으로 더 단단하게 받았습니다.";
  return "항목마다 방향이 갈립니다. 한 번에 하나씩만 바꿔야 원인이 보입니다.";
}
