import {
  analyzeLandings,
  G,
  type PoseFrame,
} from "@/lib/landing-analysis";
import type { Landmark } from "@/lib/pose";

function lm(x: number, y: number): Landmark {
  return { x, y, visibility: 1 };
}

function poseAt(
  hipY: number,
  leftFootY = hipY + 0.26,
  rightFootY = hipY + 0.26,
): Landmark[] {
  const arr = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  arr[0] = lm(0.5, hipY - 0.28);
  arr[11] = lm(0.49, hipY - 0.18);
  arr[12] = lm(0.51, hipY - 0.18);
  arr[23] = lm(0.495, hipY);
  arr[24] = lm(0.505, hipY);
  arr[25] = lm(0.47, hipY + 0.12);
  arr[26] = lm(0.53, hipY + 0.12);
  arr[27] = lm(0.47, leftFootY);
  arr[28] = lm(0.53, rightFootY);
  arr[29] = arr[27];
  arr[30] = arr[28];
  arr[31] = lm(0.39, leftFootY);
  arr[32] = lm(0.61, rightFootY);
  return arr;
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u;
}

export function syntheticJumpFrames(fps = 30): PoseFrame[] {
  const duration = 1.4;
  const n = Math.round(duration * fps);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    let hipY = 0.52;
    if (t < 0.25) hipY = 0.52;
    else if (t < 0.45) hipY = lerp(0.52, 0.38, (t - 0.25) / 0.2);
    else if (t < 0.72) hipY = lerp(0.38, 0.58, (t - 0.45) / 0.27);
    else if (t < 0.82) hipY = lerp(0.58, 0.61, (t - 0.72) / 0.1);
    else hipY = lerp(0.61, 0.52, Math.min(1, (t - 0.82) / 0.25));
    frames.push({ t, landmarks: poseAt(hipY) });
  }
  return frames;
}

export type RunningGait = {
  /** Seconds one foot stays on the ground. */
  contactS: number;
  /** Seconds with neither foot down, between consecutive contacts. */
  flightS: number;
  steps: number;
  fps: number;
};

const GROUND_Y = 0.82;
const FOOT_LIFT = 0.14;

export function syntheticRunningFrames(
  gait: Partial<RunningGait> = {},
): PoseFrame[] {
  const { contactS = 0.24, flightS = 0.1, steps = 8, fps = 60 } = gait;
  const stepPeriod = contactS + flightS;
  const starts = Array.from({ length: steps }, (_, i) => 0.25 + i * stepPeriod);
  const leftStarts = starts.filter((_, i) => i % 2 === 0);
  const rightStarts = starts.filter((_, i) => i % 2 === 1);
  const duration = starts[starts.length - 1] + contactS + flightS + 0.25;

  const frames: PoseFrame[] = [];
  for (let i = 0; i < Math.round(duration * fps); i++) {
    const t = i / fps;
    frames.push({
      t,
      landmarks: poseAt(
        runningHipY(t, starts, contactS, stepPeriod),
        runningFootY(t, leftStarts, contactS),
        runningFootY(t, rightStarts, contactS),
      ),
    });
  }
  return frames;
}

function runningHipY(
  t: number,
  starts: number[],
  contactS: number,
  stepPeriod: number,
): number {
  // Lowest at mid-stance, highest in mid-flight, about 8 cm peak to peak.
  const phase = (t - (starts[0] + contactS / 2)) / stepPeriod;
  return 0.43 + 0.014 * Math.cos(2 * Math.PI * phase);
}

// A real foot is not planted instantly. It rolls in at heel strike and peels
// off at the toe, so the height signal eases into and out of the ground over a
// few tens of milliseconds. Threshold detectors clip those edges, and the
// fixture has to reproduce that or it will not test the same problem.
const ROLL_S = 0.04;

function runningFootY(
  t: number,
  starts: number[],
  contactS: number,
): number {
  for (const start of starts) {
    if (t < start - ROLL_S || t > start + contactS + ROLL_S) continue;
    if (t >= start && t <= start + contactS) return GROUND_Y;
    const edge = t < start ? (start - t) / ROLL_S : (t - start - contactS) / ROLL_S;
    return GROUND_Y - FOOT_LIFT * 0.6 * edge;
  }
  const prevEnd = Math.max(
    ...starts.filter((s) => s + contactS < t).map((s) => s + contactS),
    Number.NEGATIVE_INFINITY,
  );
  const nextStart = Math.min(
    ...starts.filter((s) => s > t),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(prevEnd) || !Number.isFinite(nextStart)) {
    return GROUND_Y - FOOT_LIFT * 0.5;
  }
  const u = (t - prevEnd) / (nextStart - prevEnd);
  return GROUND_Y - FOOT_LIFT * Math.sin(Math.PI * u);
}

export function assertDetectsLanding() {
  const frames = syntheticJumpFrames();
  const result = analyzeLandings(frames, {
    statureM: 1.7,
    massKg: 70,
    width: 1280,
    height: 720,
  });
  if (result.landings.length < 1) {
    throw new Error("expected at least one landing");
  }
  const hit = result.landings[0];
  if (hit.tContact < 0.55 || hit.tContact > 0.85) {
    throw new Error(`landing time out of range: ${hit.tContact}`);
  }
  if (hit.peakGrfBw < 1.4) {
    throw new Error(`peak GRF too small: ${hit.peakGrfBw}`);
  }
  if (hit.impactVelocity < 0.8) {
    throw new Error(`impact velocity too small: ${hit.impactVelocity}`);
  }
  if (!Number.isFinite(hit.peakForceN) || Math.abs(hit.peakForceN - hit.peakGrfBw * 70 * G) > 1) {
    throw new Error("force conversion mismatch");
  }
  return hit;
}

export function analyzeSyntheticRun(gait: Partial<RunningGait> = {}) {
  return analyzeLandings(syntheticRunningFrames(gait), {
    statureM: 1.7,
    massKg: 70,
    width: 1280,
    height: 720,
  });
}

export function assertDetectsRunningSteps() {
  const result = analyzeSyntheticRun();
  if (result.landings.length < 4) {
    throw new Error(
      `expected at least four running contacts, got ${result.landings.length}`,
    );
  }
  return result.landings;
}
