/**
 * Why the two pipelines disagree about how long a foot was on the ground.
 *
 * On one clip the browser read stance as 0.170 s where Sports2D read 0.313 s,
 * and because the force estimate comes from duty factor, halving the stance
 * inflated the force with it: 2.87 BW against 1.86. Both pipelines run the
 * same `footIntervals`, so the difference is in what they feed it — the foot's
 * height over time — and this puts the two signals side by side.
 *
 *     npx tsx tools/sports2d/foot-signal.ts tools/sports2d/out/06
 *
 * Needs browser-frames.json from dump-browser.py beside the Sports2D output.
 *
 * The two measures that matter are the ones `footIntervals` reads. Its band is
 * a fraction of the foot's vertical excursion, so a shallow signal makes a
 * narrow band; and it requires consecutive frames inside that band, so
 * frame-to-frame noise breaks a stance into pieces the growth step cannot
 * rejoin. Reporting both says which of the two is at work.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LM } from "../../src/lib/pose";
import {
  analyzeLandings,
  groundContactIntervals,
  type PoseFrame,
} from "../../src/lib/landing-analysis";
// The real helpers, not copies of them. A diagnostic that reimplements the
// thing it is diagnosing measures the reimplementation: the first version of
// this took the ground line as one percentile over the whole clip, where the
// analysis tracks it in a window of about a second and a half, and so it
// reported splits the analysis would not have made.
import { median, movingAverage, percentile, rollingPercentile } from "../../src/lib/signal";
import { loadRun } from "./load";

type Side = "left" | "right";

/**
 * The foot's height in the frame, as a fraction of frame height, with down
 * positive so the numbers read like the image.
 *
 * The heel where it is visible, the ankle otherwise, which is what the
 * analysis itself does — it is the same quantity, and the point here is to
 * compare inputs rather than to invent a new measure.
 */
function footHeights(frames: PoseFrame[], side: Side): Array<number | null> {
  const heel = side === "left" ? LM.leftHeel : LM.rightHeel;
  const ankle = side === "left" ? LM.leftAnkle : LM.rightAnkle;
  return frames.map((frame) => {
    if (!frame.landmarks) return null;
    for (const index of [heel, ankle]) {
      const point = frame.landmarks[index];
      if (point && (point.visibility ?? 1) >= 0.25) return point.y;
    }
    return null;
  });
}

/** One landmark's height, with no fallback, to see what each contributes. */
function oneLandmark(frames: PoseFrame[], index: number): Array<number | null> {
  return frames.map((frame) => {
    const point = frame.landmarks?.[index];
    return point && (point.visibility ?? 1) >= 0.25 ? point.y : null;
  });
}

/**
 * Frame-to-frame change, as a share of the excursion.
 *
 * Absolute noise means nothing on its own: a signal that swings twice as far
 * tolerates twice the jitter. What breaks a stance is jitter relative to the
 * band, and the band is a fraction of the swing.
 */
function jitterShare(values: Array<number | null>, swing: number): number {
  const steps: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (a === null || b === null) continue;
    steps.push(Math.abs(b - a));
  }
  return swing > 0 ? percentile(steps, 0.5) / swing : Number.NaN;
}

const asNumbers = (values: Array<number | null>) =>
  values.filter((v): v is number => v !== null);

/** Runs of consecutive true values, keeping only those of two or more. */
function runsOf(mask: boolean[]): { longest: number; runs: number[] } {
  const runs: number[] = [];
  let run = 0;
  for (const on of mask) {
    if (on) run += 1;
    else if (run) {
      runs.push(run);
      run = 0;
    }
  }
  if (run) runs.push(run);
  return { longest: runs.length ? Math.max(...runs) : 0, runs: runs.filter((r) => r >= 2) };
}

/**
 * Speed between frames, in signal units per second.
 *
 * `footIntervals` compares the foot's vertical speed against a threshold that
 * is mostly the 80th percentile of its own speed, so the comparison is
 * scale-free and can be reproduced here without converting to metres. What
 * cannot be reproduced is the absolute floor of 0.24 m/s the real threshold
 * takes a maximum with, which only ever makes it more permissive — so the
 * speed test below is at worst slightly stricter than the one being diagnosed.
 */
function speeds(values: number[], rate: number): number[] {
  return values.map((value, i) => {
    const previous = i > 0 ? values[i - 1] : value;
    const next = i + 1 < values.length ? values[i + 1] : value;
    return (Math.abs(next - previous) / 2) * rate;
  });
}

/**
 * Bridge single-frame dropouts, then smooth — the treatment the per-foot
 * signals get before anything reads them.
 *
 * Measuring the raw landmark overstates the noise the interval finder sees,
 * and the smoothing is part of the pipeline: a comparison that skips it
 * compares something neither pipeline uses.
 */
