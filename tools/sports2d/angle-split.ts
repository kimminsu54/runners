/**
 * Splitting the two pipelines' angle disagreement into its causes.
 *
 * The adjudication sheet turned up something the strike counts had hidden. On
 * the fourteen contacts where the two pipelines named different strikes they
 * report inclinations a median of 23° apart — wider than the whole 16° midfoot
 * category on eleven of them — and which of them claims the larger angle flips
 * contact by contact. That is not two estimators arguing about where a
 * boundary sits.
 *
 * Three places such a gap can come from, and they call for different work:
 *
 * **The anchor.** The two detectors put touchdown on different frames, and the
 * angle moves 15–29° per frame there. Read the same foot two frames apart and
 * a large gap needs no disagreement about the pose at all. If this dominates,
 * the angle calculation is fine and contact detection is the whole problem.
 *
 * **The pose.** MediaPipe and RTMPose put the heel and toe in different
 * places, or the axis through them means something different in each. Then the
 * two disagree even on a frame they both look at, and better contact detection
 * would not close it.
 *
 * **The side.** If one pipeline calls a foot left where the other calls it
 * right, then comparing left against left compares two different feet, and the
 * gap is not a measurement error at all but a bookkeeping one. This is worth
 * ruling out first because it is cheap to test and it would invalidate every
 * paired comparison in the project rather than only this one.
 *
 * Separating them needs the same quantity evaluated several ways, which is
 * what this does. Both pipelines' per-frame angle series are on disk, so each
 * can be read at its own anchor and at the other's:
 *
 *   - as published — the two angles the app actually reports, differenced
 *   - anchor doubt — how far each pipeline's own angle moves for one frame of
 *     doubt about when the foot landed, which is already computed per landing
 *   - pose only    — both pipelines' per-frame angles at the same instant
 *   - crossed      — pose only, but against the other pipeline's other foot
 *
 * The published figure has to come from the landing and not from the series:
 * the reported angle is read through a sampling window that does not sit on
 * the contact frame, so reading the series at contact gives a number the app
 * never shows. A first version of this did exactly that and reported an 8°
 * disagreement where the recorded runs differ by 24°.
 *
 * Reported for every paired contact and again for the subset where the two
 * named different strikes, because that subset is what the sheet sampled and
 * what the 23° figure describes. A median over all pairs answers a different
 * question and would understate it.
 *
 *     npx tsx tools/sports2d/angle-split.ts tools/sports2d/out/06
 *
 * Needs browser-frames.json from dump-browser.py beside the Sports2D output.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeLandings,
  type AnalysisResult,
  type FootSide,
  type PoseFrame,
} from "../../src/lib/landing-analysis";
import { median } from "../../src/lib/signal";
import { pairLandings } from "./../../src/lib/pipeline-compare";
import { loadRun } from "./load";

type Dump = { clip: string; frames: PoseFrame[] };

type Split = {
  tContact: number;
  side: FootSide;
  published: number;
  anchor: number;
  pose: number;
  crossed: number;
  anchorFrames: number;
  sameStrike: boolean;
};

/**
 * How much better the crossed fit has to be before it counts as a swap.
 *
 * The margin belongs between the two hypotheses, not on the feet. A first
 * version asked whether the runner's two feet were far enough apart to tell
 * them apart, which sounds right and filtered nothing: on the sprint clip the
 * feet differ by well over this at contact, yet the same-side gap is 10° and
 * the crossed gap 12°, so both assignments fit and neither is excluded. Judged
 * by the feet the test looked decisive and reported 14 swaps out of 28; judged
 * by the margin it correctly reports that it cannot say.
 *
 * Set at the width of the midfoot category, the smallest difference this
 * project treats as meaning anything about a foot.
 */
const SWAP_MARGIN_DEG = 16;

const show = (value: number, unit = "°") =>
  Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : "없음";

/** The series index nearest a time, matching how the other tools anchor. */
function indexOf(result: AnalysisResult, t: number): number {
  let at = 0;
  for (let i = 1; i < result.series.length; i++) {
    if (Math.abs(result.series[i].t - t) < Math.abs(result.series[at].t - t)) at = i;
  }
  return at;
}

