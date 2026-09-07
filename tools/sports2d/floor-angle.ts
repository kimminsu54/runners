/**
 * Is the ground level in the image, and does anyone know?
 *
 * The strike angle is the foot's inclination against the image's horizontal, so
 * it assumes the image's horizontal is the ground. A camera tilted by θ offsets
 * every strike angle by θ, and the boundary between rearfoot and forefoot is
 * only 8° from flat — a few degrees of tilt is a sizeable share of a category.
 *
 * Sports2D estimates a camera horizon and logs it. On these six clips it
 * reports −30.0°, −0.7°, −3.8°, 0.0°, +19.0° and +1.9°, and the first and fifth
 * of those are not believable for a phone held by a person. So rather than
 * adopt the number, this measures the same thing independently.
 *
 *     npx tsx tools/sports2d/floor-angle.ts tools/sports2d/out
 *
 * The ground is where feet are planted. Collect the foot's position at each
 * contact and fit a line through them: on level ground that line is horizontal,
 * and its slope is the tilt. It needs the runner to travel across the frame —
 * on a treadmill every contact lands at the same place and the fit has nothing
 * to work with, which the output says rather than reporting a number from a
 * degenerate fit.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { analyzeLandings, type AnalysisResult, type PoseFrame } from "../../src/lib/landing-analysis";
import { LM } from "../../src/lib/pose";
import { median, percentile } from "../../src/lib/signal";
import { find, loadRun, runsUnder } from "./load";

type Point = { x: number; y: number };

/**
 * Least-squares line through the contact points, as an angle in degrees.
 *
 * Positive means the ground falls to the right in the image. Returns NaN when
 * the points are too bunched horizontally for a slope to mean anything: the fit
 * would still produce a number, and it would be noise amplified by however
 * little the runner moved.
 */
function tiltOf(points: Point[], width: number): { deg: number; spreadPx: number } {
  if (points.length < 4) return { deg: Number.NaN, spreadPx: 0 };
  const xs = points.map((p) => p.x);
  const spreadPx = (percentile(xs, 0.9) - percentile(xs, 0.1)) * width;
  // A tenth of the frame. Below that the runner is on the spot and the line
  // through their footfalls describes noise.
  if (spreadPx < width * 0.1) return { deg: Number.NaN, spreadPx };

  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let top = 0;
  let bottom = 0;
  for (const p of points) {
    top += (p.x - meanX) * (p.y - meanY);
    bottom += (p.x - meanX) ** 2;
  }
  if (!(bottom > 0)) return { deg: Number.NaN, spreadPx };
  // Normalised coordinates are not square, so the slope has to be converted
  // back to pixels before it is an angle.
  const slope = (top / bottom) * (1 / 1);
  return { deg: (Math.atan(slope) * 180) / Math.PI, spreadPx };
}

/** The planted foot's position at each contact, in normalised coordinates. */
function contactPoints(frames: PoseFrame[], result: AnalysisResult): Point[] {
  const points: Point[] = [];
  for (const landing of result.landings) {
    if (landing.side === "unknown") continue;
    let at = 0;
    for (let i = 1; i < frames.length; i++) {
      if (Math.abs(frames[i].t - landing.tContact) < Math.abs(frames[at].t - landing.tContact)) {
        at = i;
      }
    }
    const lm = frames[at]?.landmarks;
    if (!lm) continue;
    const heel = lm[landing.side === "left" ? LM.leftHeel : LM.rightHeel];
    const ankle = lm[landing.side === "left" ? LM.leftAnkle : LM.rightAnkle];
    const point = heel && (heel.visibility ?? 1) >= 0.3 ? heel : ankle;
    if (point && (point.visibility ?? 1) >= 0.3) points.push({ x: point.x, y: point.y });
  }
  return points;
}

/**
 * Sports2D's own estimate, out of the log it writes.
 *
 * Found rather than constructed, because Sports2D nests the log inside a
 * folder named after the clip and looking for it beside the run directory
 * finds nothing.
 */
