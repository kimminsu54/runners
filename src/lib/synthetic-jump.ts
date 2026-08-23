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
  arr[11] = lm(0.44, hipY - 0.18);
  arr[12] = lm(0.56, hipY - 0.18);
  arr[23] = lm(0.47, hipY);
  arr[24] = lm(0.53, hipY);
  arr[25] = lm(0.47, hipY + 0.12);
  arr[26] = lm(0.53, hipY + 0.12);
  arr[27] = lm(0.47, leftFootY);
  arr[28] = lm(0.53, rightFootY);
  arr[29] = arr[27];
  arr[30] = arr[28];
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

export function syntheticRunningFrames(fps = 30): PoseFrame[] {
  const contacts = [0.4, 0.73, 1.06, 1.39, 1.72, 2.05];
  const leftContacts = contacts.filter((_, i) => i % 2 === 0);
  const rightContacts = contacts.filter((_, i) => i % 2 === 1);
  const duration = 2.35;
  const frames: PoseFrame[] = [];

  for (let i = 0; i < Math.round(duration * fps); i++) {
    const t = i / fps;
    const nearest = contacts.reduce((a, b) =>
      Math.abs(t - a) < Math.abs(t - b) ? a : b,
    );
    const d = t - nearest;
    let hipY = 0.43;
    if (d >= -0.16 && d < 0) hipY = lerp(0.43, 0.46, (d + 0.16) / 0.16);
    else if (d >= 0 && d < 0.16) hipY = lerp(0.46, 0.43, d / 0.16);

    frames.push({
      t,
      landmarks: poseAt(
        hipY,
        runningFootY(t, leftContacts),
        runningFootY(t, rightContacts),
      ),
    });
  }
  return frames;
}

function runningFootY(t: number, contacts: number[]): number {
  const nearest = contacts.reduce((a, b) =>
    Math.abs(t - a) < Math.abs(t - b) ? a : b,
  );
  const d = t - nearest;
  if (d < -0.16 || d > 0.22) return 0.62;
  if (d < 0) return lerp(0.62, 0.82, (d + 0.16) / 0.16);
  if (d < 0.1) return 0.82;
  return lerp(0.82, 0.62, (d - 0.1) / 0.12);
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

export function assertDetectsRunningSteps() {
  const result = analyzeLandings(syntheticRunningFrames(), {
    statureM: 1.7,
    massKg: 70,
    width: 1280,
    height: 720,
  });
  if (result.landings.length < 4) {
    throw new Error(
      `expected at least four running contacts, got ${result.landings.length}`,
    );
  }
  return result.landings;
}
