/**
 * Does the browser's pose lock onto the wrong person, and for how long?
 *
 * The stage 6 plan drops the person detector because MediaPipe already
 * localises the runner. That holds up on the pixels and the analysis — but
 * MediaPipe runs with `numPoses: 1`, so it returns one body and nothing says
 * which. With no detector there is nothing to arbitrate when it picks another.
 *
 * Sports2D writes one file per person it tracked, which makes an answer
 * possible: for each frame, whose body is the browser's box nearest to? If it
 * is the reference's own subject the whole way, the box is safe. If it drifts
 * to another for a stretch, that stretch is measuring someone else.
 *
 * Also reports box discontinuity, because that is the cheap guard one reaches
 * for first — and on clip 04 it accounts for only 9% of the large errors, so
 * it is reported to be dismissed rather than adopted.
 *
 *     npx tsx tools/sports2d/subject-switch.ts tools/sports2d/out/04
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { median } from "../../src/lib/signal";
import { parseTrc, trackedFrameCount, type TrcTable } from "../../src/lib/sports2d";

/** How far past the typical per-frame move counts as a discontinuity. */
const JUMP_FACTOR = 8;

type Centre = [number, number] | null;

function centreOf(points: Array<{ x: number; y: number } | null>): Centre {
  const seen = points.filter((p): p is { x: number; y: number } => !!p);
  if (!seen.length) return null;
  const xs = seen.map((p) => p.x);
  const ys = seen.map((p) => p.y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const target = process.argv[2];
if (!target) {
  console.log("사용법: npx tsx tools/sports2d/subject-switch.ts <run 디렉터리>");
  process.exit(1);
}

const dump = JSON.parse(readFileSync(join(target, "browser-frames.json"), "utf8")) as {
  clip: string;
  frames: Array<{ landmarks: Array<{ x: number; y: number }> | null }>;
};

// The pixel TRCs, one per person Sports2D tracked.
const poseDir = readdirSync(target).find((name) => name.endsWith("_Sports2D"));
if (!poseDir) {
  console.log(`${target}: Sports2D 출력이 없습니다`);
  process.exit(1);
}
const dir = join(target, poseDir);
const people = readdirSync(dir)
  .filter((name) => name.includes("_px_person") && name.endsWith(".trc"))
  .map((name) => ({
    name: name.replace(/.*_px_/, "").replace(".trc", ""),
    table: parseTrc(readFileSync(join(dir, name), "utf8")) as TrcTable,
  }))
  .filter((person) => trackedFrameCount(person.table) > 0);
people.sort((a, b) => trackedFrameCount(b.table) - trackedFrameCount(a.table));
const subject = people[0];

// The browser's own box centre per frame, in pixels. The frame size comes from
// the reference table's own extent rather than being assumed.
const allPoints = subject.table.frames.flatMap((frame) =>
  frame.points.filter((p): p is { x: number; y: number; z: number } => !!p),
);
const width = Math.max(...allPoints.map((p) => p.x)) > 720 ? 1280 : 720;
const height = width === 720 ? 1280 : 720;

const mine = new Map<number, [number, number]>();
dump.frames.forEach((frame, i) => {
  if (!frame.landmarks) return;
  const xs = frame.landmarks.map((p) => p.x * width);
  const ys = frame.landmarks.map((p) => p.y * height);
  mine.set(i, [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ]);
});

const moves: number[] = [];
for (const [i, here] of mine) {
  const before = mine.get(i - 1);
  if (before) moves.push(Math.hypot(here[0] - before[0], here[1] - before[1]));
}
const typical = median(moves);
const jumps = moves.filter((d) => d > typical * JUMP_FACTOR).length;

const tally = new Map<string, number>();
const runs: Array<[number, number, string]> = [];
let current: [number, number, string] | null = null;
for (const [i, here] of [...mine].sort((a, b) => a[0] - b[0])) {
  let best = "(없음)";
  let bestD = Infinity;
  for (const person of people) {
    const centre = centreOf(person.table.frames[i]?.points ?? []);
    if (!centre) continue;
    const d = Math.hypot(centre[0] - here[0], centre[1] - here[1]);
    if (d < bestD) {
      bestD = d;
      best = person.name;
    }
  }
  tally.set(best, (tally.get(best) ?? 0) + 1);
  if (current && current[2] === best) current[1] = i;
  else {
    if (current) runs.push(current);
    current = [i, i, best];
  }
}
if (current) runs.push(current);

const total = [...tally.values()].reduce((a, b) => a + b, 0);
const onSubject = tally.get(subject.name) ?? 0;
console.log(`\n=== ${dump.clip} ===`);
console.log(
  `Sports2D 가 추적한 사람 ${people.length}명 · 기준 피사체 ${subject.name}` +
    ` (${trackedFrameCount(subject.table)}프레임)`,
);
console.log(
  `브라우저 박스가 기준 피사체에 가장 가까운 프레임 ${onSubject}/${total}` +
    ` (${((onSubject / total) * 100).toFixed(0)}%)`,
);
for (const [name, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`   ${name.padEnd(10)} ${n}프레임${name === subject.name ? "  ← 기준" : ""}`);
}
const strays = runs.filter(([from, to, name]) => name !== subject.name && to - from >= 4);
if (strays.length) {
  console.log("다른 사람을 4프레임 이상 연속으로 본 구간");
  for (const [from, to, name] of strays.slice(0, 8)) {
    console.log(`   ${from}–${to} (${to - from + 1}프레임) → ${name}`);
  }
}
console.log(
  `박스 도약 ${jumps}/${moves.length} · 기준 이동 중앙 ${typical.toFixed(1)}px` +
    "  (도약은 큰 오차의 9%만 설명해 가드로 쓰기에 부족합니다)",
);
