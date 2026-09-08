/**
 * Comparing two pose estimators over one clip.
 *
 * This is the measurement the project could not make. The browser reads a clip
 * with MediaPipe; Sports2D reads the same clip with RTMPose and writes a TRC;
 * both go through the same `analyzeLandings`. Whatever the two reports disagree
 * about therefore came from pose estimation and nothing else — same video, same
 * window, same analysis, one variable.
 *
 * What it cannot say is which one is right. Both are single-camera 2D
 * estimates, and Sports2D's own documentation asks for a view parallel to the
 * plane of motion and warns against trusting depth. A disagreement here means
 * at least one of them is wrong about that landing, and the arbiter is the
 * manual label set on 240 fps footage, not this table.
 *
 * The tolerances below are comparison tolerances, not judgements about a
 * runner, so they deliberately do not live in shared/thresholds.yaml. Nothing
 * here reaches a user; putting them in the threshold file would give them a
 * validation status they have not earned and imply the app judges someone by
 * them.
 */

import {
  cadenceSpm,
  footStrikeLabel,
  qualityLabel,
  type AnalysisResult,
  type FootStrike,
  type Landing,
} from "./landing-analysis";

export type PipelineKey = "browser" | "sports2d";

export type PipelinePass = {
  key: PipelineKey;
  /** What produced it, in the words the screen uses. */
  label: string;
  result: AnalysisResult;
  /** Frames the estimator returned a pose for, over frames it was given. */
  trackedFrames: number;
  totalFrames: number;
  /**
   * Which clip, how long the analysed stretch is, and on whose clock.
   *
   * All three, because a comparison is only a comparison when the two passes
   * read the same footage over the same stretch of time — and a table of
   * differences between mismatched inputs is indistinguishable from a table of
   * estimator error.
   *
   * `windowS` is the analysed span in analysis seconds, not video seconds, and
   * that distinction is the whole reason this field exists in this form. A
   * clip read as eight-times slow motion covers twelve seconds of video in a
   * second and a half of analysis: the source window matches, every landing
   * time does not, and the first version of this check waved it through.
   */
  clip: string;
  windowS: number;
  clockFactor: number;
};

/**
 * How far apart two contacts may be and still be the same footfall.
 *
 * At 30 fps a frame is 33 ms, and the two detectors can land on neighbouring
 * frames for the same touchdown. 80 ms allows about two frames of slack while
 * staying well under the shortest step interval a runner produces (a 250 spm
 * sprint steps every 240 ms), so a contact cannot be paired with its
 * neighbour.
 */
const PAIR_WINDOW_S = 0.08;

/** Row tolerances. Each is the smallest difference worth calling a difference. */
const TOLERANCE = {
  /** A cadence this close is the same cadence; the selftest holds ±3 spm too. */
  cadenceSpm: 3,
  /** Body weights. The report shows one decimal, so below this it cannot show. */
  peakGrfBw: 0.1,
  /** Seconds. One frame at 30 fps, since neither can resolve finer. */
  contactS: 0.034,
  /** Degrees. The strike boundary is ±8°, so this is a quarter of a category. */
  footAngleDeg: 3,
  /** Fraction of stature. One point of the percentage the report prints. */
  footAheadRatio: 0.01,
};

export type CompareRow = {
  label: string;
  /** Already formatted, because what to show is a property of the metric. */
  browser: string;
  sports2d: string;
  delta: string;
  /** Whether the two are close enough to be called the same measurement. */
  agree: boolean;
  /** Why a row could not be compared, when it could not. */
  note?: string;
};

export type PairedLanding = {
  browser: Landing;
  sports2d: Landing;
  /** Seconds between the two contacts. */
  apart: number;
  sameStrike: boolean;
  /**
   * Whether the two pipelines read this contact from the same foot signal.
   *
   * Compared on the channel, not on the published side. From a lateral view
   * neither pipeline claims a side any more, so comparing the published value
   * would find two `unknown`s equal and report that the two agree about the
   * foot — a row asserting agreement where neither has said anything. The
   * channel is what each one actually measured from, and whether those match
   * is the question this row exists to answer.
   */
  sameSide: boolean;
};

/**
 * Whether the two passes are even comparable.
 *
 * Decided here rather than by whatever draws the table. A comparison across
 * two different clips, or across different lengths of the same clip, produces
 * a table that looks exactly like estimator error, and a caller that forgot to
 * check would publish input differences as findings.
 */
export type Comparability = {
  sameClip: boolean;
  sameWindow: boolean;
  sameClock: boolean;
  ok: boolean;
  /** What is wrong, in the words the screen shows. */
  reasons: string[];
};

export type PipelineComparison = {
  rows: CompareRow[];
  paired: PairedLanding[];
  /** Contacts one pipeline found and the other did not. */
  browserOnly: Landing[];
  sports2dOnly: Landing[];
  comparable: Comparability;
  /** Rows outside tolerance, excluding the ones that are not comparisons. */
  disagreements: number;
};

