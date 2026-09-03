/**
 * How much of the foot-strike verdict is decided by the frame grid.
 *
 * The question this answers: 30 fps is the condition the product has to work
 * in, so is 30 fps good enough, and how would we know without footage shot
 * faster?
 *
 * The trick is to measure the slope instead of the value. Nothing here can
 * produce frames that were never recorded, but it can throw frames away:
 * running the same clip at 30, 15 and 10 fps shows how fast the verdict moves
 * as the grid coarsens. A verdict that barely changes from 30 to 15 is not
 * being decided by the grid, and 30 fps is fine. A verdict that falls apart by
 * 15 is on a cliff, and 30 fps is only accidentally on the right side of it.
 *
 * This is not a substitute for ground truth. It bounds where the problem is,
 * which is what you need before deciding whether to fix the method or go and
 * find better footage.
 *
 *     npx tsx tools/sports2d/framerate.ts tools/sports2d/out/06
 *     npx tsx tools/sports2d/framerate.ts tools/sports2d/out   # every run
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeLandings,
  cadenceSpm,
  footStrikeLabel,
  type Landing,
  type PoseFrame,
} from "../../src/lib/landing-analysis";
import { pairLandings } from "../../src/lib/pipeline-compare";
import { find, loadRun } from "./load";

/**
 * Keep every nth frame.
 *
 * Timestamps are kept as they were rather than renumbered, because the
 * analysis reads dt from the times themselves — renumbering would change the
 * clip's speed instead of its sampling.
 */
const decimate = (frames: PoseFrame[], keepEvery: number): PoseFrame[] =>
  frames.filter((_, index) => index % keepEvery === 0);

const mean = (values: number[]) => {
  const good = values.filter((value) => Number.isFinite(value));
  return good.length ? good.reduce((sum, value) => sum + value, 0) / good.length : Number.NaN;
};

