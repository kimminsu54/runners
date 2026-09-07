/**
 * Was the six-keypoint foot worth it?
 *
 * HALPE_26 gives a heel and both toes per side where MediaPipe gives one point
 * at the end of the foot, and those six keypoints were the reason for adopting
 * a reference pipeline at all. The claim was that a line from the heel to the
 * midpoint of the two toes does not swing with toe-out, where a line to the big
 * toe alone does: a foot angled away from the camera puts its big toe nearer
 * than its small toe, and the near point sits lower in the image.
 *
 * This measures what that changes. One variable — the axis — with the sampling
 * window, the smoothing and the clip held fixed.
 *
 *     npx tsx tools/sports2d/foot-axis.ts tools/sports2d/out/06
 *     npx tsx tools/sports2d/foot-axis.ts tools/sports2d/out
 *
 * Sports2D only. MediaPipe has no small toe, so there is nothing to compare on
 * the browser side; that asymmetry is the point of the exercise rather than a
 * gap in it.
 */

import {
  analyzeLandings,
  footStrikeLabel,
  type FootAxis,
  type Landing,
} from "../../src/lib/landing-analysis";
import { LM } from "../../src/lib/pose";
import { median, percentile } from "../../src/lib/signal";
import { pairLandings } from "../../src/lib/pipeline-compare";
import { loadRun, runsUnder } from "./load";

const AXES: FootAxis[] = ["big-toe", "long-axis"];

const mean = (values: number[]) => {
  const good = values.filter((value) => Number.isFinite(value));
  return good.length ? good.reduce((a, b) => a + b, 0) / good.length : Number.NaN;
};

