export type Landmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export const LM = {
  nose: 0,
  // 1-6 are the eyes with their inner and outer corners, 7-8 the ears, 9-10
  // the mouth. Only the ones the face box is built from are named here.
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const SKELETON: Array<[number, number]> = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];

export function mid(
  a: Landmark | undefined,
  b: Landmark | undefined,
): Landmark | null {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 };
}

export function distPx(
  a: Landmark,
  b: Landmark,
  width: number,
  height: number,
): number {
  const dx = (a.x - b.x) * width;
  const dy = (a.y - b.y) * height;
  return Math.hypot(dx, dy);
}

export function isVisible(lm: Landmark | undefined, min = 0.45): boolean {
  if (!lm) return false;
  if (lm.visibility === undefined) return true;
  return lm.visibility >= min;
}

function sub(a: Landmark, b: Landmark, width: number, height: number) {
  return { x: (a.x - b.x) * width, y: (a.y - b.y) * height };
}

export function kneeFlexionDeg(
  hip: Landmark | undefined,
  knee: Landmark | undefined,
  ankle: Landmark | undefined,
  width: number,
  height: number,
): number | null {
  if (!hip || !knee || !ankle) return null;
  const v1 = sub(hip, knee, width, height);
  const v2 = sub(ankle, knee, width, height);
  const n1 = Math.hypot(v1.x, v1.y);
  const n2 = Math.hypot(v2.x, v2.y);
  if (n1 < 1e-3 || n2 < 1e-3) return null;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)));
  const interior = (Math.acos(cos) * 180) / Math.PI;
  return 180 - interior;
}

/**
 * How wide the pelvis is in the image, in pixels. Signed: positive when the
 * runner's left hip appears further along +x than the right one.
 *
 * This is the gate on every frontal-plane measurement below. Seen from the
 * side the two hips sit almost on top of each other, so their horizontal
 * separation collapses to noise — and a valgus angle computed from noise is
 * not a small error but a random number. Requiring real width is what makes
 * these functions refuse to answer rather than answer wrongly.
 */
export function pelvisWidthPx(
  leftHip: Landmark | undefined,
  rightHip: Landmark | undefined,
  width: number,
): number {
  if (!isVisible(leftHip, 0.4) || !isVisible(rightHip, 0.4)) return Number.NaN;
  return (leftHip!.x - rightHip!.x) * width;
}

/**
 * Frontal-plane knee alignment for one leg, in degrees, positive when the knee
 * falls inward — the medial collapse a frontal clip is worth shooting for.
 *
 * The magnitude is the deviation of thigh and shank from a straight line as the
 * image projects them, which is the 2D frontal projection angle a single camera
 * can actually support. The sign is the part worth explaining: "inward" is
 * taken from the pelvis, using the direction from this leg's hip toward the
 * other one, and nothing else. Deriving it from where the foot sits instead
 * would invert on a crossover step, where the foot lands past the body's
 * midline and every offset changes sign; deriving it from which way the runner
 * faces would need to know front from back, which a single view cannot tell.
 * The pelvis axis is right either way, because it is the body's own left-right.
 */
export function frontalKneeValgusDeg(
  side: "left" | "right",
  leftHip: Landmark | undefined,
  rightHip: Landmark | undefined,
  knee: Landmark | undefined,
  ankle: Landmark | undefined,
  width: number,
  height: number,
  minPelvisPx: number,
): number {
  const pelvisPx = pelvisWidthPx(leftHip, rightHip, width);
  if (!Number.isFinite(pelvisPx) || Math.abs(pelvisPx) < minPelvisPx) {
    return Number.NaN;
  }
  if (!isVisible(knee, 0.4) || !isVisible(ankle, 0.4)) return Number.NaN;

  const hip = side === "left" ? leftHip! : rightHip!;
  // Toward the other hip, in image x.
  const medialDir = side === "left" ? -Math.sign(pelvisPx) : Math.sign(pelvisPx);

  const thigh = sub(hip, knee!, width, height);
  const shank = sub(ankle!, knee!, width, height);
  const thighLen = Math.hypot(thigh.x, thigh.y);
  const shankLen = Math.hypot(shank.x, shank.y);
  if (thighLen < 4 || shankLen < 4) return Number.NaN;
  const cos = Math.min(
    1,
    Math.max(-1, (thigh.x * shank.x + thigh.y * shank.y) / (thighLen * shankLen)),
  );
  const deviation = 180 - (Math.acos(cos) * 180) / Math.PI;

  // Which side of the hip–ankle line the knee sits on, measured at the knee's
  // own height so a bent leg is not mistaken for a displaced one.
  const legDy = (ankle!.y - hip.y) * height;
  if (Math.abs(legDy) < 4) return Number.NaN;
  const along = ((knee!.y - hip.y) * height) / legDy;
  const lineX = hip.x * width + along * (ankle!.x - hip.x) * width;
  const offset = knee!.x * width - lineX;

  return deviation * Math.sign(offset * medialDir);
}

/**
 * Pelvis tilt in the frontal plane, in degrees, positive when the runner's left
 * hip is the lower of the two. Callers turn this into contralateral drop once
 * they know which foot is on the ground.
 */
export function pelvicTiltLeftLowerDeg(
  leftHip: Landmark | undefined,
  rightHip: Landmark | undefined,
  width: number,
  height: number,
  minPelvisPx: number,
): number {
  const pelvisPx = pelvisWidthPx(leftHip, rightHip, width);
  if (!Number.isFinite(pelvisPx) || Math.abs(pelvisPx) < minPelvisPx) {
    return Number.NaN;
  }
  const dy = (leftHip!.y - rightHip!.y) * height;
  const magnitude = (Math.atan2(Math.abs(dy), Math.abs(pelvisPx)) * 180) / Math.PI;
  // Image y grows downward, so the lower hip is the one with the larger y.
  return dy > 0 ? magnitude : -magnitude;
}
