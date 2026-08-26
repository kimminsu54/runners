import { classifyFootStrike } from "./Footstrike";

const cases = [
  [Number.NaN, "unknown"],
  [-16, "rearfoot"],
  [-8, "rearfoot"],
  [-7.9, "midfoot"],
  [0, "midfoot"],
  [7.9, "midfoot"],
  [8, "forefoot"],
  [16, "forefoot"],
  [55, "unknown"],
] as const;

for (const [angle, expected] of cases) {
  const actual = classifyFootStrike(angle).type;
  if (actual !== expected) {
    throw new Error(`strike ${angle}°: expected ${expected}, got ${actual}`);
  }
}

console.log(
  "Footstrike.test ok",
  cases.map(([angle, expected]) => `${angle}→${expected}`),
);
