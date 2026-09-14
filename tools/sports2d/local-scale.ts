/**
 * What the metre scale does to the values built on it.
 *
 * `measureSubject` takes the median of the subject's apparent height over
 * every frame and turns it into one `metersPerPixel`. A landing happens at one
 * moment, so for a runner who approaches the camera that single scale is wrong
 * at both ends of the clip — measured, the local median disagrees with it by
 * 17-28% on four of six clips.
 *
 * Force is safe: `peakGrfBw` comes from the duty factor, which is timing. What
 * rides on the scale is the fore-aft landing distance, the impact velocity,
 * and, squaring that velocity, the equivalent drop height.
 *
 * Two questions, so two things here. Whether making the scale local helps: the
 * frames are rescaled about the hip so the subject is the clip's median size
 * everywhere, which makes the clip-wide scale correct for every frame, and the
 * same `analyzeLandings` runs on both. It helps the fore-aft ratio a little
 * and the drop height not at all.
 *
 * And what those values actually read, which turned out to be the finding:
 * impact velocity is 0.1-0.5 m/s on five clips and 1.5 m/s on the sixth, and
 * injury-guidance escalates at 1.8 and 2.6 m/s.
 *
 *     npx tsx tools/sports2d/local-scale.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeLandings, type PoseFrame } from "../../src/lib/landing-analysis";
import type { Landmark } from "../../src/lib/pose";

const HERE = dirname(fileURLToPath(import.meta.url));

const NOSE = 0;
const L_HIP = 23,
  R_HIP = 24;
const L_ANKLE = 27,
  R_ANKLE = 28;
const L_HEEL = 29,
  R_HEEL = 30;
const NOSE_HEEL_OF_STATURE = 0.92;
const VISIBLE = 0.3;
const WINDOW = 15;

const median = (xs: number[]): number => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : Number.NaN;
};

/** The subject's apparent standing height in pixels, or NaN if unreadable. */
function staturePx(lm: Landmark[] | null, w: number, h: number): number {
  if (!lm) return Number.NaN;
  const nose = lm[NOSE];
  if (!nose || (nose.visibility ?? 1) < VISIBLE) return Number.NaN;
  const pick = (a: Landmark, b: Landmark) =>
    Math.min(a?.visibility ?? 1, b?.visibility ?? 1) >= VISIBLE
      ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      : null;
  const heel = pick(lm[L_HEEL], lm[R_HEEL]) ?? pick(lm[L_ANKLE], lm[R_ANKLE]);
  if (!heel) return Number.NaN;
  const px = Math.hypot((nose.x - heel.x) * w, (nose.y - heel.y) * h);
  return px > 20 ? px / NOSE_HEEL_OF_STATURE : Number.NaN;
}

/**
 * Frames whose subject is the same apparent size throughout.
 *
 * Each frame is scaled about the hip centre, which keeps the runner in place
 * while changing only how large they are — the quantity the metre scale
 * converts. Scaling both axes by the same factor is what makes the pixel
 * distance scale by it too, since x and y are normalised against different
 * edges.
 */
function normalised(frames: PoseFrame[], w: number, h: number): PoseFrame[] {
  const heights = frames.map((f) => staturePx(f.landmarks, w, h));
  const whole = median(heights);
  return frames.map((frame, i) => {
    const lm = frame.landmarks;
    const local = median(heights.slice(Math.max(0, i - WINDOW), i + WINDOW));
    if (!lm || !Number.isFinite(local) || !Number.isFinite(whole) || local <= 0) {
      return frame;
    }
    const k = whole / local;
    const hip = lm[L_HIP] && lm[R_HIP]
      ? { x: (lm[L_HIP].x + lm[R_HIP].x) / 2, y: (lm[L_HIP].y + lm[R_HIP].y) / 2 }
      : null;
    if (!hip) return frame;
    return {
      t: frame.t,
      landmarks: lm.map((p) => ({
        ...p,
        x: hip.x + (p.x - hip.x) * k,
        y: hip.y + (p.y - hip.y) * k,
      })),
    };
  });
}

/** Spread of a per-landing value, as the middle 80% over its own median. */
function spread(xs: number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 5) return Number.NaN;
  const med = median(v);
  return med ? (v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)]) / med : Number.NaN;
}

const clips = readFileSync(join(HERE, "clips.csv"), "utf8").split(/\r?\n/).slice(1);
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "—");

console.log(
  "클립  조건                화면몫       하강속도 m/s 중앙(10~90)  경고/high        등가 낙하 cm",
);
for (const line of clips) {
  if (!line.trim()) continue;
  const id = line.split(",")[0];
  const dump = join(HERE, "out", id, "browser-frames.json");
  if (!existsSync(dump)) continue;
  const size = /(\d+)x(\d+)/.exec(line);
  if (!size) continue;
  const w = Number(size[1]);
  const h = Number(size[2]);
  const label = /,"?([^,"]*(?:구간|사람|조건|접지|해상도|판)[^,"]*)"?,/.exec(line)?.[1] ?? "";

  const frames: PoseFrame[] = JSON.parse(readFileSync(dump, "utf8")).frames;
  const options = { statureM: 1.7, massKg: 65, width: w, height: h };
  const before = analyzeLandings(frames, options);
  const after = analyzeLandings(normalised(frames, w, h), options);

  const drop = (r: typeof before) => r.landings.map((l) => l.equivalentDropCm);
  const vel = (r: typeof before) => r.landings.map((l) => l.impactVelocity);
  // How big the runner is on screen, because that is what the metre scale is
  // supposed to divide out and the suspicion is that it does not.
  const heights = frames.map((f) => staturePx(f.landmarks, w, h));
  const sizeShare = median(heights) / h;
  const trips = (xs: number[], at: number) => xs.filter((v) => v >= at).length;
  const band = (xs: number[]) => {
    const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
    if (v.length < 5) return "—";
    const lo = v[Math.floor(v.length * 0.1)];
    const hi = v[Math.floor(v.length * 0.9)];
    return `${median(v).toFixed(1)} (${lo.toFixed(1)}~${hi.toFixed(1)})`;
  };
  console.log(
    `${id.padEnd(5)} ${label.slice(0, 18).padEnd(19)}` +
      ` ${pct(sizeShare).padStart(5)}` +
      ` ${band(vel(before)).padStart(20)}` +
      ` ${String(trips(vel(before), 1.8)).padStart(3)}/${String(trips(vel(before), 2.6)).padEnd(3)}` +
      ` ${band(drop(before)).padStart(20)}`,
  );
}
console.log();
console.log("화면몫 = 러너의 키가 화면 높이에서 차지하는 비율");
console.log("경고/high = injury-guidance 의 1.8 m/s 와 2.6 m/s 를 넘은 착지 수");
