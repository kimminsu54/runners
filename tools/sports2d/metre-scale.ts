/**
 * How far off is the app's pixel-to-metre scale?
 *
 * Every metre-valued number the report shows rests on one factor. The app
 * derives it by measuring the runner in pixels — the nose-to-heel distance,
 * divided by 0.92 because that is roughly the fraction of a person's height
 * that spans — and dividing the declared stature by it. Sports2D derives its
 * own from the same declared height by a different route, and writes it into a
 * second TRC in metres.
 *
 *     npx tsx tools/sports2d/metre-scale.ts tools/sports2d/out
 *
 * Comparing the two bounds the error in ours. Distances rather than
 * coordinates, because Sports2D's metre frame is rotated and translated
 * relative to the image and only the scale survives that.
 *
 * What this cannot check is the stature itself. Both sides are told the same
 * height, and for these clips that height is a placeholder — so this measures
 * the pixel-height estimate, not whether the runner is 1.70 m. An error in the
 * declared height passes into both identically and would not show up here at
 * all.
 */

import { readFileSync } from "node:fs";

import { analyzeLandings } from "../../src/lib/landing-analysis";
import { median, percentile } from "../../src/lib/signal";
import { parseTrc, type TrcTable } from "../../src/lib/sports2d";
import { loadRun, runsUnder } from "./load";

/**
 * Marker pairs spanning a limb or the trunk.
 *
 * Long spans, because a scale read from a short one carries the landmark noise
 * at both ends magnified by however short it is. Both feet and both sides, so
 * one badly placed limb cannot set the answer.
 */
const SPANS: ReadonlyArray<readonly [string, string]> = [
  ["Hip", "Neck"],
  ["RHip", "RKnee"],
  ["LHip", "LKnee"],
  ["RKnee", "RAnkle"],
  ["LKnee", "LAnkle"],
  ["Neck", "Nose"],
];

const columnOf = (table: TrcTable, name: string) =>
  table.markers.findIndex((marker) => marker.toLowerCase() === name.toLowerCase());

/** Distance between two markers in a frame, or NaN when either is missing. */
function span(table: TrcTable, frame: number, a: number, b: number): number {
  const points = table.frames[frame]?.points;
  const from = points?.[a];
  const to = points?.[b];
  if (!from || !to) return Number.NaN;
  return Math.hypot(to.x - from.x, to.y - from.y, (to.z ?? 0) - (from.z ?? 0));
}

function report(target: string): void {
  const run = loadRun(target);

  // The metre file for the same person. Taking a different person's would
  // compare one runner's pixels against another's metres.
  const metrePath = run.trcPath.replace("_px_", "_m_");
  let metre: TrcTable;
  try {
    metre = parseTrc(readFileSync(metrePath, "utf8"));
  } catch {
    console.log(`\n=== ${target} ===\n  미터 TRC 없음: ${metrePath}`);
    return;
  }

  const ratios: number[] = [];
  for (const [a, b] of SPANS) {
    const pxA = columnOf(run.table, a);
    const pxB = columnOf(run.table, b);
    const mA = columnOf(metre, a);
    const mB = columnOf(metre, b);
    if (pxA < 0 || pxB < 0 || mA < 0 || mB < 0) continue;
    const frames = Math.min(run.table.frames.length, metre.frames.length);
    for (let i = 0; i < frames; i++) {
      const pixels = span(run.table, i, pxA, pxB);
      const metres = span(metre, i, mA, mB);
      if (pixels > 20 && metres > 0.05) ratios.push(metres / pixels);
    }
  }

  console.log(`\n=== ${target} ===`);
  if (ratios.length < 20) {
    console.log(`  비교할 구간이 부족합니다 (${ratios.length}개)`);
    return;
  }

  const theirs = median(ratios);
  const result = analyzeLandings(run.frames, {
    statureM: 1.7,
    massKg: 70,
    width: run.width,
    height: run.height,
    preFiltered: true,
  });
  const ours = result.metersPerPixel;
  const off = (ours / theirs - 1) * 100;

  // The spread across frames and limbs, which says whether their scale is one
  // number or a cloud. A single calibration should be nearly constant; a wide
  // spread means the metre file is not simply the pixel file scaled.
  const spread =
    (percentile(ratios, 0.9) - percentile(ratios, 0.1)) / theirs;

  console.log(
    `  Sports2D  ${theirs.toExponential(3)} m/px` +
      ` · 구간 ${ratios.length}개 · 퍼짐 ${(spread * 100).toFixed(0)}%`,
  );
  console.log(
    `  앱        ${ours.toExponential(3)} m/px` +
      ` · 신장 픽셀 ${(1.7 / ours).toFixed(0)}px` +
      ` · 차이 ${off > 0 ? "+" : ""}${off.toFixed(1)}%`,
  );

  // The same span in both files, which turns the ratio into something
  // interpretable. The app assumes nose-to-heel covers 0.92 of a person's
  // height; if Sports2D's world reconstruction disagrees about that span, the
  // two are not measuring the same body and the disagreement is about the
  // model rather than about precision.
  const noseCol = { px: columnOf(run.table, "Nose"), m: columnOf(metre, "Nose") };
  const heelCols = ["RHeel", "LHeel"].map((name) => ({
    px: columnOf(run.table, name),
    m: columnOf(metre, name),
  }));
  const pxSpans: number[] = [];
  const mSpans: number[] = [];
  if (noseCol.px >= 0 && noseCol.m >= 0) {
    const frames = Math.min(run.table.frames.length, metre.frames.length);
    for (let i = 0; i < frames; i++) {
      for (const heel of heelCols) {
        if (heel.px < 0 || heel.m < 0) continue;
        const pixels = span(run.table, i, noseCol.px, heel.px);
        const metres = span(metre, i, noseCol.m, heel.m);
        if (pixels > 20 && metres > 0.1) {
          pxSpans.push(pixels);
          mSpans.push(metres);
        }
      }
    }
  }
  if (pxSpans.length >= 20) {
    const pxSpan = median(pxSpans);
    const mSpan = median(mSpans);
    console.log(
      `  코→발꿈치  픽셀 ${pxSpan.toFixed(0)}px · Sports2D ${mSpan.toFixed(2)}m` +
        ` = 신장의 ${((mSpan / 1.7) * 100).toFixed(0)}%` +
        ` · 앱의 가정 92%`,
    );
  }

  // What the difference costs, in the numbers a reader sees. The strike angle
  // is a ratio and immune; these are not.
  const finite = (values: number[]) => values.filter(Number.isFinite);
  const meanOf = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
  const ahead = meanOf(finite(result.landings.map((l) => l.footAheadM)));
  const impact = meanOf(finite(result.landings.map((l) => l.impactVelocity)));
  if (Number.isFinite(ahead) || Number.isFinite(impact)) {
    console.log(
      `  영향       몸 앞 착지 ${(ahead * 100).toFixed(1)}cm → ${(ahead * 100 * (theirs / ours)).toFixed(1)}cm` +
        ` · 충격 속도 ${impact.toFixed(2)} → ${(impact * (theirs / ours)).toFixed(2)} m/s`,
    );
  }
}

function main(argv: string[]): number {
  const target = argv[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/metre-scale.ts <out/<id> 또는 out>");
    return 2;
  }
  const targets = runsUnder(target);
  if (!targets.length) {
    console.error(`처리된 실행이 없습니다: ${target}`);
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
