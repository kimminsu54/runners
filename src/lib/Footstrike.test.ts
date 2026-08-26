import {
  MAX_PLAUSIBLE_ANGLE_DEG,
  classifyFootStrike,
  summarizeFootStrikes,
} from "./Footstrike";

const cases = [
  [Number.NaN, "unknown"],
  [Number.POSITIVE_INFINITY, "unknown"],
  [-16, "rearfoot"],
  [-8, "rearfoot"],
  [-7.9, "midfoot"],
  [0, "midfoot"],
  [7.9, "midfoot"],
  [8, "forefoot"],
  [16, "forefoot"],
  [MAX_PLAUSIBLE_ANGLE_DEG, "forefoot"],
  [-MAX_PLAUSIBLE_ANGLE_DEG, "rearfoot"],
  [MAX_PLAUSIBLE_ANGLE_DEG + 0.1, "unknown"],
  [-(MAX_PLAUSIBLE_ANGLE_DEG + 0.1), "unknown"],
  [55, "unknown"],
] as const;

if (cases.length !== 14) {
  throw new Error("expected 14 angle rows plus the frontal-view case");
}
for (const [angle, expected] of cases) {
  const actual = classifyFootStrike(angle).type;
  if (actual !== expected) {
    throw new Error(`strike ${angle}°: expected ${expected}, got ${actual}`);
  }
}
if (classifyFootStrike(0, "front").type !== "unknown") {
  throw new Error("frontal view must force unknown even at 0°");
}

const summary = summarizeFootStrikes([
  { type: "midfoot" },
  { type: "midfoot" },
  { type: "unknown" },
  { type: "forefoot" },
]);
if (summary.known !== 3) {
  throw new Error(`known denominator must ignore unknown, got ${summary.known}`);
}
if (summary.percents.midfoot + summary.percents.forefoot + summary.percents.rearfoot !== 100) {
  throw new Error("known-strike percents must sum to 100");
}

console.log("Footstrike.test ok — 15 boundary cases");
