/**
 * Choosing where in time to read the foot's inclination, on real footage.
 *
 * A synthetic runner already answered which window is most accurate, because
 * there the angle is known: reading the largest inclination in the 50 ms before
 * contact recovered every verdict, and reading either side of contact — what
 * the analysis does today — lost five to ten degrees toward midfoot and
 * misclassified a −10° rearfoot every time. Real footage cannot repeat that
 * test; nobody knows the true angle of these contacts.
 *
 * What real footage can test is stability, and that is what this measures. The
 * two pipelines are independent estimators of the same feet. Where they
 * already agree, a change to the sampling window should not pull them apart —
 * if it does, the window is reading noise that the two estimators do not
 * share. That is a weaker claim than accuracy and it is the one available.
 *
 *     npx tsx tools/sports2d/angle-window.ts tools/sports2d/out/06
 *
 * Needs browser-frames.json from dump-browser.py beside the Sports2D output.
 *
 * The two pipelines are analysed with different smoothing on purpose, matching
 * how the app treats them: Sports2D arrives already filtered and is passed
 * through untouched, while the browser's frames get the moving average. Using
 * one setting for both would compare something neither pipeline uses.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeLandings,
  footStrikeLabel,
  type AnalysisResult,
  type PoseFrame,
  type StrikeAngleSampling,
} from "../../src/lib/landing-analysis";
import { median } from "../../src/lib/signal";
import { pairLandings } from "./../../src/lib/pipeline-compare";
import { loadRun } from "./load";

const WINDOWS: StrikeAngleSampling[] = ["around", "before", "before-wide", "peak"];

const mean = (values: number[]) => {
  const good = values.filter((value) => Number.isFinite(value));
  return good.length ? good.reduce((a, b) => a + b, 0) / good.length : Number.NaN;
};

const angles = (result: AnalysisResult) =>
  result.landings.map((landing) => landing.footStrikeAngleDeg);

const mix = (result: AnalysisResult) => {
  const counts = new Map<string, number>();
  for (const landing of result.landings) {
    counts.set(landing.footStrike, (counts.get(landing.footStrike) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([strike, n]) => `${footStrikeLabel[strike as keyof typeof footStrikeLabel]} ${n}`)
    .join(" · ");
};

const show = (value: number, unit = "°") =>
  Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : "없음";

/**
 * The foot's inclination through the frames around each contact, averaged
 * over contacts.
 *
 * This measures the assumption the wider sampling windows rest on. They read
 * earlier than touchdown because a foot is supposed to be set during late
 * swing and to hold that orientation until it lands — if that is true the
 * numbers to the left of contact are flat, and reading them costs nothing
 * while avoiding the rotation that follows. If instead the angle is still
 * moving before touchdown, a wider window is not a cleaner reading of the same
 * quantity; it is a reading of a different one.
 *
 * A synthetic fixture cannot answer this, because the assumption is what the
 * fixture was built on.
 */
const OFFSETS = [-3, -2, -1, 0, 1, 2, 3];

/** The series index nearest a landing's reported contact time. */
function indexOf(result: AnalysisResult, tContact: number): number {
  let at = 0;
  for (let i = 1; i < result.series.length; i++) {
    if (
      Math.abs(result.series[i].t - tContact) < Math.abs(result.series[at].t - tContact)
    ) {
      at = i;
    }
  }
  return at;
}

/**
 * A per-frame quantity around each contact, pooled across contacts.
 *
 * Anchored on the contact time the report gives, which is the detector's
 * answer — so a shape that peaks or bottoms out beside the anchor rather than
 * on it says the anchor is off by that much.
 */
