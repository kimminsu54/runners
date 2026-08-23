export type Landmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export const LM = {
  nose: 0,
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
} as const;

export const SKELETON: Array<[number, number]> = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [24, 26],
  [26, 28],
  [28, 30],
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