/**
 * How much the two analysed windows may differ.
 *
 * A tenth of a second: the browser samples a duration it read from the video
 * container, Sports2D counts frames it wrote, and the two will not agree to
 * the millisecond about the same twelve seconds.
 */
const WINDOW_SLACK_S = 0.1;

function comparability(a: PipelinePass, b: PipelinePass): Comparability {
  const sameClip = a.clip === b.clip;
  const sameWindow =
    Number.isFinite(a.windowS) &&
    Number.isFinite(b.windowS) &&
    Math.abs(a.windowS - b.windowS) <= WINDOW_SLACK_S;
  // Capture rate is a separate question from window length, and it has to be
  // asked separately: a pass read as slow motion can cover the same seconds of
  // footage on a clock eight times slower, which makes every landing time,
  // every contact and every force incomparable while both windows agree.
  const sameClock = a.clockFactor === b.clockFactor;

  const reasons: string[] = [];
  if (!sameClip) reasons.push(`클립이 다릅니다 — ${a.clip} · ${b.clip}`);
  if (!sameWindow) {
    reasons.push(
      `분석 구간 길이가 다릅니다 — ${a.windowS.toFixed(1)}초 · ${b.windowS.toFixed(1)}초`,
    );
  }
  if (!sameClock) {
    reasons.push(
      `촬영 배속 설정이 다릅니다 — ${a.clockFactor}배 · ${b.clockFactor}배. ` +
        "실시간 영상이면 러너 세팅에서 1배로 두고 다시 분석하세요.",
    );
  }
  return {
    sameClip,
    sameWindow,
    sameClock,
    ok: sameClip && sameWindow && sameClock,
    reasons,
  };
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;

const finite = (values: number[]) => values.filter((value) => Number.isFinite(value));

/**
 * Pair contacts by time, nearest first.
 *
 * Nearest-first rather than in order: if one pipeline misses a footfall,
 * walking both lists together would pair everything after it with the wrong
 * partner and report a disagreement at every remaining landing. Sorting the
 * candidate pairs by how far apart they are and taking each landing once
 * leaves the missed footfall as the only unpaired one.
 */
export function pairLandings(
  browser: Landing[],
  sports2d: Landing[],
  windowS: number = PAIR_WINDOW_S,
): { paired: PairedLanding[]; browserOnly: Landing[]; sports2dOnly: Landing[] } {
  const candidates: Array<{ a: number; b: number; apart: number }> = [];
  browser.forEach((left, a) => {
    sports2d.forEach((right, b) => {
      const apart = Math.abs(left.tContact - right.tContact);
      if (apart <= windowS) candidates.push({ a, b, apart });
    });
  });
  candidates.sort((x, y) => x.apart - y.apart);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const paired: PairedLanding[] = [];
  for (const { a, b, apart } of candidates) {
    if (usedA.has(a) || usedB.has(b)) continue;
    usedA.add(a);
    usedB.add(b);
    paired.push({
      browser: browser[a],
      sports2d: sports2d[b],
      apart,
      sameStrike: browser[a].footStrike === sports2d[b].footStrike,
      sameSide: browser[a].footChannel === sports2d[b].footChannel,
    });
  }
  paired.sort((x, y) => x.browser.tContact - y.browser.tContact);

  return {
    paired,
    browserOnly: browser.filter((_, a) => !usedA.has(a)),
    sports2dOnly: sports2d.filter((_, b) => !usedB.has(b)),
  };
}

/**
 * How many of each strike a pass reported.
 *
 * Every member of the union gets a slot, `unknown` included: a pipeline that
 * cannot tell would otherwise have its uncertain landings vanish from a table
 * whose job is to show where the two disagree.
 */
export function strikeCounts(landings: Landing[]): Record<FootStrike, number> {
  const counts = Object.fromEntries(
    (Object.keys(footStrikeLabel) as FootStrike[]).map((strike) => [strike, 0]),
  ) as Record<FootStrike, number>;
  for (const landing of landings) counts[landing.footStrike] += 1;
  return counts;
}

const strikeSummary = (landings: Landing[]): string => {
  const counts = strikeCounts(landings);
  const parts = (Object.keys(footStrikeLabel) as FootStrike[])
    .filter((strike) => counts[strike] > 0)
    .map((strike) => `${footStrikeLabel[strike]} ${counts[strike]}`);
  return parts.length ? parts.join(" · ") : "없음";
};

/** A number pair as a row, formatted once and compared against one tolerance. */
function numberRow(
  label: string,
  a: number,
  b: number,
  tolerance: number,
  format: (value: number) => string,
  formatDelta: (value: number) => string = format,
): CompareRow {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return {
      label,
      browser: Number.isFinite(a) ? format(a) : "측정 불가",
      sports2d: Number.isFinite(b) ? format(b) : "측정 불가",
      delta: "—",
      agree: false,
      note: "한쪽이 측정하지 못해 비교할 수 없습니다",
    };
  }
  const difference = b - a;
  return {
    label,
    browser: format(a),
    sports2d: format(b),
    delta: `${difference > 0 ? "+" : difference < 0 ? "−" : ""}${formatDelta(Math.abs(difference))}`,
    agree: Math.abs(difference) <= tolerance,
  };
}