function trajectory(
  result: AnalysisResult,
  label: string,
  pick: (point: AnalysisResult["series"][number], side: "left" | "right") => number,
  unit: string,
): void {
  const columns = OFFSETS.map(() => [] as number[]);
  for (const landing of result.landings) {
    if (landing.side === "unknown") continue;
    const at = indexOf(result, landing.tContact);
    OFFSETS.forEach((offset, column) => {
      const point = result.series[at + offset];
      if (!point) return;
      const value = pick(point, landing.side as "left" | "right");
      if (Number.isFinite(value)) columns[column].push(value);
    });
  }
  const cells = columns.map((values, i) => {
    const name = OFFSETS[i] === 0 ? "접지" : `${OFFSETS[i] > 0 ? "+" : ""}${OFFSETS[i]}`;
    return `${name} ${show(median(values), unit).padStart(8)}`;
  });
  console.log(`  ${label.padEnd(20)} ${cells.join("  ")}`);
}

function main(argv: string[]): number {
  const target = argv[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/angle-window.ts <out/<id>>");
    return 2;
  }

  const run = loadRun(target);
  let dump: { clip: string; frames: PoseFrame[] };
  try {
    dump = JSON.parse(readFileSync(join(target, "browser-frames.json"), "utf8"));
  } catch {
    console.error("browser-frames.json 이 없습니다 — dump-browser.py 를 먼저 돌리세요");
    return 1;
  }

  const base = { statureM: 1.7, massKg: 70, width: run.width, height: run.height };
  console.log(`\n=== ${dump.clip} ===`);
  console.log(
    "표본창".padEnd(12) +
      "브라우저".padEnd(30) +
      "Sports2D".padEnd(30) +
      "두 추정기 차이",
  );

  for (const sampling of WINDOWS) {
    const browser = analyzeLandings(dump.frames, {
      ...base,
      strikeAngleSampling: sampling,
    });
    const reference = analyzeLandings(run.frames, {
      ...base,
      preFiltered: true,
      strikeAngleSampling: sampling,
    });

    // Paired by contact time, so the difference is between the same footfalls
    // rather than between two averages over different sets of them.
    const { paired } = pairLandings(browser.landings, reference.landings);
    const gaps = paired
      .map((pair) => pair.sports2d.footStrikeAngleDeg - pair.browser.footStrikeAngleDeg)
      .filter(Number.isFinite);
    const agreed = paired.filter((pair) => pair.sameStrike).length;

    console.log(
      sampling.padEnd(14) +
        `${show(mean(angles(browser))).padStart(7)} ${mix(browser).padEnd(22)}` +
        `${show(mean(angles(reference))).padStart(7)} ${mix(reference).padEnd(22)}` +
        `중앙 ${show(median(gaps)).padStart(7)} · 절대 평균 ${show(mean(gaps.map(Math.abs))).padStart(7)}` +
        ` · 주법 일치 ${agreed}/${paired.length}`,
    );
  }

  const browserPass = analyzeLandings(dump.frames, base);
  const referencePass = analyzeLandings(run.frames, { ...base, preFiltered: true });

  console.log("\n접지 주변 궤적 (프레임 오프셋, 중앙값)");
  const angle = (point: AnalysisResult["series"][number], side: "left" | "right") =>
    side === "left" ? point.leftFootStrikeAngle : point.rightFootStrikeAngle;
  // Hip-relative foot drop: larger means the foot is further below the hip,
  // which is what rises to a maximum and holds while the foot is planted. The
  // frame it stops rising on is the touchdown, so where that sits relative to
  // the anchor is the detector's own offset.
  const drop = (point: AnalysisResult["series"][number], side: "left" | "right") =>
    side === "left" ? point.leftFootM : point.rightFootM;
  const speed = (point: AnalysisResult["series"][number], side: "left" | "right") =>
    side === "left" ? point.leftFootSpeed : point.rightFootSpeed;

  trajectory(browserPass, "브라우저 각도", angle, "°");
  trajectory(referencePass, "Sports2D 각도", angle, "°");
  trajectory(browserPass, "브라우저 발 낙차", drop, "m");
  trajectory(referencePass, "Sports2D 발 낙차", drop, "m");
  trajectory(browserPass, "브라우저 발 속도", speed, "");
  trajectory(referencePass, "Sports2D 발 속도", speed, "");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
