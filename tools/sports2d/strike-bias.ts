/**
 * What 30 fps costs the foot-strike verdict, measured against a known answer.
 *
 * Ordinary phone video is 30 fps and that is the condition the product has to
 * work in, so the question is not "how much better would 240 fps be" but "is
 * 30 fps good enough, and if not, what fixes it without asking anyone to film
 * differently".
 *
 * Real footage cannot answer that, because on real footage the true strike
 * angle is unknown — which is why the plan used to call for 240 fps ground
 * truth. A synthetic runner answers it directly: the angle is put in, so it is
 * known, and the frame rate is ours to choose. Sampling the same motion at 240
 * fps and at 30 fps and comparing both to the number that went in separates
 * two things that look identical on real video: error from the estimator, and
 * error from the frame grid.
 *
 * The fixture reproduces the one detail that makes this hard. A foot does not
 * plant instantly — a rearfoot contact rotates to flat in roughly 40 ms — and
 * one frame at 30 fps is 33 ms, so the sample after touchdown has already lost
 * most of the angle it is supposed to measure.
 *
 *     npx tsx tools/sports2d/strike-bias.ts
 *
 * What it does not do is validate the analysis against a real runner. A
 * synthetic foot rotates exactly as told, has no landmark noise and never
 * occludes itself. It bounds the error the frame grid contributes, which is a
 * different and smaller claim than accuracy.
 */

import {
  analyzeLandings,
  footStrikeLabel,
  type StrikeAngleSampling,
} from "../../src/lib/landing-analysis";
import { syntheticSideRunFrames } from "../../src/lib/synthetic-jump";

const WIDTH = 1280;
const HEIGHT = 720;

/** Strikes worth asking about, in degrees at touchdown. */
const STRIKES = [
  { deg: -18, name: "리어풋 -18°" },
  { deg: -10, name: "리어풋 -10°" },
  { deg: 0, name: "미드풋 0°" },
  { deg: 12, name: "포어풋 +12°" },
];

const RATES = [240, 60, 30];
const SAMPLINGS: StrikeAngleSampling[] = ["around", "before", "before-wide", "peak"];

/**
 * The conditions worth asking under.
 *
 * A clean fixture flatters any estimator that takes an extreme over a
 * pre-contact window, because a fixture that holds one angle through flight
 * makes that window a constant. Both stressors below exist to take that
 * flattery away: the foot still settling into position, and a pose estimator
 * that does not place a keypoint in the same spot twice.
 */
const CONDITIONS = [
  { name: "깨끗함", swingDriftDeg: 0, jitterPx: 0 },
  { name: "비행 중 -6° 표류", swingDriftDeg: -6, jitterPx: 0 },
  { name: "랜드마크 ±3px", swingDriftDeg: 0, jitterPx: 3 },
  { name: "표류 + 잡음", swingDriftDeg: -6, jitterPx: 3 },
];

type Condition = (typeof CONDITIONS)[number];

function measure(
  strikeDeg: number,
  fps: number,
  sampling: StrikeAngleSampling,
  condition: Condition,
) {
  const frames = syntheticSideRunFrames({
    fps,
    strikeDeg,
    // 40 ms to flat, which is a rearfoot contact and the hardest case for a
    // 33 ms frame.
    flattenS: 0.04,
    ahead: 0.066,
    aspect: WIDTH / HEIGHT,
    swingDriftDeg: condition.swingDriftDeg,
    jitterPx: condition.jitterPx,
  });
  const result = analyzeLandings(frames, {
    statureM: 1.7,
    massKg: 70,
    width: WIDTH,
    height: HEIGHT,
    strikeAngleSampling: sampling,
  });
  const angles = result.landings
    .map((landing) => landing.footStrikeAngleDeg)
    .filter((angle) => Number.isFinite(angle));
  const mean = angles.length
    ? angles.reduce((sum, angle) => sum + angle, 0) / angles.length
    : Number.NaN;
  const counts = new Map<string, number>();
  for (const landing of result.landings) {
    counts.set(landing.footStrike, (counts.get(landing.footStrike) ?? 0) + 1);
  }
  return {
    landings: result.landings.length,
    measured: angles.length,
    mean,
    mix: [...counts.entries()]
      .map(([strike, n]) => `${footStrikeLabel[strike as keyof typeof footStrikeLabel]} ${n}`)
      .join(" · "),
  };
}

const show = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)}°` : "없음");

const clean = CONDITIONS[0];

function frameRateTable(): void {
  console.log("== 프레임 레이트가 각도에서 가져가는 것 (깨끗한 합성) ==\n");
  for (const strike of STRIKES) {
    console.log(`── ${strike.name} ─────────────────────────────`);
    for (const sampling of SAMPLINGS) {
      const line = RATES.map((fps) => {
        const got = measure(strike.deg, fps, sampling, clean);
        const error = got.mean - strike.deg;
        const shown = Number.isFinite(error)
          ? `${error > 0 ? "+" : ""}${error.toFixed(1)}`
          : "—";
        return `${String(fps).padStart(3)}fps ${show(got.mean).padStart(7)} (오차 ${shown.padStart(5)}°)`;
      });
      console.log(`  ${sampling.padEnd(6)} ${line.join("  ")}`);
    }
    for (const sampling of SAMPLINGS) {
      console.log(
        `  ${sampling.padEnd(6)} 판정  240fps: ${measure(strike.deg, 240, sampling, clean).mix || "없음"}` +
          `   30fps: ${measure(strike.deg, 30, sampling, clean).mix || "없음"}`,
      );
    }
    console.log();
  }
}

function stressTable(): void {
  console.log("== 30fps, 조건별 오차 — peak 가 잡음에 얼마나 노출되는지 ==\n");
  const header = SAMPLINGS.map((s) => s.padStart(12)).join("  ");
  for (const strike of STRIKES) {
    console.log(`── ${strike.name} ─────────────────────────────`);
    console.log(`  ${"조건".padEnd(16)} ${header}`);
    for (const condition of CONDITIONS) {
      const cells = SAMPLINGS.map((sampling) => {
        const got = measure(strike.deg, 30, sampling, condition);
        const error = got.mean - strike.deg;
        const shown = Number.isFinite(error)
          ? `${error > 0 ? "+" : ""}${error.toFixed(1)}°`
          : "없음";
        return shown.padStart(12);
      });
      console.log(`  ${condition.name.padEnd(16)} ${cells.join("  ")}`);
    }
    // The verdict under the hardest condition, which is the one that decides.
    const worst = CONDITIONS[CONDITIONS.length - 1];
    for (const sampling of SAMPLINGS) {
      console.log(
        `    ${sampling.padEnd(6)} ${worst.name} 판정: ${measure(strike.deg, 30, sampling, worst).mix || "없음"}`,
      );
    }
    console.log();
  }
}

function main(): number {
  console.log("합성 러너 · 접지 후 40ms 에 평평해짐 · 각도는 넣은 값이 참값\n");
  frameRateTable();
  stressTable();
  return 0;
}

process.exitCode = main();
