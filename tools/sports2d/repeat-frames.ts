/**
 * Repeated samples in the pose stream: where they come from, and what they do.
 *
 * Two clips in this sample turned out to repeat, for two unrelated reasons,
 * and the first version of this tool had both of them backwards.
 *
 * One clip is 24 fps wearing a 30 fps label — every fifth frame repeats the
 * one before it, 19% of the file. Those repeats are not byte-identical, which
 * I first claimed they were: they differ by a mean of 0.016 to 0.6 per pixel,
 * the signature of a repeated frame re-encoded rather than copied. The
 * conclusion survives the correction because the separation is not close — the
 * other clip's *smallest* genuine frame-to-frame difference is 14.9, three
 * orders of magnitude larger, and the repeats sit at a spacing of exactly five
 * in 43 of 45 cases.
 *
 * Being near-identical rather than identical is why almost none of them reach
 * the pose stream: the landmarker runs in IMAGE mode, so near-identical pixels
 * give a near-identical pose, not the same one. One pose frame in 360 repeats
 * on that clip. So a converted clip cannot be detected downstream of pose
 * estimation, and a real sampling-rate check needs the frames themselves.
 *
 * The other clip repeats nothing at all on disk and yet has 40 identical pose
 * frames out of 360, which is the app's own doing. It samples `n` times evenly
 * across the duration at a rate derived from a frame budget, with no reference
 * to the video's frame rate, so seeks drift across frame boundaries and land
 * twice inside the same decoded frame. In IMAGE mode the same frame gives
 * exactly the same pose.
 *
 * That second one matters beyond the wasted inference. A repeated sample is a
 * pair where the clock advanced and the foot did not, which is a perfect
 * zero-velocity reading — and contact detection is looking for the frame where
 * the foot stops moving. Having just found that anchor choice is what the two
 * pipelines' angle disagreement reduces to, an artificial source of stationary
 * samples is worth testing rather than assuming harmless. This reports whether
 * the detected contacts sit on them more often than chance.
 *
 *     npx tsx tools/sports2d/repeat-frames.ts tools/sports2d/out/05/browser-frames.json
 */

import { readFileSync } from "node:fs";

import { analyzeLandings, type PoseFrame } from "../../src/lib/landing-analysis";
import { median } from "../../src/lib/signal";

const path = process.argv[2];
if (!path) {
  console.log("사용법: npx tsx tools/sports2d/repeat-frames.ts <browser-frames.json>");
  process.exit(1);
}
const dump = JSON.parse(readFileSync(path, "utf8")) as {
  clip: string;
  frames: PoseFrame[];
};

/** Frames whose landmarks are identical to the frame before them. */
const repeats = new Set<number>();
for (let i = 1; i < dump.frames.length; i++) {
  const a = dump.frames[i - 1].landmarks;
  const b = dump.frames[i].landmarks;
  if (!a || !b || a.length !== b.length) continue;
  let same = true;
  for (let k = 0; k < a.length && same; k++) {
    if (a[k].x !== b[k].x || a[k].y !== b[k].y) same = false;
  }
  if (same) repeats.add(i);
}

const tracked = dump.frames.filter((frame) => frame.landmarks).length;
console.log(`${dump.clip}: 프레임 ${dump.frames.length}, 자세 있는 프레임 ${tracked}`);
console.log(`  앞 프레임과 자세가 완전히 동일: ${repeats.size}`);

const result = analyzeLandings(dump.frames, {
  statureM: 1.7,
  massKg: 70,
  width: 720,
  height: 1280,
});

const near: number[] = [];
const away: number[] = [];
for (const landing of result.landings) {
  let at = 0;
  for (let i = 1; i < result.series.length; i++) {
    if (
      Math.abs(result.series[i].t - landing.tContact) <
      Math.abs(result.series[at].t - landing.tContact)
    ) {
      at = i;
    }
  }
  const doubt = landing.footStrikeAngleUncertaintyDeg;
  if (!Number.isFinite(doubt)) continue;
  const touching = repeats.has(at) || repeats.has(at + 1) || repeats.has(at - 1);
  (touching ? near : away).push(doubt);
}

const show = (values: number[]) =>
  values.length ? `${median(values).toFixed(1)}° (n=${values.length})` : "없음";
console.log(`  중복 자세에 붙은 착지의 불확실성: ${show(near)}`);
console.log(`  그렇지 않은 착지:                 ${show(away)}`);

// Whether contact detection is drawn to the repeated samples.
//
// A repeat is a pair of frames with zero foot movement between them, and the
// detector is looking for the foot to stop. Chance is the share of frames that
// are repeats, or three times that for landing within one frame of one.
if (repeats.size) {
  const total = dump.frames.length;
  const contactFrames = result.landings.map((landing) => {
    let at = 0;
    for (let i = 1; i < result.series.length; i++) {
      if (
        Math.abs(result.series[i].t - landing.tContact) <
        Math.abs(result.series[at].t - landing.tContact)
      ) {
        at = i;
      }
    }
    return at;
  });
  const on = contactFrames.filter((at) => repeats.has(at)).length;
  const within = contactFrames.filter((at) =>
    [-1, 0, 1].some((offset) => repeats.has(at + offset)),
  ).length;
  const rate = repeats.size / total;
  const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
  console.log(
    `  접지가 중복 자세 위: ${on}/${contactFrames.length}` +
      ` (${pct(on / contactFrames.length)})  우연이면 ${pct(rate)}`,
  );
  console.log(
    `  한 프레임 안: ${within}/${contactFrames.length}` +
      ` (${pct(within / contactFrames.length)})  우연이면 ${pct(Math.min(1, rate * 3))}`,
  );
}

if (!near.length) {
  console.log("  → 중복이 불확실성 수치를 속이지는 않습니다.");
}