function prepared(values: Array<number | null>, maxGap: number): number[] {
  const filled = [...values];
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] !== null) continue;
    let end = i;
    while (end < filled.length && filled[end] === null) end += 1;
    const before = i > 0 ? filled[i - 1] : null;
    const after = end < filled.length ? filled[end] : null;
    if (end - i <= maxGap && before !== null && after !== null) {
      for (let k = i; k < end; k++) {
        filled[k] = before + ((after - before) * (k - i + 1)) / (end - i + 1);
      }
    }
    i = end - 1;
  }
  // A gap too long to bridge keeps the last value it had, which is what the
  // analysis's own gap filling settles on; the mask below then judges it on
  // height like any other frame.
  let last = filled.find((value) => value !== null) ?? 0;
  const dense = filled.map((value) => {
    if (value !== null) last = value;
    return last;
  });
  return dense;
}

/** Window-3 mean, which is what the analysis applies today. */
const meanFiltered = (values: number[]) => movingAverage(values, 3);

/**
 * Window-3 median.
 *
 * A mean flattens whatever peak it spans, and the foot's highest point in
 * swing is one or two frames wide, so averaging shaves the excursion the
 * interval finder measures its band against. A median drops a single-frame
 * spike and leaves a genuine peak where it is, which is the difference that
 * matters for a threshold on amplitude.
 */
const medianFiltered = (values: number[]) =>
  values.map((_, i) =>
    median(values.slice(Math.max(0, i - 1), Math.min(values.length, i + 2))),
  );

/**
 * Correlation between the two feet's heights, at no lag.
 *
 * Running is anti-phase: one foot is down while the other is up, so this
 * should be strongly negative. A value near zero or positive means the two
 * signals are rising and falling together, which a pair of legs does not do —
 * it means the estimator is not telling them apart. On a treadmill the feet
 * pass close to each other twice a stride, which is where that happens.
 *
 * This decides what kind of problem a short stance is. A signal that dips
 * twice a stride because both feet are being blended cannot be repaired by
 * filtering it; the honest response is to notice and refuse.
 */
function footCorrelation(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 8) return Number.NaN;
  const meanOf = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const a = left.slice(0, n);
  const b = right.slice(0, n);
  const ma = meanOf(a);
  const mb = meanOf(b);
  let top = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    top += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return sa > 0 && sb > 0 ? top / Math.sqrt(sa * sb) : Number.NaN;
}

/** Gaps between the starts of consecutive planted runs, in seconds. */
function runSpacing(mask: boolean[], rate: number): number[] {
  const starts: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && !mask[i - 1]) starts.push(i);
  }
  return starts.slice(1).map((start, i) => (start - starts[i]) / rate);
}

/**
 * The stances the analysis actually works from, and the stance it publishes.
 *
 * The rows above describe the signal. This one describes the outcome, by
 * calling the same interval finder the analysis calls and reading the contact
 * time off the landings it produced. Without it the tool can only show that
 * one signal is noisier than another, which does not say whether the noise
 * survived the hysteresis and the merging into the number a user sees.
 */
function outcome(label: string, frames: PoseFrame[], preFiltered: boolean): void {
  const result = analyzeLandings(frames, {
    statureM: 1.7,
    massKg: 70,
    width: 720,
    height: 1280,
    preFiltered,
  });
  const times = result.series.map((point) => point.t);
  const steps = times.slice(1).map((t, i) => t - times[i]).filter((d) => d > 0);
  const dt = steps.length ? median(steps) : 1 / 30;
  const intervals = groundContactIntervals(result.series, dt);
  console.log(`  ${label} 실제 접지 구간`);
  for (const side of ["left", "right"] as const) {
    const mine = intervals.filter((interval) => interval.side === side);
    const lengths = mine.map((interval) => interval.end - interval.start);
    const starts = mine.map((interval) => interval.start);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    // The gap from one interval's end to the next one's start. If a stance is
    // being split, these fall into two groups — the short gaps inside a
    // shattered stance and the long ones between real stances — and a repair
    // is only safe if the two groups do not overlap.
    const holes = mine
      .slice(1)
      .map((interval, i) => interval.start - mine[i].end)
      .filter((hole) => hole >= 0)
      .sort((a, b) => a - b);
    console.log(
      `    ${side.padEnd(5)} 구간 ${String(mine.length).padStart(2)}개` +
        ` · 길이 중앙 ${lengths.length ? median(lengths).toFixed(3) : "—"}s` +
        ` · 시작 간격 중앙 ${gaps.length ? median(gaps).toFixed(3) : "—"}s`,
    );
    if (holes.length) {
      const show = holes.map((hole) => hole.toFixed(2)).join(" ");
      console.log(`          구간 사이 빈틈: ${show}`);
    }
  }
  const published = result.landings
    .map((landing) => landing.contactMs)
    .filter(Number.isFinite);
  console.log(
    `    발표된 접지 중앙 ${published.length ? median(published).toFixed(0) : "—"}ms` +
      ` · 착지 ${result.landings.length}개`,
  );
}