const mix = (landings: Landing[]) => {
  const counts = new Map<string, number>();
  for (const landing of landings) {
    counts.set(landing.footStrike, (counts.get(landing.footStrike) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([strike, n]) => `${footStrikeLabel[strike as keyof typeof footStrikeLabel]} ${n}`)
    .join(" · ");
};

const show = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)}°` : "없음");

/**
 * How far the two toes are apart across the image, as a share of foot length.
 *
 * This is the condition the long axis was supposed to help with. A foot square
 * to the camera hides one toe behind the other, so their horizontal separation
 * is small; a foot turned toward or away from the camera spreads them. If the
 * axis matters for the reason claimed, the two definitions should disagree most
 * where this is largest — and if they disagree the same amount regardless, the
 * difference is not about toe-out.
 *
 * Divided by the heel-to-toe span so it is a shape and not a size, which
 * matters because the runner's distance from the camera changes through a clip.
 */
function toeSpread(run: ReturnType<typeof loadRun>, t: number, side: "left" | "right") {
  let at = 0;
  for (let i = 1; i < run.frames.length; i++) {
    if (Math.abs(run.frames[i].t - t) < Math.abs(run.frames[at].t - t)) at = i;
  }
  const frame = run.frames[at];
  const lm = frame.landmarks;
  if (!lm) return Number.NaN;
  const heel = lm[side === "left" ? LM.leftHeel : LM.rightHeel];
  const bigToe = lm[side === "left" ? LM.leftFootIndex : LM.rightFootIndex];
  const smallToe =
    side === "left" ? frame.footExtras?.leftSmallToe : frame.footExtras?.rightSmallToe;
  if (!heel || !bigToe || !smallToe) return Number.NaN;
  const footLength = Math.hypot(bigToe.x - heel.x, bigToe.y - heel.y);
  if (!(footLength > 0)) return Number.NaN;
  return Math.abs(bigToe.x - smallToe.x) / footLength;
}

/** Pearson correlation, or NaN when either side has no spread of its own. */
function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 6) return Number.NaN;
  const meanOf = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
  const ma = meanOf(a.slice(0, n));
  const mb = meanOf(b.slice(0, n));
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

function report(target: string): void {
  const run = loadRun(target);
  const withToes = run.frames.filter(
    (frame) => frame.footExtras?.leftSmallToe || frame.footExtras?.rightSmallToe,
  ).length;

  const passes = AXES.map((footAxis) => ({
    footAxis,
    result: analyzeLandings(run.frames, {
      statureM: 1.7,
      massKg: 70,
      width: run.width,
      height: run.height,
      preFiltered: true,
      footAxis,
    }),
  }));

  console.log(`\n=== ${target} ===`);
  console.log(
    `새끼발가락이 있는 프레임 ${withToes}/${run.frames.length}` +
      (withToes === 0 ? " — 비교할 것이 없습니다" : ""),
  );
  if (withToes === 0) return;

  for (const { footAxis, result } of passes) {
    const angles = result.landings.map((landing) => landing.footStrikeAngleDeg);
    console.log(
      `  ${footAxis.padEnd(10)} 착지 ${String(result.landings.length).padStart(2)}` +
        ` · 평균 ${show(mean(angles)).padStart(7)}` +
        ` · 중앙 ${show(median(angles.filter(Number.isFinite))).padStart(7)}` +
        ` · ${mix(result.landings)}`,
    );
  }

  // Paired by contact time, so the difference is between the same footfalls
  // and not between two averages over different sets of them. The axis does
  // not change contact detection, so the pairing should be complete — if it
  // is not, something other than the axis moved.
  const { paired, browserOnly, sports2dOnly } = pairLandings(
    passes[0].result.landings,
    passes[1].result.landings,
  );
  const shifts = paired
    .map((pair) => pair.sports2d.footStrikeAngleDeg - pair.browser.footStrikeAngleDeg)
    .filter(Number.isFinite);
  const flipped = paired.filter((pair) => !pair.sameStrike);

  console.log(
    `  차이       짝 ${paired.length}쌍` +
      (browserOnly.length || sports2dOnly.length
        ? ` (미짝 ${browserOnly.length}/${sports2dOnly.length} — 축 말고 다른 게 움직였습니다)`
        : "") +
      ` · 중앙 ${show(median(shifts)).padStart(7)}` +
      ` · 절대 평균 ${show(mean(shifts.map(Math.abs))).padStart(7)}` +
      ` · 주법 바뀜 ${flipped.length}`,
  );
  for (const pair of flipped.slice(0, 5)) {
    console.log(
      `      ${pair.browser.tContact.toFixed(2)}s  ` +
        `${footStrikeLabel[pair.browser.footStrike]} ${show(pair.browser.footStrikeAngleDeg)}` +
        ` → ${footStrikeLabel[pair.sports2d.footStrike]} ${show(pair.sports2d.footStrikeAngleDeg)}`,
    );
  }

  // The claim, tested where it can be. If the axis matters because a turned
  // foot puts one toe nearer than the other, the two definitions must disagree
  // more on the contacts where the toes are further apart across the image.
  const spreads: number[] = [];
  const diffs: number[] = [];
  for (const pair of paired) {
    if (pair.browser.side === "unknown") continue;
    const spread = toeSpread(run, pair.browser.tContact, pair.browser.side as "left" | "right");
    const diff = Math.abs(
      pair.sports2d.footStrikeAngleDeg - pair.browser.footStrikeAngleDeg,
    );
    if (Number.isFinite(spread) && Number.isFinite(diff)) {
      spreads.push(spread);
      diffs.push(diff);
    }
  }
  if (spreads.length >= 6) {
    const r = correlation(spreads, diffs);
    console.log(
      `  발 틀어짐   n=${spreads.length}` +
        ` · 벌어짐 중앙 ${median(spreads).toFixed(2)} (10~90% ${percentile(spreads, 0.1).toFixed(2)}~${percentile(spreads, 0.9).toFixed(2)})` +
        ` · 축 차이와의 상관 ${Number.isFinite(r) ? r.toFixed(2) : "없음"}` +
        (Number.isFinite(r)
          ? r > 0.3
            ? " (예측대로 — 틀어질수록 갈립니다)"
            : r < -0.3
              ? " (반대 방향)"
              : " (관계 없음 — 틀어짐 때문이 아닙니다)"
          : ""),
    );
  }
}

function main(argv: string[]): number {
  const target = argv[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/foot-axis.ts <out/<id> 또는 out>");
    return 2;
  }
  const targets = runsUnder(target);
  if (!targets.length) {
    console.error(`처리된 실행이 없습니다: ${target} (run.py 를 먼저 돌리세요)`);
    return 1;
  }
  for (const one of targets) {
    try {
      report(one);
    } catch (error) {
      console.error(`${one}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
