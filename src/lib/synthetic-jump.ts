import {
  analyzeLandings,
  G,
  type PoseFrame,
} from "@/lib/landing-analysis";
import type { Landmark } from "@/lib/pose";

function lm(x: number, y: number): Landmark {
  return { x, y, visibility: 1 };
}

/**
 * The defaults describe the pose the jump and running fixtures have always
 * used: a body facing the camera-ish, feet planted apart with the toes splayed
 * outward. Everything the fore-aft and frontal fixtures need to vary is an
 * override, so those fixtures cannot move the numbers the older ones assert.
 */
type PoseShape = {
  /** Ankle x per side. */
  leftFootX?: number;
  rightFootX?: number;
  /** Toe offset from its own ankle. The sign is the direction the foot points. */
  leftToeDx?: number;
  rightToeDx?: number;
  /** Half-widths of the shoulder and hip pairs, which set the profile ratio. */
  shoulderHalf?: number;
  hipHalf?: number;
  /** Knee x per side, for shanks that are not vertical. */
  leftKneeX?: number;
  rightKneeX?: number;
  /** Hip y offset per side, for a pelvis that is not level. */
  leftHipDy?: number;
  rightHipDy?: number;
};

function poseAt(
  hipY: number,
  leftFootY = hipY + 0.26,
  rightFootY = hipY + 0.26,
  shape: PoseShape = {},
): Landmark[] {
  const {
    leftFootX = 0.47,
    rightFootX = 0.53,
    leftToeDx = -0.08,
    rightToeDx = 0.08,
    shoulderHalf = 0.01,
    hipHalf = 0.005,
    leftKneeX = 0.47,
    rightKneeX = 0.53,
    leftHipDy = 0,
    rightHipDy = 0,
  } = shape;
  const arr = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  arr[0] = lm(0.5, hipY - 0.28);
  arr[11] = lm(0.5 - shoulderHalf, hipY - 0.18);
  arr[12] = lm(0.5 + shoulderHalf, hipY - 0.18);
  arr[23] = lm(0.5 - hipHalf, hipY + leftHipDy);
  arr[24] = lm(0.5 + hipHalf, hipY + rightHipDy);
  arr[25] = lm(leftKneeX, hipY + 0.12);
  arr[26] = lm(rightKneeX, hipY + 0.12);
  arr[27] = lm(leftFootX, leftFootY);
  arr[28] = lm(rightFootX, rightFootY);
  arr[29] = arr[27];
  arr[30] = arr[28];
  arr[31] = lm(leftFootX + leftToeDx, leftFootY);
  arr[32] = lm(rightFootX + rightToeDx, rightFootY);
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

export type SideRunGait = RunningGait & {
  /**
   * How far ahead of the hip the ankle sits at touchdown, in normalised frame
   * width. 0 lands the foot under the body.
   */
  ahead: number;
  /** 1 runs to the right of frame, -1 mirrors the whole runner. */
  facing: 1 | -1;
};

/**
 * A runner seen from the side, with the fore-aft position of each foot under
 * the caller's control.
 *
 * The older running fixture cannot serve here: its feet are splayed with the
 * toes pointing outward, so each foot claims a different direction of travel
 * and both read as landing ahead. This one points both feet the same way, which
 * is what a person seen from the side actually looks like, and slides the foot
 * from `ahead` at touchdown back through stance — the relative motion of a foot
 * that stays put while the body passes over it.
 */
export function syntheticSideRunFrames(
  gait: Partial<SideRunGait> = {},
): PoseFrame[] {
  const {
    contactS = 0.24,
    flightS = 0.1,
    steps = 8,
    fps = 60,
    ahead = 0.066,
    facing = 1,
  } = gait;
  const stepPeriod = contactS + flightS;
  const starts = Array.from({ length: steps }, (_, i) => 0.25 + i * stepPeriod);
  const leftStarts = starts.filter((_, i) => i % 2 === 0);
  const rightStarts = starts.filter((_, i) => i % 2 === 1);
  const duration = starts[starts.length - 1] + contactS + flightS + 0.25;

  const frames: PoseFrame[] = [];
  for (let i = 0; i < Math.round(duration * fps); i++) {
    const t = i / fps;
    const leftX = 0.5 + facing * footX(t, leftStarts, contactS, stepPeriod, ahead);
    const rightX = 0.5 + facing * footX(t, rightStarts, contactS, stepPeriod, ahead);
    frames.push({
      t,
      landmarks: poseAt(
        runningHipY(t, starts, contactS, stepPeriod),
        runningFootY(t, leftStarts, contactS),
        runningFootY(t, rightStarts, contactS),
        {
          leftFootX: leftX,
          rightFootX: rightX,
          leftToeDx: facing * 0.06,
          rightToeDx: facing * 0.06,
          leftKneeX: 0.5 + (leftX - 0.5) * 0.4,
          rightKneeX: 0.5 + (rightX - 0.5) * 0.4,
        },
      ),
    });
  }
  return frames;
}

/**
 * Fore-aft offset of one foot from the hip, before the facing sign is applied.
 * Ahead at touchdown, sweeping back to the same distance behind by toe-off,
 * then forward again through swing.
 */
function footX(
  t: number,
  starts: number[],
  contactS: number,
  stepPeriod: number,
  ahead: number,
): number {
  for (const start of starts) {
    if (t >= start && t <= start + contactS) {
      const u = (t - start) / contactS;
      return ahead * (1 - 2 * u);
    }
  }
  const prevEnd = Math.max(
    ...starts.filter((start) => start + contactS < t).map((s) => s + contactS),
    Number.NEGATIVE_INFINITY,
  );
  const nextStart = Math.min(
    ...starts.filter((start) => start > t),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(prevEnd) || !Number.isFinite(nextStart)) {
    // Before the first contact or after the last: hold the touchdown position
    // rather than inventing a swing the clip does not contain.
    return ahead;
  }
  const u = (t - prevEnd) / (nextStart - prevEnd);
  return -ahead + 2 * ahead * u;
}

export type FrontRunGait = RunningGait & {
  /**
   * How far the stance knee falls toward the midline, in normalised frame
   * width. Applied only while that foot is down, so the peak-over-stance
   * reader has something to find and the swing leg stays aligned.
   */
  valgus: number;
  /** How far the swing-side hip drops, in normalised frame height. */
  pelvicDrop: number;
  /** -1 films the same runner from behind, swapping left and right in frame. */
  facing: 1 | -1;
};

/**
 * The same runner filmed from in front: shoulders and hips spread wide enough
 * that the profile ratio crosses `side_view_max_profile_ratio`, and each foot
 * seen end-on so it has no length in the image and therefore no direction.
 *
 * `facing: -1` is the same clip shot from behind. It mirrors the image, which
 * swaps which side of the frame each leg appears on without changing the
 * runner — so every frontal reading has to come out identical, and that is
 * what pins the sign convention to the pelvis rather than to the frame.
 */
export function syntheticFrontRunFrames(
  gait: Partial<FrontRunGait> = {},
): PoseFrame[] {
  const {
    contactS = 0.24,
    flightS = 0.1,
    steps = 8,
    fps = 60,
    valgus = 0,
    pelvicDrop = 0,
    facing = 1,
  } = gait;
  const stepPeriod = contactS + flightS;
  const starts = Array.from({ length: steps }, (_, i) => 0.25 + i * stepPeriod);
  const leftStarts = starts.filter((_, i) => i % 2 === 0);
  const rightStarts = starts.filter((_, i) => i % 2 === 1);
  const duration = starts[starts.length - 1] + contactS + flightS + 0.25;

  const frames: PoseFrame[] = [];
  for (let i = 0; i < Math.round(duration * fps); i++) {
    const t = i / fps;
    const leftDown = inStance(t, leftStarts, contactS);
    const rightDown = inStance(t, rightStarts, contactS);
    // Seen from in front, the runner's left side appears on the left of frame
    // in this fixture, and mirroring puts it on the right. Everything below is
    // written in frame coordinates and multiplied through by `facing`.
    //
    // Each foot sits directly below its own hip, so hip, knee and ankle start
    // out collinear and `valgus: 0` reads as exactly zero degrees. A real
    // runner has a standing baseline here — the femur angles inward from a
    // pelvis wider than the stance — and a fixture that reproduced it would
    // make every assertion below relative to a number nobody chose.
    const leftAnkleX = 0.5 - 0.042 * facing;
    const rightAnkleX = 0.5 + 0.042 * facing;
    frames.push({
      t,
      landmarks: poseAt(
        runningHipY(t, starts, contactS, stepPeriod),
        runningFootY(t, leftStarts, contactS),
        runningFootY(t, rightStarts, contactS),
        {
          shoulderHalf: 0.062 * facing,
          hipHalf: 0.042 * facing,
          leftFootX: leftAnkleX,
          rightFootX: rightAnkleX,
          leftToeDx: -0.001 * facing,
          rightToeDx: 0.001 * facing,
          // Toward the midline is +x for the left leg and -x for the right one,
          // before mirroring.
          leftKneeX: leftAnkleX + (leftDown ? valgus : 0) * facing,
          rightKneeX: rightAnkleX - (rightDown ? valgus : 0) * facing,
          // The hip opposite the stance foot is the one that drops.
          leftHipDy: rightDown ? pelvicDrop : 0,
          rightHipDy: leftDown ? pelvicDrop : 0,
        },
      ),
    });
  }
  return frames;
}

function inStance(t: number, starts: number[], contactS: number): boolean {
  return starts.some((start) => t >= start && t <= start + contactS);
}

export function analyzeSyntheticSideRun(gait: Partial<SideRunGait> = {}) {
  return analyzeLandings(syntheticSideRunFrames(gait), {
    statureM: 1.7,
    massKg: 70,
    width: 1280,
    height: 720,
  });
}

export function analyzeSyntheticFrontRun(gait: Partial<FrontRunGait> = {}) {
  return analyzeLandings(syntheticFrontRunFrames(gait), {
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