function angleAt(result: AnalysisResult, index: number, side: FootSide): number {
  const point = result.series[index];
  if (!point || side === "unknown") return Number.NaN;
  return side === "left" ? point.leftFootStrikeAngle : point.rightFootStrikeAngle;
}

const other = (side: FootSide): FootSide =>
  side === "left" ? "right" : side === "right" ? "left" : "unknown";

/** Median of the finite entries, or NaN if there are none. */
function med(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length ? median(finite) : Number.NaN;
}

/**
 * The per-frame angle gap around one contact.
 *
 * Taken over the contact frame and one either side rather than at a single
 * frame, so a one-frame difference in where the two series happen to be
 * sampled cannot masquerade as a pose disagreement. Matched on time, so this
 * is the two estimators looking at the same instants.
 */
function poseGapNear(
  browser: AnalysisResult,
  reference: AnalysisResult,
  t: number,
  side: FootSide,
): number {
  const iB = indexOf(browser, t);
  const gaps: number[] = [];
  for (const offset of [-1, 0, 1]) {
    const at = iB + offset;
    const point = browser.series[at];
    if (!point) continue;
    const there = indexOf(reference, point.t);
    if (Math.abs(reference.series[there].t - point.t) > 1 / 60) continue;
    gaps.push(Math.abs(angleAt(reference, there, side) - angleAt(browser, at, side)));
  }
  return med(gaps);
}

/**
 * The pose-only gap over the whole clip.
 *
 * Reported for completeness but it is not the operative number, and it is
 * worth saying why: most frames of a running clip are swing, where the foot is
 * at extreme orientations, often blurred and sometimes occluded, and where
 * nobody reads a strike angle. A large figure here is compatible with the two
 * pipelines agreeing perfectly at every contact.
 */
function poseGapOverClip(
  browser: AnalysisResult,
  reference: AnalysisResult,
): { gaps: number[]; frames: number } {
  const gaps: number[] = [];
  let frames = 0;
  for (let i = 0; i < browser.series.length; i++) {
    const at = indexOf(reference, browser.series[i].t);
    // Only frames the two actually share. A browser frame with no Sports2D
    // frame within half a frame time is not a matched instant.
    if (Math.abs(reference.series[at].t - browser.series[i].t) > 1 / 60) continue;
    frames += 1;
    for (const side of ["left", "right"] as const) {
      const a = angleAt(browser, i, side);
      const b = angleAt(reference, at, side);
      if (Number.isFinite(a) && Number.isFinite(b)) gaps.push(Math.abs(b - a));
    }
  }
  return { gaps, frames };
}

function summarise(label: string, rows: Split[]): void {
  if (!rows.length) {
    console.log(`  ${label}: 없음`);
    return;
  }
  const published = med(rows.map((r) => r.published));
  const anchor = med(rows.map((r) => r.anchor));
  const pose = med(rows.map((r) => r.pose));
  const crossed = med(rows.map((r) => r.crossed));
  // Which cause is larger on each contact, counted rather than inferred from
  // the medians — medians of two components do not add up to the median of
  // the total, so a share would be arithmetic that does not hold.
  const poseWins = rows.filter((r) => r.pose > r.anchor).length;
  // Three outcomes, not two. A swap is only claimed where the crossed fit is
  // better by more than the margin; where the two fits are within the margin
  // of each other the honest answer is that the test cannot say.
  const swapped = rows.filter((r) => r.crossed < r.pose - SWAP_MARGIN_DEG).length;
  const clean = rows.filter((r) => r.crossed > r.pose + SWAP_MARGIN_DEG).length;
  const unclear = rows.length - swapped - clean;
  console.log(
    `  ${label} (${rows.length}개)` +
      `  발표 ${show(published).padStart(7)}` +
      ` · 한 프레임 흔들림 ${show(anchor).padStart(7)}` +
      ` · 자세만 ${show(pose).padStart(7)}` +
      ` · 좌우 교차 ${show(crossed).padStart(7)}`,
  );
  console.log(
    `    자세 차이가 프레임 흔들림보다 큰 착지 ${poseWins}/${rows.length}` +
      ` · 앵커 차이 중앙 ${med(rows.map((r) => r.anchorFrames)).toFixed(0)}프레임` +
      ` · 좌우 뒤바뀜 의심 ${swapped} · 정상 ${clean} · 판별 불가 ${unclear}`,
  );
}

