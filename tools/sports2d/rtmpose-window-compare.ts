/**
 * Does a browser-shaped RTMPose pass produce the same analysis as Sports2D?
 *
 * This is the question the stage 6 plan turns on. `rtmpose-window.py` ran the
 * pose model the way a browser would — MediaPipe's landmark extent as the box,
 * no detector — over a whole window. Here those keypoints go through the same
 * `halpe26ToPoseFrames` adapter the TRC import uses and the same
 * `analyzeLandings`, and the result is compared with the Sports2D run beside
 * it, which had the detector and its own person tracking.
 *
 * Pixels were already known to differ: MediaPipe's box sits about 121px lower
 * at the top, because its landmarks have no head point, and foot keypoints
 * move a median of 4.8px as a result. What matters is whether the stance
 * durations and the interval structure survive that, because those are what
 * the report is made of and what MediaPipe's own pose got wrong.
 *
 *     npx tsx tools/sports2d/rtmpose-window-compare.ts tools/sports2d/out/06
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeLandings,
  cadenceSpm,
  footStrikeLabel,
  groundContactIntervals,
  type AnalysisResult,
  type PoseFrame,
} from "../../src/lib/landing-analysis";
import { buildSessionSummary } from "../../src/lib/session-summary";
import { halpe26ToPoseFrames, type TrcTable } from "../../src/lib/sports2d";
import { median } from "../../src/lib/signal";
import { loadRun } from "./load";

type Window = {
  clip: string;
  rate: number;
  units: string;
  width: number;
  height: number;
  markers: string[];
  frames: Array<{ time: number; points: Array<{ x: number; y: number; z: number } | null> }>;
};

const show = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : " — ";

function describe(label: string, result: AnalysisResult, dt: number): void {
  const summary = buildSessionSummary(result);
  const intervals = groundContactIntervals(result.series, dt);
  const counts = (["left", "right"] as const).map(
    (side) => intervals.filter((interval) => interval.side === side).length,
  );
  const lengths = intervals.map((interval) => interval.end - interval.start);
  const strikes = result.landings
    .map((landing) => landing.footStrike)
    .filter((strike) => strike !== "unknown");
  const counted = new Map<string, number>();
  for (const strike of strikes) counted.set(strike, (counted.get(strike) ?? 0) + 1);
  const spread = [...counted.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([strike, n]) => `${footStrikeLabel[strike as keyof typeof footStrikeLabel]} ${n}`)
    .join(" · ");
  console.log(
    `${label}\n` +
      `   착지 ${result.landings.length} · 접지 ${show(summary.meanContactMs, 0)}ms` +
      ` · 힘 ${show(summary.meanPeakGrfBw)}BW · 케이던스 ${show(cadenceSpm(result.landings), 0)}spm\n` +
      `   구간 좌${counts[0]}/우${counts[1]} · 길이중앙 ${show(median(lengths), 3)}s` +
      ` · 품질 ${result.quality.level}\n` +
      `   주법 ${spread || "판정 없음"}`,
  );
}

const target = process.argv[2] ?? "tools/sports2d/out/06";
const run = loadRun(target);
const window = JSON.parse(
  readFileSync(join(target, "rtmpose-window.json"), "utf8"),
) as Window;

// The adapter reads a TRC table, so the window is presented as one. Same
// marker names, same units, same shape — nothing about it knows it did not
// come from a file.
const table: TrcTable = {
  rate: window.rate,
  units: window.units,
  markers: window.markers,
  frames: window.frames.map((frame) => ({ time: frame.time, points: frame.points })),
};
const browserShaped: PoseFrame[] = halpe26ToPoseFrames(table, {
  width: window.width,
  height: window.height,
  verticalAxis: "image-down",
});

const base = { statureM: 1.7, massKg: 70, width: window.width, height: window.height };
const frameStep = (frames: { t: number }[]) => {
  const steps = frames.slice(1).map((frame, i) => frame.t - frames[i].t).filter((d) => d > 0);
  return steps.length ? median(steps) : 1 / 30;
};

// Both passes are marked pre-filtered: these keypoints arrive as unsmoothed as
// the TRC's, so smoothing one and not the other would compare the smoothing.
const mine = analyzeLandings(browserShaped, { ...base, preFiltered: true });
const reference = analyzeLandings(run.frames, { ...base, preFiltered: true });
const dumpPath = join(target, "browser-frames.json");
const mediapipe = analyzeLandings(
  (JSON.parse(readFileSync(dumpPath, "utf8")) as { frames: PoseFrame[] }).frames,
  base,
);

console.log(`\n=== ${window.clip} ===`);
describe("Sports2D (검출기 박스 + 자체 추적)", reference, frameStep(reference.series));
describe("RTMPose (MediaPipe 박스, 검출기 없음)", mine, frameStep(mine.series));
describe("MediaPipe 자세 (지금의 앱)", mediapipe, frameStep(mediapipe.series));
