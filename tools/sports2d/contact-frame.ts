/**
 * Is the frame we call touchdown the frame the foot arrived on?
 *
 * The adjudication sheet centres each strip on the contact time the report
 * gives, and asks a person which part of the foot touched first. If that frame
 * is already mid-stance the sheet is asking about the wrong moment, and every
 * answer it collects is about a foot that landed before the strip begins.
 *
 *     npx tsx tools/sports2d/contact-frame.ts tools/sports2d/out/05
 *
 * The check does not need a reference tool. The foot's own height says when it
 * arrived: it falls, it stops, it stays. Comparing the reported contact frame
 * with the first frame of that plateau gives the offset in frames, and its
 * sign says which way.
 */

import {
  analyzeLandings,
  type AnalysisResult,
  type PoseFrame,
} from "../../src/lib/landing-analysis";
import { LM } from "../../src/lib/pose";
import { median } from "../../src/lib/signal";
import { loadRun, runsUnder } from "./load";

/** The lowest of heel and ankle, in normalised units, or NaN. */
function footLow(frame: PoseFrame, side: "left" | "right"): number {
  const lm = frame.landmarks;
  if (!lm) return Number.NaN;
  const points = [
    lm[side === "left" ? LM.leftHeel : LM.rightHeel],
    lm[side === "left" ? LM.leftAnkle : LM.rightAnkle],
  ].filter((point) => point && (point.visibility ?? 1) >= 0.25);
  return points.length ? Math.max(...points.map((point) => point.y)) : Number.NaN;
}

/**
 * The first frame of the plateau the foot settles onto, searched around a
 * reported contact.
 *
 * The plateau level comes from the frames after the report's own index, which
 * is where the foot is down on any reading of it. Walking backwards while the
 * height stays within a small band of that level finds where the plateau
 * started; the band is a fraction of the foot's whole vertical travel, so it
 * scales with how big the runner is in frame.
 */
function arrivedAt(
  frames: PoseFrame[],
  side: "left" | "right",
  reported: number,
  travel: number,
): number {
  const level = median(
    [0, 1, 2, 3]
      .map((step) => footLow(frames[reported + step] ?? frames[reported], side))
      .filter(Number.isFinite),
  );
  if (!Number.isFinite(level)) return Number.NaN;
  const band = travel * 0.12;
  let at = reported;
  for (let i = reported; i > Math.max(0, reported - 8); i--) {
    const height = footLow(frames[i], side);
    if (!Number.isFinite(height) || height < level - band) break;
    at = i;
  }
  return at;
}

/**
 * Recovers the index the angle was read at.
 *
 * `strikeIdx` is not exported and is not the contact index — it comes from the
 * matched stance interval — so the offset measured for the contact time says
 * nothing about the angle on its own. It can be found rather than exported:
 * the default window takes the median of the two samples up to strikeIdx, so
 * the index whose window reproduces the published angle is that index.
 *
 * Searched outward from the contact index and returns the nearest match, so a
 * clip where two windows happen to give the same angle resolves to the one
 * the analysis would have used.
 */
function angleReadAt(
  result: AnalysisResult,
  side: "left" | "right",
  from: number,
  published: number,
): number {
  const angleOf = (i: number) => {
    const point = result.series[i];
    if (!point) return Number.NaN;
    return side === "left" ? point.leftFootStrikeAngle : point.rightFootStrikeAngle;
  };
  for (let step = 0; step <= 8; step++) {
    for (const at of step === 0 ? [from] : [from - step, from + step]) {
      const window = [at - 1, at].map(angleOf).filter(Number.isFinite);
      if (window.length && Math.abs(median(window) - published) < 0.05) return at;
    }
  }
  return Number.NaN;
}

