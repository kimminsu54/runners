/**
 * Which pipeline gets the foot's side wrong, judged without knowing the truth.
 *
 * The angle decomposition turned up side misassignment as a side finding: on
 * six of the twenty-one contacts where the test could decide, one pipeline's
 * left matched the other's right better than its left did. That was measured
 * by comparing the two against each other, which says they disagree but not
 * which one is wrong.
 *
 * Alternation settles it without a reference. A runner's contacts alternate
 * feet — that is not a modelling assumption but what it means to run — so two
 * consecutive contacts labelled the same foot are an error in the sequence,
 * and each pipeline can be scored on its own without either being taken as
 * correct.
 *
 * The catch is that a run of two same-side labels has two possible causes and
 * they are not the same defect. Either a label is wrong, or a contact between
 * them was missed, in which case the labels are right and the sequence is
 * merely short. Timing separates them cleanly: a mislabel leaves the pair one
 * step period apart, a missed contact leaves them two. So both are reported,
 * and a pipeline with many of the second kind has a detection problem rather
 * than a labelling one.
 *
 * Scored on `footChannel`, not on the side the app publishes. Since this
 * measurement the app no longer claims a side from a lateral view, so a
 * version of this reading `side` reports zero violations on every clip — which
 * would read as "fixed" when nothing was fixed. The channel is what the pose
 * estimator believed, the confusion is still there, and this is the view that
 * shows it.
 *
 *     npx tsx tools/sports2d/foot-side.ts tools/sports2d/out/06
 *
 * Needs browser-frames.json from dump-browser.py beside the Sports2D output.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeLandings,
  type FootSide,
  type Landing,
  type PoseFrame,
} from "../../src/lib/landing-analysis";
import { median } from "../../src/lib/signal";
import { loadRun } from "./load";

type Dump = { clip: string; frames: PoseFrame[] };

/**
 * How far past one step period a same-side pair has to sit before it is read
 * as a missed contact rather than a mislabel.
 *
 * Halfway between one period and two. A pair at 1.0 periods is a mislabel and
 * a pair at 2.0 is a gap, so the cut sits where a reading is equally wrong in
 * either direction.
 */
const MISS_CUT = 1.5;

type Verdict = {
  contacts: number;
  unknown: number;
  mislabels: Array<{ t: number; side: FootSide; periods: number }>;
  missed: Array<{ t: number; side: FootSide; periods: number }>;
};

function judge(landings: Landing[]): Verdict {
  const known = landings.filter((landing) => landing.footChannel !== "unknown");
  // The step period from the contacts themselves rather than from cadence, so
  // a clip whose cadence estimate is off does not move the cut.
  const gaps = known
    .slice(1)
    .map((landing, i) => landing.tContact - known[i].tContact)
    .filter((gap) => gap > 0);
  const period = median(gaps);
  const verdict: Verdict = {
    contacts: landings.length,
    unknown: landings.length - known.length,
    mislabels: [],
    missed: [],
  };
  if (!Number.isFinite(period) || period <= 0) return verdict;

  for (let i = 1; i < known.length; i++) {
    if (known[i].footChannel !== known[i - 1].footChannel) continue;
    const periods = (known[i].tContact - known[i - 1].tContact) / period;
    const entry = { t: known[i].tContact, side: known[i].footChannel, periods };
    (periods >= MISS_CUT ? verdict.missed : verdict.mislabels).push(entry);
  }
  return verdict;
}

function show(name: string, verdict: Verdict, landings: Landing[]): void {
  const known = verdict.contacts - verdict.unknown;
  // The left/right split. Alternation makes an even split the expectation, so
  // a lean says the heuristic prefers one foot rather than merely being noisy
  // — and a preference has a cause worth finding.
  const left = landings.filter((landing) => landing.footChannel === "left").length;
  const right = landings.filter((landing) => landing.footChannel === "right").length;
  console.log(
    `  ${name.padEnd(10)} 착지 ${String(verdict.contacts).padStart(3)}` +
      ` · 채널 미정 ${String(verdict.unknown).padStart(2)}` +
      ` · 교대 위반 ${String(verdict.mislabels.length + verdict.missed.length).padStart(2)}` +
      ` (오라벨 의심 ${verdict.mislabels.length} · 접지 누락 의심 ${verdict.missed.length})` +
      ` — 판정 가능한 연속쌍 ${Math.max(0, known - 1)}개 중`,
  );
  console.log(`             좌 ${left} · 우 ${right}`);
  for (const entry of verdict.mislabels) {
    console.log(
      `      오라벨 ${entry.t.toFixed(3)}s ${entry.side} (앞 착지와 ${entry.periods.toFixed(2)}보폭)`,
    );
  }
}

const target = process.argv[2];
if (!target) {
  console.log("사용법: npx tsx tools/sports2d/foot-side.ts <run 디렉터리>");
  process.exit(1);
}

const run = loadRun(target);
let dump: Dump;
try {
  dump = JSON.parse(readFileSync(join(target, "browser-frames.json"), "utf8")) as Dump;
} catch {
  console.log(`${target}: browser-frames.json 없음 — dump-browser.py 를 먼저 돌리세요`);
  process.exit(1);
}

const base = { statureM: 1.7, massKg: 70, width: run.width, height: run.height };
const browser = analyzeLandings(dump.frames, base);
const reference = analyzeLandings(run.frames, { ...base, preFiltered: true });

console.log(`\n=== ${dump.clip} ===`);
show("브라우저", judge(browser.landings), browser.landings);
show("Sports2D", judge(reference.landings), reference.landings);
console.log(
  "  교대는 달리기의 정의이므로, 위반 수는 두 파이프라인을 서로 기준으로 삼지 않고" +
    " 각각 채점한 값입니다.",
);