function report(target: string): void {
  const run = loadRun(target);
  let dump: Dump;
  try {
    dump = JSON.parse(readFileSync(join(target, "browser-frames.json"), "utf8")) as Dump;
  } catch {
    console.log(`${target}: browser-frames.json 없음 — dump-browser.py 를 먼저 돌리세요`);
    return;
  }

  const base = { statureM: 1.7, massKg: 70, width: run.width, height: run.height };
  const browser = analyzeLandings(dump.frames, base);
  const reference = analyzeLandings(run.frames, { ...base, preFiltered: true });
  const { paired } = pairLandings(browser.landings, reference.landings);

  const rows: Split[] = [];
  for (const pair of paired) {
    // The channel, not the published side. The app stopped claiming a side
    // from a lateral view after the alternation measurement, so reading `side`
    // here skips every contact and the tool reports nothing at all. The
    // channel is what the angle was read from, which is what this compares.
    const side: FootSide =
      pair.browser.footChannel !== "unknown"
        ? pair.browser.footChannel
        : pair.sports2d.footChannel;
    if (side === "unknown") continue;
    const iB = indexOf(browser, pair.browser.tContact);
    const jB = indexOf(browser, pair.sports2d.tContact);
    rows.push({
      tContact: pair.browser.tContact,
      side,
      sameStrike: pair.sameStrike,
      // Exactly the two numbers the app puts on screen.
      published: Math.abs(
        pair.sports2d.footStrikeAngleDeg - pair.browser.footStrikeAngleDeg,
      ),
      // The larger of the two pipelines' own one-frame sensitivities. Each is
      // measured from that pipeline's angle trajectory, so this is the anchor
      // term in the project's own terms rather than a fresh definition.
      anchor: Math.max(
        pair.browser.footStrikeAngleUncertaintyDeg,
        pair.sports2d.footStrikeAngleUncertaintyDeg,
      ),
      pose: poseGapNear(browser, reference, pair.browser.tContact, side),
      crossed: poseGapNear(browser, reference, pair.browser.tContact, other(side)),
      anchorFrames: Math.abs(jB - iB),
    });
  }

  const clip = poseGapOverClip(browser, reference);
  console.log(`\n=== ${dump.clip} ===`);
  summarise("짝지어진 착지 전체", rows);
  summarise("주법이 갈린 착지", rows.filter((r) => !r.sameStrike));
  summarise("주법이 같은 착지", rows.filter((r) => r.sameStrike));
  console.log(
    `  클립 전체 매칭 프레임 ${clip.frames}장, 각도 표본 ${clip.gaps.length}개` +
      `  중앙 ${show(med(clip.gaps))}  (대부분 스윙 구간이라 판정과 무관)`,
  );

  console.log("\n  착지별");
  for (const row of rows) {
    const mark = row.sameStrike ? " " : "*";
    console.log(
      `  ${mark} ${row.tContact.toFixed(3)}s ${row.side.padEnd(6)}` +
        ` 발표 ${show(row.published).padStart(7)}` +
        ` · 흔들림 ${show(row.anchor).padStart(7)}` +
        ` · 자세만 ${show(row.pose).padStart(7)}` +
        ` · 교차 ${show(row.crossed).padStart(7)}` +
        (row.crossed < row.pose - SWAP_MARGIN_DEG
          ? " 좌우 의심"
          : row.crossed > row.pose + SWAP_MARGIN_DEG
            ? ""
            : " 교차판별불가") +
        ` · 앵커 ${row.anchorFrames}프레임`,
    );
  }
  console.log("  * 는 두 파이프라인이 주법을 다르게 본 착지");
}

const target = process.argv[2];
if (!target) {
  console.log("사용법: npx tsx tools/sports2d/angle-split.ts <run 디렉터리>");
  process.exit(1);
}
report(target);