function report(target: string, frames: PoseFrame[], result: AnalysisResult, label: string) {
  const travel = (() => {
    const all: number[] = [];
    for (const side of ["left", "right"] as const) {
      const heights = frames.map((frame) => footLow(frame, side)).filter(Number.isFinite);
      if (heights.length > 10) {
        const sorted = [...heights].sort((a, b) => a - b);
        all.push(sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)]);
      }
    }
    return all.length ? median(all) : Number.NaN;
  })();

  const offsets: number[] = [];
  for (const landing of result.landings) {
    if (landing.side === "unknown") continue;
    let reported = 0;
    for (let i = 1; i < frames.length; i++) {
      if (Math.abs(frames[i].t - landing.tContact) < Math.abs(frames[reported].t - landing.tContact)) {
        reported = i;
      }
    }
    const arrived = arrivedAt(frames, landing.side as "left" | "right", reported, travel);
    if (Number.isFinite(arrived)) offsets.push(reported - arrived);
  }

  // The same question for the index the angle is read at, which is the one
  // that decides whether the sampling window is anchored correctly.
  const angleOffsets: number[] = [];
  const trajectory = new Map<number, number[]>();
  for (const landing of result.landings) {
    if (landing.side === "unknown" || !Number.isFinite(landing.footStrikeAngleDeg)) continue;
    const side = landing.side as "left" | "right";
    let reported = 0;
    for (let i = 1; i < frames.length; i++) {
      if (Math.abs(frames[i].t - landing.tContact) < Math.abs(frames[reported].t - landing.tContact)) {
        reported = i;
      }
    }
    const readAt = angleReadAt(result, side, reported, landing.footStrikeAngleDeg);
    if (!Number.isFinite(readAt)) continue;
    const arrived = arrivedAt(frames, side, reported, travel);
    if (Number.isFinite(arrived)) angleOffsets.push(readAt - arrived);
    // The angle through the frames around the arrival, which is the anchor
    // that matters and the one the earlier trajectory table did not use.
    for (const offset of [-2, -1, 0, 1, 2]) {
      const point = result.series[arrived + offset];
      if (!point) continue;
      const angle = side === "left" ? point.leftFootStrikeAngle : point.rightFootStrikeAngle;
      if (!Number.isFinite(angle)) continue;
      const bucket = trajectory.get(offset) ?? [];
      bucket.push(angle);
      trajectory.set(offset, bucket);
    }
  }
  if (angleOffsets.length) {
    const counts = new Map<number, number>();
    for (const offset of angleOffsets) counts.set(offset, (counts.get(offset) ?? 0) + 1);
    console.log(
      `  ${"".padEnd(9)} 각도 인덱스가 도착보다 ${median(angleOffsets)}프레임 늦음` +
        ` (n=${angleOffsets.length} · ${[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([o, n]) => `${o >= 0 ? "+" : ""}${o}:${n}`).join(" ")})`,
    );
    const cells = [-2, -1, 0, 1, 2].map((offset) => {
      const values = trajectory.get(offset) ?? [];
      const name = offset === 0 ? "도착" : `${offset > 0 ? "+" : ""}${offset}`;
      return `${name} ${values.length ? `${median(values).toFixed(1)}°` : "없음"}`;
    });
    console.log(`  ${"".padEnd(9)} 도착 기준 각도 궤적: ${cells.join("  ")}`);
  }

  if (!offsets.length) {
    console.log(`  ${label.padEnd(9)} 판단할 착지가 없습니다`);
    return;
  }
  const counts = new Map<number, number>();
  for (const offset of offsets) counts.set(offset, (counts.get(offset) ?? 0) + 1);
  const spread = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([offset, n]) => `+${offset}:${n}`)
    .join(" ");
  console.log(
    `  ${label.padEnd(9)} 착지 ${offsets.length}개 · 늦은 프레임 중앙 ${median(offsets)}` +
      ` · 분포 ${spread}`,
  );
}

function main(argv: string[]): number {
  const target = argv[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/contact-frame.ts <out/<id> 또는 out>");
    return 2;
  }
  for (const one of runsUnder(target)) {
    const run = loadRun(one);
    const base = { statureM: 1.7, massKg: 70, width: run.width, height: run.height };
    console.log(`\n=== ${one} ===`);
    console.log("  보고된 접지 프레임이 발이 도착한 프레임보다 몇 프레임 늦은지");
    report(one, run.frames, analyzeLandings(run.frames, { ...base, preFiltered: true }), "Sports2D");
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