export function comparePipelines(
  browser: PipelinePass,
  sports2d: PipelinePass,
): PipelineComparison {
  const a = browser.result.landings;
  const b = sports2d.result.landings;
  const { paired, browserOnly, sports2dOnly } = pairLandings(a, b);

  const contactSeconds = (landings: Landing[]) =>
    mean(finite(landings.map((landing) => landing.contactMs))) / 1000;

  const rows: CompareRow[] = [
    {
      // First, because it decides how to read everything under it. Several of
      // these measures are withheld rather than wrong when the gate refuses a
      // clip, and a column of "측정 불가" means something entirely different
      // depending on which of those happened.
      label: "측정 품질",
      browser: qualityLabel[browser.result.quality.level],
      sports2d: qualityLabel[sports2d.result.quality.level],
      delta:
        browser.result.quality.level === sports2d.result.quality.level
          ? "같음"
          : "다름",
      agree: browser.result.quality.level === sports2d.result.quality.level,
      // Each reason is attributed. Merged into one list they read as if they
      // applied to both passes, which is the opposite of what a row comparing
      // the two is for — and here it matters, because only one of the passes
      // was refused.
      note:
        [
          ...browser.result.quality.reasons.map(
            (reason) => `${browser.label}: ${reason}`,
          ),
          ...sports2d.result.quality.reasons.map(
            (reason) => `${sports2d.label}: ${reason}`,
          ),
        ].join(" · ") || undefined,
    },
    {
      label: "추적된 프레임",
      browser: `${browser.trackedFrames}/${browser.totalFrames}`,
      sports2d: `${sports2d.trackedFrames}/${sports2d.totalFrames}`,
      delta: "—",
      agree: true,
      note: "표본 크기라 값 비교가 아닙니다",
    },
    {
      label: "착지 수",
      browser: `${a.length}회`,
      sports2d: `${b.length}회`,
      delta: `${b.length - a.length > 0 ? "+" : ""}${b.length - a.length}회`,
      agree: a.length === b.length,
    },
    {
      label: "짝지어진 착지",
      browser: `${paired.length}쌍`,
      sports2d: `${paired.length}쌍`,
      delta: `한쪽만 ${browserOnly.length + sports2dOnly.length}회`,
      agree: browserOnly.length === 0 && sports2dOnly.length === 0,
      note: `접촉 시각이 ${Math.round(PAIR_WINDOW_S * 1000)}ms 안이면 같은 착지로 봅니다`,
    },
    {
      label: "주법 일치",
      browser: strikeSummary(a),
      sports2d: strikeSummary(b),
      delta: paired.length
        ? `짝 중 ${paired.filter((pair) => pair.sameStrike).length}/${paired.length}`
        : "—",
      agree: paired.length > 0 && paired.every((pair) => pair.sameStrike),
    },
    {
      label: "좌우 일치",
      browser: "—",
      sports2d: "—",
      delta: paired.length
        ? `짝 중 ${paired.filter((pair) => pair.sameSide).length}/${paired.length}`
        : "—",
      agree: paired.length > 0 && paired.every((pair) => pair.sameSide),
      note: "각 파이프라인이 각도를 읽은 발 신호가 같은지 봅니다. 다르면 한쪽이 반대 발을 본 것입니다",
    },
    numberRow(
      "케이던스",
      cadenceSpm(a),
      cadenceSpm(b),
      TOLERANCE.cadenceSpm,
      (value) => `${Math.round(value)} spm`,
    ),
    numberRow(
      "평균 발 각도",
      mean(finite(a.map((landing) => landing.footStrikeAngleDeg))),
      mean(finite(b.map((landing) => landing.footStrikeAngleDeg))),
      TOLERANCE.footAngleDeg,
      (value) => `${value.toFixed(1)}°`,
    ),
    numberRow(
      "평균 최대 반력",
      mean(finite(a.map((landing) => landing.peakGrfBw))),
      mean(finite(b.map((landing) => landing.peakGrfBw))),
      TOLERANCE.peakGrfBw,
      (value) => `${value.toFixed(2)} BW`,
    ),
    numberRow(
      "평균 접지 시간",
      contactSeconds(a),
      contactSeconds(b),
      TOLERANCE.contactS,
      (value) => `${value.toFixed(3)}s`,
    ),
    numberRow(
      "평균 몸 앞 착지",
      mean(finite(a.map((landing) => landing.footAheadRatio))),
      mean(finite(b.map((landing) => landing.footAheadRatio))),
      TOLERANCE.footAheadRatio,
      (value) => `신장의 ${(value * 100).toFixed(1)}%`,
      (value) => `${(value * 100).toFixed(1)}%p`,
    ),
  ];

  return {
    rows,
    paired,
    browserOnly,
    sports2dOnly,
    comparable: comparability(browser, sports2d),
    disagreements: rows.filter((row) => !row.agree && !row.note).length,
  };
}