function loggedHorizon(target: string): number {
  const path = find(target, (name) => name.endsWith("logs.txt"));
  if (!path) return Number.NaN;
  const match = readFileSync(path, "utf8").match(/Camera horizon:\s*(-?[\d.]+)/);
  return match ? Number(match[1]) : Number.NaN;
}

/**
 * How much the runner's apparent size changes across the clip.
 *
 * This is the confound that decides whether a tilt reading means anything. A
 * runner crossing the frame at an angle — toward the camera or away from it —
 * traces a line of footfalls that rises toward the vanishing point, and a fit
 * through those points reports it as ground tilt. Apparent size is the tell:
 * a runner who stays the same distance away stays the same size.
 *
 * Measured as the nose-to-heel span in the first and last fifth of the tracked
 * frames, so one bad frame at an end cannot set it.
 */
function depthChange(frames: PoseFrame[], width: number, height: number): number {
  const spans: Array<{ i: number; px: number }> = [];
  frames.forEach((frame, i) => {
    const lm = frame.landmarks;
    if (!lm) return;
    const nose = lm[LM.nose];
    const heel = lm[LM.leftHeel] ?? lm[LM.rightHeel];
    if (!nose || !heel || (nose.visibility ?? 1) < 0.3 || (heel.visibility ?? 1) < 0.3) return;
    spans.push({
      i,
      px: Math.hypot((heel.x - nose.x) * width, (heel.y - nose.y) * height),
    });
  });
  if (spans.length < 20) return Number.NaN;
  const fifth = Math.max(4, Math.round(spans.length / 5));
  const first = median(spans.slice(0, fifth).map((s) => s.px));
  const last = median(spans.slice(-fifth).map((s) => s.px));
  return first > 0 ? (last / first - 1) * 100 : Number.NaN;
}

const show = (value: number) => (Number.isFinite(value) ? `${value.toFixed(2)}°` : "판단 불가");

function report(target: string): void {
  const run = loadRun(target);
  const base = {
    statureM: 1.7,
    massKg: 70,
    width: run.width,
    height: run.height,
  };

  console.log(`\n=== ${target} ===`);

  const rows: Array<[string, PoseFrame[], boolean]> = [["Sports2D", run.frames, true]];
  try {
    const dump = JSON.parse(
      readFileSync(join(target, "browser-frames.json"), "utf8"),
    ) as { frames: PoseFrame[] };
    rows.push(["브라우저", dump.frames, false]);
  } catch {
    // No dump for this clip; the Sports2D side alone still answers the question.
  }

  for (const [label, frames, preFiltered] of rows) {
    const result = analyzeLandings(frames, { ...base, preFiltered });
    const points = contactPoints(frames, result);
    const { deg, spreadPx } = tiltOf(points, run.width);
    const depth = depthChange(frames, run.width, run.height);
    console.log(
      `  ${label.padEnd(9)} 접지점 ${String(points.length).padStart(2)}개` +
        ` · 가로 퍼짐 ${((spreadPx / run.width) * 100).toFixed(0)}%` +
        ` · 지면 기울기 ${show(deg)}` +
        ` · 겉보기 크기 변화 ${Number.isFinite(depth) ? `${depth > 0 ? "+" : ""}${depth.toFixed(0)}%` : "?"}`,
    );
  }

  const logged = loggedHorizon(target);
  console.log(`  Sports2D 로그 · 카메라 수평 ${show(logged)}`);

  // What a tilt costs, stated against the boundary it has to be compared with.
  if (Number.isFinite(logged) && Math.abs(logged) > 1) {
    console.log(
      `             그 값이 맞다면 모든 주법 각도가 ${show(Math.abs(logged))} 밀립니다` +
        ` — 경계 8° 의 ${((Math.abs(logged) / 8) * 100).toFixed(0)}%`,
    );
  }
}

function main(argv: string[]): number {
  const target = argv[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/floor-angle.ts <out/<id> 또는 out>");
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