const strikeMix = (landings: Landing[]) => {
  const counts = new Map<string, number>();
  for (const landing of landings) {
    counts.set(landing.footStrike, (counts.get(landing.footStrike) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([strike, n]) => `${footStrikeLabel[strike as keyof typeof footStrikeLabel] ?? strike} ${n}`)
    .join(" · ");
};

const show = (value: number, digits: number, unit: string) =>
  Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "없음";

function report(target: string): void {
  const run = loadRun(target);
  const options = {
    statureM: 1.7,
    massKg: 70,
    width: run.width,
    height: run.height,
    // Sports2D already filtered; smoothing again would widen the window and
    // confound the thing being measured.
    preFiltered: true,
  };

  const baseRate = run.table.rate;
  const steps = [1, 2, 3];
  const passes = steps.map((keepEvery) => {
    const frames = decimate(run.frames, keepEvery);
    return {
      rate: baseRate / keepEvery,
      frames: frames.length,
      result: analyzeLandings(frames, options),
    };
  });

  // The same clip with the angle read differently. Both at full rate: this asks
  // whether the sampling window is costing us anything, which is a separate
  // question from what the grid costs.
  const alternatives = (["before", "before-wide", "peak"] as const).map((sampling) => ({
    sampling,
    result: analyzeLandings(run.frames, { ...options, strikeAngleSampling: sampling }),
  }));

  console.log(`\n=== ${target} ===`);
  console.log(`원본 ${baseRate} fps · ${run.frames.length}프레임 · ${run.width}x${run.height}`);
  for (const pass of passes) {
    const landings = pass.result.landings;
    console.log(
      `  ${pass.rate.toFixed(0).padStart(2)} fps  ${String(pass.frames).padStart(3)}프레임  ` +
        `착지 ${String(landings.length).padStart(2)}  ` +
        `케이던스 ${show(cadenceSpm(landings), 0, " spm").padStart(8)}  ` +
        `평균각 ${show(mean(landings.map((l) => l.footStrikeAngleDeg)), 1, "°").padStart(7)}  ` +
        `품질 ${pass.result.quality.level.padEnd(4)}  ${strikeMix(landings)}`,
    );
  }

  // Reading the angle before contact rather than around it. A frame after
  // touchdown has already lost part of the rotation it is meant to measure, so
  // if that is costing us the verdict this is where it shows.
  for (const { sampling, result } of alternatives) {
    const base = passes[0].result.landings;
    const { paired } = pairLandings(base, result.landings);
    const flipped = paired.filter((pair) => !pair.sameStrike);
    const shift = mean(
      paired.map(
        (pair) => pair.sports2d.footStrikeAngleDeg - pair.browser.footStrikeAngleDeg,
      ),
    );
    console.log(
      `  각도 표본 around → ${sampling}: 짝 ${paired.length}쌍 · 주법 바뀜 ${flipped.length} · ` +
        `각도 평균 변화 ${show(shift, 1, "°")} · ${strikeMix(result.landings)}`,
    );
    for (const pair of flipped.slice(0, 4)) {
      console.log(
        `      ${pair.browser.tContact.toFixed(2)}s  ` +
          `${footStrikeLabel[pair.browser.footStrike]} ${show(pair.browser.footStrikeAngleDeg, 1, "°")}` +
          ` → ${footStrikeLabel[pair.sports2d.footStrike]} ${show(pair.sports2d.footStrikeAngleDeg, 1, "°")}`,
      );
    }
  }

  // What actually matters: of the landings both rates found, how many changed
  // their verdict. A count of landings is a weaker signal — a coarser grid can
  // miss a footfall entirely, which is a different failure from misjudging one.
  const base = passes[0].result.landings;
  for (const pass of passes.slice(1)) {
    const { paired, browserOnly, sports2dOnly } = pairLandings(base, pass.result.landings);
    const flipped = paired.filter((pair) => !pair.sameStrike);
    const angleShift = mean(
      paired.map((pair) =>
        Math.abs(pair.sports2d.footStrikeAngleDeg - pair.browser.footStrikeAngleDeg),
      ),
    );
    console.log(
      `  30 → ${pass.rate.toFixed(0)} fps: 짝 ${paired.length}쌍 · ` +
        `주법 바뀜 ${flipped.length} · 각도 평균 이동 ${show(angleShift, 1, "°")} · ` +
        `놓친 착지 ${sports2dOnly.length ? `+${sports2dOnly.length}` : browserOnly.length}`,
    );
    for (const pair of flipped.slice(0, 4)) {
      const from = footStrikeLabel[pair.browser.footStrike];
      const to = footStrikeLabel[pair.sports2d.footStrike];
      console.log(
        `      ${pair.browser.tContact.toFixed(2)}s  ${from} ${show(pair.browser.footStrikeAngleDeg, 1, "°")}` +
          ` → ${to} ${show(pair.sports2d.footStrikeAngleDeg, 1, "°")}`,
      );
    }
  }
}

const hasTrc = (root: string) =>
  Boolean(find(root, (name) => name.endsWith(".trc") && name.includes("_px_")));

function main(argv: string[]): number {
  const target = argv[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/framerate.ts <out/<id> 또는 out>");
    return 2;
  }

  // One run, or a directory of them. Decided by whether a pixel TRC exists
  // anywhere underneath: `out/06` holds one nested a level down, `out` holds
  // several. Naming conventions would have been the wrong test — Sports2D names
  // its output folder after the clip.
  const isRun = statSync(target).isFile() || hasTrc(target);
  const targets = isRun
    ? [target]
    : readdirSync(target)
        .map((entry) => join(target, entry))
        .filter((path) => statSync(path).isDirectory() && hasTrc(path));
  if (!targets.length) {
    console.error(`처리된 실행이 없습니다: ${target} (run.py 를 먼저 돌리세요)`);
    return 1;
  }

  let failures = 0;
  for (const one of targets) {
    try {
      report(one);
    } catch (error) {
      console.error(`${one}: ${error instanceof Error ? error.message : error}`);
      failures += 1;
    }
  }
  return failures && failures === targets.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