function describe(label: string, frames: PoseFrame[], rate: number): void {
  console.log(`\n${label} · ${frames.length}프레임 · ${rate} fps`);
  // The two feet against each other, before looking at either alone.
  {
    const left = prepared(footHeights(frames, "left"), 2);
    const right = prepared(footHeights(frames, "right"), 2);
    const correlation = footCorrelation(left, right);
    console.log(
      `  좌우 상관 ${correlation.toFixed(2)}` +
        (correlation < -0.3
          ? " (역위상 — 두 발을 구분함)"
          : correlation > 0.3
            ? " (같이 오르내림 — 두 발을 섞고 있음)"
            : " (뚜렷하지 않음)"),
    );
  }

  for (const side of ["left", "right"] as Side[]) {
    const rawHeights = footHeights(frames, side);
    const tracked = rawHeights.filter((v) => v !== null).length;
    if (tracked < frames.length * 0.3) {
      console.log(`  ${side.padEnd(5)} 추적 ${tracked}/${frames.length} — 너무 적어 생략`);
      continue;
    }
    const dense = prepared(rawHeights, 2);
    console.log(`  ${side.padEnd(5)} 추적 ${String(tracked).padStart(3)}/${frames.length}`);

    // Three treatments of the same signal, because the treatment turned out to
    // be the variable. The analysis applies the mean to a browser pass and
    // nothing at all to a Sports2D one, which already arrived filtered.
    for (const [name, filtered] of [
      ["평활 없음", dense],
      ["평균 3", meanFiltered(dense)],
      ["중간값 3", medianFiltered(dense)],
    ] as const) {
      const swing = percentile(filtered, 0.9) - percentile(filtered, 0.1);
      const ground = rollingPercentile(filtered, Math.max(4, Math.round(0.7 * rate)), 0.92);
      const tolerance = Math.max(0.02, swing * 0.22);
      const lowMask = filtered.map((value, i) => value >= ground[i] - tolerance);
      const speed = speeds(filtered, rate);
      const stillSpeed = percentile(speed, 0.8) * 0.9;
      const bothMask = lowMask.map((low, i) => low && speed[i] <= stillSpeed);
      const { longest, runs } = runsOf(bothMask);
      const mean = runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0;
      const spacing = runSpacing(bothMask, rate);
      // Labelled as the core, because that is what it is. These runs are the
      // planted-frame test alone, without the hysteresis growth, the gap
      // merging or the length filter that `groundContactIntervals` applies
      // after it — so they are not the stances the analysis works from, and
      // reading them as though they were points at fragmentation the app may
      // not have. The real intervals are printed below.
      console.log(
        `        ${name.padEnd(9)} 상하폭 ${swing.toFixed(4)}` +
          ` · 밴드 ${tolerance.toFixed(4)}` +
          ` · 흔들림 ${(jitterShare(filtered, swing) * 100).toFixed(1)}%` +
          ` · 코어런 ${String(runs.length).padStart(2)}개 평균 ${mean.toFixed(1)}f` +
          ` (최장 ${String(longest).padStart(2)}) = ${(mean / rate).toFixed(3)}s` +
          ` · 코어런 간격 중앙 ${median(spacing).toFixed(3)}s`,
      );
    }

    // Which landmark the signal is actually made of, and how far each one
    // travels. The analysis prefers the heel and falls back to the ankle, and
    // those are not interchangeable: if one pipeline's heel is rarely trusted,
    // its signal is a different measurement wearing the same name.
    for (const [name, index] of [
      ["발꿈치", side === "left" ? LM.leftHeel : LM.rightHeel],
      ["발목", side === "left" ? LM.leftAnkle : LM.rightAnkle],
      ["발끝", side === "left" ? LM.leftFootIndex : LM.rightFootIndex],
    ] as const) {
      const own = oneLandmark(frames, index);
      const seenOwn = asNumbers(own);
      if (seenOwn.length < 2) {
        console.log(`        ${name.padEnd(4)} 보이는 프레임 ${seenOwn.length}`);
        continue;
      }
      const ownSwing = percentile(seenOwn, 0.9) - percentile(seenOwn, 0.1);
      console.log(
        `        ${name.padEnd(4)} 보임 ${String(seenOwn.length).padStart(3)}/${frames.length}` +
          ` · 상하폭 ${ownSwing.toFixed(4)}`,
      );
    }
  }
}

function main(argv: string[]): number {
  const target = argv[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/foot-signal.ts <out/<id>>");
    return 2;
  }

  const run = loadRun(target);
  describe("Sports2D", run.frames, run.table.rate);
  outcome("Sports2D", run.frames, true);

  const dumpPath = join(target, "browser-frames.json");
  let dump: { clip: string; frames: PoseFrame[] };
  try {
    dump = JSON.parse(readFileSync(dumpPath, "utf8"));
  } catch {
    console.error(
      `\nbrowser-frames.json 이 없습니다 (${dumpPath})` +
        "\npython tools/sports2d/dump-browser.py <id> 를 먼저 돌리세요",
    );
    return 1;
  }
  // The browser samples the clip at its own rate rather than the file's.
  const span = dump.frames.at(-1)?.t ?? 0;
  const browserRate = span > 0 ? (dump.frames.length - 1) / span : run.table.rate;
  describe("브라우저 (MediaPipe)", dump.frames, browserRate);
  outcome("브라우저", dump.frames, false);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
