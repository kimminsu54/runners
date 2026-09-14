import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FOREFOOT_MIN_ANGLE_DEG,
  MAX_PLAUSIBLE_ANGLE_DEG,
  REARFOOT_MAX_ANGLE_DEG,
} from "./Footstrike";
import {
  buildZip,
  DOWNLOAD_FILES,
  normalizeText,
  readZipEntries,
  sameBytes,
  ZIP_NAME,
} from "./downloads-bundle";
import {
  isPublishable,
  THRESHOLDS,
  threshold,
  validationLabel,
  validationMeaning,
  type ThresholdKey,
} from "./thresholds";
import { emitThresholdsModule, VALIDATION_STATUSES } from "./thresholds-source";
import { emitShoesJson } from "./shoes-source";
import { recommendShoes as rankShoes } from "./Shoeranking";
import {
  analyzeLandings,
  splitRatio,
  analyzeLandingsAuto,
  type PoseFrame,
  formatStrikeAngleWithDoubt,
  strikeAngleSettles,
  strikeAngleSpan,
  type FootStrike,
  type StrikeAngleSampling,
  cadenceSpm,
  classifyFootStrike,
  clampedPeakGrfBw,
  formatFootAhead,
  formatFootAheadRatio,
  formatKneeFlexDeg,
  formatKneeValgusDeg,
  formatPelvicDropDeg,
  kneeValgusVerdict,
  formatLoadingRateBwS,
  formatStrikeAngleDeg,
  formatTimingMs,
  landingLoadScore,
  overstrideVerdict,
  overstrideVerdictOrWithheld,
  peakForceFromDuty,
  pelvicDropVerdict,
  quantizeMs,
} from "./landing-analysis";
import { buildSessionSummary, paceLabel, type SessionSummary } from "./session-summary";
import {
  buildSnapshot,
  compareSnapshots,
  comparisonHeadline,
  parseBundle,
  toBundle,
} from "./session-snapshot";
import {
  PRIORITY_BRANDS,
  isPreferredBrand,
  listShoes,
  recommendShoes,
  scoreShoe,
  shoeImageSrc,
  shoeSlug,
  type MatchedShoeRecommendation,
  type Shoe,
  type ShoeRecommendation,
} from "./shoes";
import {
  analyzeSyntheticFrontRun,
  analyzeSyntheticRun,
  analyzeSyntheticSideRun,
  syntheticFrontRunFrames,
  syntheticSideRunFrames,
  assertDetectsLanding,
  assertDetectsRunningSteps,
  syntheticRunningFrames,
} from "./synthetic-jump";
import { liveMomentAt } from "./live-readout";
import {
  detectVerticalAxis,
  halpe26ToPoseFrames,
  MARKER_TO_MEDIAPIPE,
  SMALL_TOE_MARKERS,
  markerKey,
  parseTrc,
  trackedFrameCount,
} from "./sports2d";
import {
  analysisTimeFromVideo,
  videoTimeFromAnalysis,
} from "./live-readout";
import { importTrc, isImportCandidate } from "./trc-import";
import {
  comparePipelines,
  pairLandings,
  strikeCounts,
  type PipelinePass,
} from "./pipeline-compare";
import {
  blurPlan,
  FACE_COVER_LABEL,
  fallbackFaceBox,
  faceBoxFrom,
  faceBoxNear,
  mosaicPlan,
} from "./face-blur";
import { buildHudFrame, HUD_NOTE } from "./hud-frame";
import { exportPlan } from "./export-frame";
import { LM, pickSubject, type Landmark } from "./pose";
import { buildLandingGuidance } from "./training-guidance";

const hit = assertDetectsLanding();
console.log("landing ok", {
  t: hit.tContact.toFixed(3),
  bw: hit.peakGrfBw.toFixed(2),
  v: hit.impactVelocity.toFixed(2),
  score: hit.damageScore,
});

const steps = assertDetectsRunningSteps();
console.log(
  "running contacts ok",
  steps.map((step) => step.tContact.toFixed(2)),
);

const guidance = buildLandingGuidance({
  ...hit,
  peakGrfBw: 3.2,
  loadingRateBwS: 30,
  absorptionMs: 75,
  kneeFlexContact: 10,
  kneeFlexPeak: 18,
});
if (guidance.patterns.length < 2 || guidance.training.length < 3) {
  throw new Error("expected high-impact guidance and training suggestions");
}
if (!guidance.patterns.some((pattern) => pattern.area.includes("정강이"))) {
  throw new Error("expected lower-leg load guidance");
}
console.log(
  "guidance ok",
  guidance.patterns.map((pattern) => pattern.area),
);

const session = buildSessionSummary(analyzeSyntheticRun());
if (!session.headline || session.paragraphs.length < 3) {
  throw new Error("expected a multi-sentence session summary");
}
if (session.metrics.length < 4) {
  throw new Error("expected aggregated session metrics");
}
console.log("session summary ok", session.headline);

for (const [angle, expected] of [
  [Number.NaN, "unknown"],
  [-16, "rearfoot"],
  [-8, "rearfoot"],
  [-7.9, "midfoot"],
  [0, "midfoot"],
  [7.9, "midfoot"],
  [8, "forefoot"],
  [16, "forefoot"],
  [55, "unknown"],
] as const) {
  const actual = classifyFootStrike(angle).type;
  if (actual !== expected) {
    throw new Error(`strike ${angle}°: expected ${expected}, got ${actual}`);
  }
}
if (session.dominantStrike !== "midfoot") {
  throw new Error(`level synthetic feet should be midfoot, got ${session.dominantStrike}`);
}
console.log("foot-strike classification ok", session.strikeCounts);

const frontalFrames = syntheticRunningFrames().map((frame) => {
  if (!frame.landmarks) return frame;
  const landmarks = frame.landmarks.map((point) => ({ ...point }));
  landmarks[11].x = 0.38;
  landmarks[12].x = 0.62;
  landmarks[23].x = 0.44;
  landmarks[24].x = 0.56;
  return { ...frame, landmarks };
});
const frontal = analyzeLandings(frontalFrames, {
  statureM: 1.7,
  massKg: 70,
  width: 1280,
  height: 720,
});
const frontalSummary = buildSessionSummary(frontal);
if (frontalSummary.dominantStrike !== "unknown") {
  throw new Error("frontal footage must not receive a foot-strike label");
}
console.log("frontal strike gate ok", frontal.quality.sideViewRatio.toFixed(2));

// A clip framed on the legs, which is what breaks the metre scale: the pose
// estimator still returns a nose, placed above the top edge, and every metre
// in the analysis is the nose-to-heel distance times a constant. Moving the
// head out of shot is therefore the whole fixture.
const legsOnlyFrames = syntheticRunningFrames().map((frame) => {
  if (!frame.landmarks) return frame;
  const landmarks = frame.landmarks.map((point) => ({ ...point }));
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    landmarks[index] = { ...landmarks[index], y: -0.2 };
  }
  return { ...frame, landmarks };
});
const legsOnly = analyzeLandings(legsOnlyFrames, {
  statureM: 1.7,
  massKg: 70,
  width: 720,
  height: 1280,
});
if (legsOnly.landings.some((landing) => landing.scaleMeasured)) {
  throw new Error("a scale built on an out-of-frame nose must not read as measured");
}
if (!legsOnly.warnings.some((warning) => warning.includes("배율"))) {
  throw new Error("an unverified scale must say so");
}
// The distances stay: the reader is better served by a number with a caveat
// than by a blank, and the caveat is the warning above.
if (!legsOnly.landings.some((landing) => Number.isFinite(landing.impactVelocity))) {
  throw new Error("an unverified scale must still report the speed it measured");
}
// What stops is the verdict, for two separate reasons, and both are checked
// because either alone would hide a hole in the other.
const descent = (landing: (typeof legsOnly.landings)[number]) =>
  buildLandingGuidance(landing).patterns.some((pattern) =>
    pattern.title.includes("하강"),
  );
if (descent({ ...legsOnly.landings[0], impactVelocity: 4, equivalentDropCm: 80 })) {
  throw new Error("a fast-descent verdict must not rest on an unverified scale");
}
if (
  descent({
    ...legsOnly.landings[0],
    scaleMeasured: true,
    impactVelocity: 4,
    equivalentDropCm: 80,
  })
) {
  throw new Error("a withheld boundary must not produce a verdict");
}
// A tripwire, not a preference. The boundary is withheld because nothing has
// shown that the speed measured here is the quantity 1.8 m/s was set for —
// 138 landings put the median at 0.33 m/s. Whoever lifts that status will
// fail here, which is the moment to re-check the scale gate above, since with
// the boundary withheld it is the assertion before this one that carries it.
if (isPublishable("guidance_fast_descent_m_s")) {
  throw new Error(
    "guidance_fast_descent_m_s is publishable now: re-check that the scale gate still holds before deleting this",
  );
}
const whole = analyzeLandings(syntheticRunningFrames(), {
  statureM: 1.7,
  massKg: 70,
  width: 720,
  height: 1280,
});
if (!whole.landings.every((landing) => landing.scaleMeasured)) {
  throw new Error("a clip with the whole runner in shot must measure its scale");
}
console.log("scale gate ok", {
  legsOnly: `${legsOnly.landings.length}회 · 배율 미확인 · 속도 ${legsOnly.landings[0]?.impactVelocity.toFixed(2)} m/s 는 표시`,
  whole: `${whole.landings.length}회 · 배율 확인`,
});

const SLOW_GAIT = { contactS: 0.31, flightS: 0.05 };
const FAST_GAIT = { contactS: 0.13, flightS: 0.14 };
const slow = buildSessionSummary(analyzeSyntheticRun(SLOW_GAIT));
const fast = buildSessionSummary(analyzeSyntheticRun(FAST_GAIT));

// Contact time drives the force estimate, so hold it to the known truth of the
// fixture rather than only checking that the two paces come out different.
for (const [name, summary, truthS] of [
  ["slow", slow, SLOW_GAIT.contactS],
  ["fast", fast, FAST_GAIT.contactS],
] as const) {
  const errorMs = summary.meanContactMs - truthS * 1000;
  if (!Number.isFinite(errorMs) || Math.abs(errorMs) > 40) {
    throw new Error(
      `${name} contact time off by ${Math.round(errorMs)} ms (measured ${Math.round(summary.meanContactMs)}, truth ${truthS * 1000})`,
    );
  }
}
for (const [name, s] of [
  ["slow", slow],
  ["fast", fast],
] as const) {
  console.log(`${name} pace`, {
    pace: paceLabel[s.pace],
    contactMs: Math.round(s.meanContactMs),
    flightMs: Math.round(s.meanFlightMs),
    duty: s.meanDutyFactor.toFixed(2),
    bw: s.meanPeakGrfBw.toFixed(2),
    headline: s.headline,
  });
}
// Peak force rises with pace, but far less steeply than duty factor does, so
// duty is the discriminator and force is only expected to be modestly higher.
if (!(fast.meanPeakGrfBw > slow.meanPeakGrfBw * 1.15)) {
  throw new Error(
    `fast pace should load harder: slow ${slow.meanPeakGrfBw} vs fast ${fast.meanPeakGrfBw}`,
  );
}
if (!(fast.meanDutyFactor < slow.meanDutyFactor - 0.08)) {
  throw new Error(
    `duty factor should separate the paces: slow ${slow.meanDutyFactor} vs fast ${fast.meanDutyFactor}`,
  );
}
if (slow.pace === fast.pace) {
  throw new Error(`both clips classified as ${slow.pace}`);
}
if (slow.headline === fast.headline) {
  throw new Error("slow and fast summaries should not read the same");
}
if (slow.meanPeakGrfBw > 2.2) {
  throw new Error(`slow jogging should stay near 2 BW, got ${slow.meanPeakGrfBw}`);
}
if (fast.meanPeakGrfBw > 3.4) {
  throw new Error(`fast running should stay under sprint loads, got ${fast.meanPeakGrfBw}`);
}
console.log("pace discrimination ok");

// Slow-motion footage stretches every duration, so the analyzer has to undo it
// before contact and flight times mean anything.
const realTime = analyzeSyntheticRun({ contactS: 0.18, flightS: 0.14 });
const slowFrames = syntheticRunningFrames({ contactS: 0.18, flightS: 0.14 }).map(
  (frame) => ({ ...frame, t: frame.t * 4 }),
);
const auto = analyzeLandingsAuto(slowFrames, {
  statureM: 1.7,
  massKg: 70,
  width: 1280,
  height: 720,
});
const realSummary = buildSessionSummary(realTime);
const autoSummary = buildSessionSummary(auto.result);
console.log("slow-motion auto", {
  factor: auto.slowMotionFactor,
  realBw: realSummary.meanPeakGrfBw.toFixed(2),
  recoveredBw: autoSummary.meanPeakGrfBw.toFixed(2),
  realContact: Math.round(realSummary.meanContactMs),
  recoveredContact: Math.round(autoSummary.meanContactMs),
});
if (auto.slowMotionFactor !== 4) {
  throw new Error(`expected 4x slow motion, detected ${auto.slowMotionFactor}`);
}
if (Math.abs(autoSummary.meanContactMs - realSummary.meanContactMs) > 25) {
  throw new Error("slow-motion correction should recover real contact time");
}
if (autoSummary.pace !== realSummary.pace) {
  throw new Error(
    `pace should survive slow motion: ${realSummary.pace} vs ${autoSummary.pace}`,
  );
}
console.log("slow-motion recovery ok");

// Picking a capture rate that the footage does not have must be called out
// rather than silently reported, because it warps every timing in the clip.
const wrongFactor = analyzeLandingsAuto(slowFrames, {
  statureM: 1.7,
  massKg: 70,
  width: 1280,
  height: 720,
  slowMotionFactor: 1,
});
if (wrongFactor.suggestedFactor !== 4) {
  throw new Error(
    `expected a suggestion of 4x, got ${wrongFactor.suggestedFactor ?? "none"}`,
  );
}
const rightFactor = analyzeLandingsAuto(slowFrames, {
  statureM: 1.7,
  massKg: 70,
  width: 1280,
  height: 720,
  slowMotionFactor: 4,
});
if (rightFactor.suggestedFactor !== undefined) {
  throw new Error("a correct capture rate should not be second-guessed");
}
if (rightFactor.result.quality.level === "poor") {
  throw new Error("a correct capture rate must keep a usable quality grade");
}
if (wrongFactor.result.quality.level !== "poor") {
  throw new Error(
    `wrong capture rate must be poor, got ${wrongFactor.result.quality.level}`,
  );
}
if (
  wrongFactor.result.landings.some(
    (landing) =>
      landing.gaitBased ||
      Number.isFinite(landing.contactMs) ||
      Number.isFinite(landing.flightMs) ||
      landing.footStrike !== "unknown",
  )
) {
  throw new Error("wrong capture rate must not publish gait timing or a strike");
}
const wrongSummary = buildSessionSummary(wrongFactor.result);
if (
  Number.isFinite(wrongSummary.meanPeakGrfBw) ||
  Number.isFinite(wrongSummary.meanContactMs) ||
  Number.isFinite(wrongSummary.meanDutyFactor)
) {
  throw new Error("wrong capture rate session averages must stay empty");
}
console.log("slow-motion mismatch warning ok", {
  quality: wrongFactor.result.quality.level,
  reasons: wrongFactor.result.quality.reasons.slice(-1),
});

// Duty extremes must not invent a 10 BW sprint or a sub-bodyweight walk.
for (const duty of [0, -1, Number.NaN]) {
  if (Number.isFinite(peakForceFromDuty(duty))) {
    throw new Error(`duty ${duty} should not produce a force`);
  }
  if (Number.isFinite(clampedPeakGrfBw(duty))) {
    throw new Error(`duty ${duty} should stay empty after the clamp`);
  }
}
const sprintDuty = 0.05;
if (!(peakForceFromDuty(sprintDuty) > 4.5)) {
  throw new Error("a tiny duty must exceed the published cap before clamping");
}
if (clampedPeakGrfBw(sprintDuty) !== 4.5) {
  throw new Error(`tiny duty should clamp to 4.5 BW, got ${clampedPeakGrfBw(sprintDuty)}`);
}
const walkDuty = 0.85;
if (!(peakForceFromDuty(walkDuty) < 1.05)) {
  throw new Error("walking duty must undershoot 1.05 BW so the publish clamp lifts it");
}
if (clampedPeakGrfBw(walkDuty) !== 1.05) {
  throw new Error(`walking duty should clamp up to 1.05 BW, got ${clampedPeakGrfBw(walkDuty)}`);
}
const extremeSprint = analyzeSyntheticRun({ contactS: 0.08, flightS: 0.28 });
if (
  extremeSprint.landings.some(
    (landing) => landing.gaitBased && (landing.peakGrfBw < 1.05 || landing.peakGrfBw > 4.5),
  )
) {
  throw new Error("gait-based peaks must stay inside the 1.05–4.5 BW clamp");
}
console.log("duty-factor clamp ok", {
  sprint: clampedPeakGrfBw(sprintDuty),
  walk: clampedPeakGrfBw(walkDuty),
});

const tinyRunner = analyzeLandings(
  syntheticRunningFrames().map((frame) => {
    if (!frame.landmarks) return frame;
    return {
      ...frame,
      landmarks: frame.landmarks.map((point) => ({
        ...point,
        x: 0.5 + (point.x - 0.5) * 0.2,
        y: 0.5 + (point.y - 0.5) * 0.2,
      })),
    };
  }),
  { statureM: 1.7, massKg: 70, width: 1280, height: 720 },
);
if (tinyRunner.quality.level !== "poor") {
  throw new Error(
    `a subject under 20% of the frame must be poor, got ${tinyRunner.quality.level}`,
  );
}
if (
  tinyRunner.landings.some(
    (landing) =>
      landing.gaitBased ||
      landing.footStrike !== "unknown" ||
      Number.isFinite(landing.contactMs) ||
      Number.isFinite(landing.flightMs) ||
      Number.isFinite(landing.dutyFactor),
  )
) {
  throw new Error("poor footage must not publish gait timing or a strike label");
}
const poorSummary = buildSessionSummary(tinyRunner);
if (
  Number.isFinite(poorSummary.meanPeakGrfBw) ||
  Number.isFinite(poorSummary.meanContactMs) ||
  Number.isFinite(poorSummary.meanDutyFactor)
) {
  throw new Error("poor session averages must stay empty");
}
if (
  poorSummary.strikeCounts.length ||
  poorSummary.riskCounts.length ||
  poorSummary.patterns.length ||
  poorSummary.dominantStrike !== "unknown"
) {
  throw new Error("poor sessions must not emit strike, risk, or load-pattern lists");
}
for (const label of ["착지 충격", "평균 점수", "접지 / 체공"] as const) {
  const metric = poorSummary.metrics.find((row) => row.label === label);
  if (metric?.value !== "측정 불가") {
    throw new Error(`${label} should read 측정 불가 when quality is poor`);
  }
}
if (recommendShoes(poorSummary).kind !== "general") {
  throw new Error("poor footage must not invent a shoe list");
}
console.log("poor-quality blank output ok", poorSummary.headline);

const catalog = listShoes();
if (catalog.length !== 105) {
  throw new Error(`expected 105 shoes, got ${catalog.length}`);
}
if (!catalog.some((shoe) => shoe.brand === "Nike" && shoe.model === "Pegasus 40")) {
  throw new Error("catalog is missing a known daily trainer");
}
// Every priority brand needs a non-racing shoe in each strike pool, or an easy
// pace has nothing to recommend but a racing flat. Nike's midfoot pool was
// exactly that gap: three shoes, two of them elite racers.
for (const brand of PRIORITY_BRANDS) {
  for (const target of ["rearfoot", "midfoot", "forefoot"] as const) {
    const daily = catalog.filter(
      (shoe) =>
        shoe.brand === brand &&
        (shoe.recommendedStrikes ?? []).some((s) => s === target || s === "any") &&
        (shoe.weightG ?? 0) > 215,
    );
    if (!daily.length) {
      throw new Error(`${brand} has no non-racing shoe for ${target}`);
    }
  }
}

function stubSummary(
  override: Partial<SessionSummary>,
): Pick<
  SessionSummary,
  | "dominantStrike"
  | "dominantStrikeSettled"
  | "strikeCounts"
  | "pace"
  | "meanPeakGrfBw"
  | "patterns"
> {
  return {
    dominantStrike: "midfoot",
    // Settled by default, so the existing cases keep asking what they
    // asked; the unsettled case is a test of its own.
    dominantStrikeSettled: true,
    strikeCounts: [],
    pace: "steady",
    meanPeakGrfBw: 2.3,
    patterns: [],
    ...override,
  };
}

if (recommendShoes(stubSummary({ dominantStrike: "unknown" })).kind !== "general") {
  throw new Error("unknown strike must not invent a shoe list");
}

function matchedRec(rec: ShoeRecommendation): MatchedShoeRecommendation {
  if (rec.kind !== "matched") {
    throw new Error("expected a matched shoe list");
  }
  return rec;
}

const rearRec = matchedRec(
  recommendShoes(stubSummary({ dominantStrike: "rearfoot", pace: "easy" })),
);
if (rearRec.picks.length !== 3) {
  throw new Error("rearfoot should receive three shoes");
}
if (
  rearRec.picks.some(
    (pick) =>
      pick.shoe.recommendedStrike === "midfoot" &&
      (pick.shoe.heelDropMm ?? 99) <= 3,
  )
) {
  throw new Error("rearfoot must not get a near-zero-drop midfoot shoe");
}
if (
  !rearRec.picks.some(
    (pick) =>
      pick.shoe.recommendedStrike === "rearfoot" ||
      pick.shoe.recommendedStrike === "any",
  )
) {
  throw new Error("rearfoot list drifted away from heel-strike shoes");
}

const midRec = matchedRec(recommendShoes(stubSummary({ dominantStrike: "midfoot" })));
if (!midRec.picks.length) throw new Error("midfoot should receive shoes");
if (
  midRec.picks.some(
    (pick) =>
      !pick.shoe.recommendedStrikes.some(
        (strike) => strike === "midfoot" || strike === "any",
      ),
  )
) {
  throw new Error("midfoot list included a dedicated rearfoot shoe");
}

const foreRec = matchedRec(
  recommendShoes(stubSummary({ dominantStrike: "forefoot", pace: "fast" })),
);
if (!foreRec.picks.length) throw new Error("forefoot should receive shoes");
if (
  foreRec.picks.some(
    (pick) =>
      pick.shoe.recommendedStrike === "rearfoot" &&
      (pick.shoe.heelDropMm ?? 0) >= 8,
  )
) {
  throw new Error("forefoot received a high-drop rearfoot shoe");
}
if (
  !foreRec.picks.some(
    (pick) =>
      pick.shoe.recommendedStrike === "midfoot" ||
      (pick.shoe.heelDropMm != null && pick.shoe.heelDropMm <= 6.5),
  )
) {
  throw new Error("forefoot should lean on low-drop midfoot geometry");
}

const mixedRec = matchedRec(recommendShoes(stubSummary({ dominantStrike: "mixed" })));

// A majority one frame of doubt would overturn must not pick shoes for it.
//
// Averaging does not save this. The anchor error is common mode, so every
// contact shifts the same way and the counts move together: on one reference
// clip a single frame turned forefoot 21 · midfoot 12 into rearfoot 23 ·
// midfoot 10. Recommending a forefoot structure there would be recommending it
// to someone the same footage calls a heel striker on the other reading.
{
  const settled = matchedRec(
    recommendShoes(stubSummary({ dominantStrike: "forefoot", dominantStrikeSettled: true })),
  );
  const unsettled = matchedRec(
    recommendShoes(stubSummary({ dominantStrike: "forefoot", dominantStrikeSettled: false })),
  );
  if (settled.targetStrike !== "forefoot") {
    throw new Error(`a settled forefoot session targeted ${settled.targetStrike}`);
  }
  if (unsettled.targetStrike !== "mixed") {
    throw new Error(
      `an unsettled forefoot session still targeted ${unsettled.targetStrike}`,
    );
  }
  // And it has to say why, rather than looking like a genuinely mixed runner.
  if (!unsettled.headline.includes("한 프레임")) {
    throw new Error(`the reason is not given: ${unsettled.headline}`);
  }
  if (mixedRec.headline === unsettled.headline) {
    throw new Error("an unsettled session reads as a mixed runner");
  }
  console.log("shoe strike doubt ok", {
    settled: settled.targetStrike,
    unsettled: unsettled.targetStrike,
    reason: unsettled.headline.slice(0, 24),
  });
}
if (mixedRec.picks[0]?.shoe.recommendedStrike !== "any") {
  throw new Error("mixed strike should lead with a shoe that accepts any landing");
}

for (const [name, rec] of [
  ["rearfoot", rearRec],
  ["midfoot", midRec],
  ["forefoot", foreRec],
  ["mixed", mixedRec],
] as const) {
  if (rec.picks.length !== 3) {
    throw new Error(`${name} should lead with three preferred-brand shoes`);
  }
  if (rec.secondaryPicks.length !== 3) {
    throw new Error(`${name} should follow with three other-brand shoes`);
  }
  if (rec.picks.some((pick) => !isPreferredBrand(pick.shoe.brand))) {
    throw new Error(`${name} primary list must stay Nike, Asics, or Adidas`);
  }
  if (rec.secondaryPicks.some((pick) => isPreferredBrand(pick.shoe.brand))) {
    throw new Error(`${name} secondary list leaked a preferred brand`);
  }
  const primaryBrands = new Set(rec.picks.map((pick) => pick.shoe.brand));
  const otherBrands = new Set(rec.secondaryPicks.map((pick) => pick.shoe.brand));
  if (primaryBrands.size !== rec.picks.length) {
    throw new Error(`${name} primary list stacked the same brand`);
  }
  if (otherBrands.size !== rec.secondaryPicks.length) {
    throw new Error(`${name} secondary list stacked the same brand`);
  }
  const brandOrder = rec.picks.map((pick) => pick.shoe.brand);
  if (brandOrder.join() !== PRIORITY_BRANDS.join()) {
    throw new Error(
      `${name} primary order must stay ${PRIORITY_BRANDS.join(" → ")}, got ${brandOrder.join(" → ")}`,
    );
  }
}

const syntheticRec = matchedRec(recommendShoes(session));
if (syntheticRec.targetStrike !== "midfoot") {
  throw new Error("level synthetic gait should recommend for midfoot");
}
console.log(
  "shoe recommendations ok",
  {
    primary: syntheticRec.picks.map((pick) => `${pick.shoe.brand} ${pick.shoe.model}`),
    secondary: syntheticRec.secondaryPicks.map(
      (pick) => `${pick.shoe.brand} ${pick.shoe.model}`,
    ),
  },
);

const slugs = new Set(catalog.map((shoe) => shoeSlug(shoe)));
if (slugs.size !== catalog.length) {
  throw new Error("shoe slugs must be unique");
}
const photoGaps = (
  ["rearfoot", "midfoot", "forefoot", "mixed"] as const
).flatMap((dominantStrike) =>
  (["easy", "steady", "brisk", "fast"] as const).flatMap((pace) =>
    [false, true].flatMap((preferStability) =>
      (
        (() => {
          const rec = recommendShoes({
            dominantStrike,
            dominantStrikeSettled: true,
            strikeCounts: [],
            pace,
            meanPeakGrfBw: preferStability ? 3.1 : 2.2,
            patterns: preferStability
              ? [
                  {
                    area: "하체 전반",
                    title: "부하",
                    evidence: "반복",
                    meaning: "",
                    level: "attention",
                  },
                ]
              : [],
          });
          return rec.kind === "matched"
            ? [...rec.picks, ...rec.secondaryPicks]
            : [];
        })()
      // Every recommendable shoe has a photo again, so this is back to an
      // unconditional check — no allowlist to slip a new gap through.
      ).filter((pick) => !shoeImageSrc(pick.shoe)),
    ),
  ),
);
if (photoGaps.length) {
  throw new Error(
    `recommended shoes missing photos: ${photoGaps
      .map((pick) => `${pick.shoe.brand} ${pick.shoe.model}`)
      .join(", ")}`,
  );
}
const sameLoadFast = landingLoadScore({
  peakGrfBw: 2.4,
  loadingRateBwS: 22,
  dutyFactor: 0.2,
  kneeFlexContact: 28,
});
const sameLoadEasy = landingLoadScore({
  peakGrfBw: 2.4,
  loadingRateBwS: 22,
  dutyFactor: 0.38,
  kneeFlexContact: 28,
});
if (sameLoadFast !== sameLoadEasy) {
  throw new Error(
    `duty alone must not change the load score: ${sameLoadFast} vs ${sameLoadEasy}`,
  );
}
// The flip side of the rule above: these two DO move the score, so the landing
// card has to show them. Two cards with the same visible numbers scoring
// differently is the bug this guards.
const baseLoad = { peakGrfBw: 2.0, loadingRateBwS: 20, dutyFactor: 0.39, kneeFlexContact: 40 };
const scoreShift = [
  ["loadingRateBwS", { ...baseLoad, loadingRateBwS: 60 }],
  ["kneeFlexContact", { ...baseLoad, kneeFlexContact: 12 }],
] as const;
for (const [field, input] of scoreShift) {
  if (landingLoadScore(input) === landingLoadScore(baseLoad)) {
    throw new Error(`${field} must move the load score, so the card must show it`);
  }
}
if (
  formatLoadingRateBwS(19.4) !== "19 BW/s" ||
  formatKneeFlexDeg(41.2) !== "약 41°" ||
  formatLoadingRateBwS(Number.NaN) !== "측정 불가"
) {
  throw new Error("card metric formatting changed");
}
// The printed degree must never fall in a band other than its own label's.
for (const angle of [-41, -40, -12, -8.4, -8, -7.6, -0.2, 0, 4, 7.6, 8, 12, 40, 41]) {
  const strike = classifyFootStrike(angle).type;
  const shown = formatStrikeAngleDeg(angle, strike);
  if (strike === "unknown") {
    if (shown !== "측정 불가") {
      throw new Error(`unknown strike must not print a degree: ${angle} → ${shown}`);
    }
    continue;
  }
  const printed = Number(shown.replace(/[^0-9+.-]/g, ""));
  if (classifyFootStrike(printed).type !== strike) {
    throw new Error(
      `printed angle contradicts its label: ${angle}° is ${strike} but prints ${shown}`,
    );
  }
}
// A pattern-only trigger must not claim the impact was large.
const stabilityShoe = listShoes().find((shoe) => shoe.category === "안정화");
if (!stabilityShoe) throw new Error("catalog has no 안정화 shoe to test copy with");
const stabilityCopy = (stability: "impact" | "pattern") =>
  scoreShoe(stabilityShoe, "rearfoot", "steady", stability)?.reasons.join(" ") ?? "";
if (stabilityCopy("pattern").includes("반력이 큰")) {
  throw new Error("pattern-triggered stability must not claim a large impact");
}
if (!stabilityCopy("impact").includes("반력이 큰")) {
  throw new Error("impact-triggered stability lost its reason");
}

// --- purpose column ---------------------------------------------------------
// Purpose used to be inferred from weight alone, and Zoom Fly 6 is where that
// broke: a 251 g super trainer sat in the 240-320 g daily band and collected
// the easy-pace bonus meant for shoes built for easy running. The catalog now
// carries purpose in its own column, so these checks are about the column
// winning over the band it sits in.
const superTrainers = catalog.filter((shoe) => shoe.superTrainer);
if (!superTrainers.length) {
  throw new Error("the catalog lost its Super_Trainer column");
}
const zoomFly = catalog.find((shoe) => shoe.model === "Zoom Fly 6");
if (!zoomFly?.superTrainer) {
  throw new Error("Zoom Fly 6 must carry the super-trainer mark");
}
const easyPick = scoreShoe(zoomFly, "midfoot", "easy", "none");
const fastPick = scoreShoe(zoomFly, "midfoot", "fast", "none");
if (!easyPick || !fastPick) {
  throw new Error("Zoom Fly 6 should score for a midfoot landing at either pace");
}
if (easyPick.reasons.some((reason) => reason.includes("데일리 중량"))) {
  throw new Error("a super trainer must not be described as an easy-pace daily trainer");
}
if (!(fastPick.score > easyPick.score)) {
  throw new Error(
    `a super trainer should rate higher for fast work: easy ${easyPick.score}, fast ${fastPick.score}`,
  );
}
// The column speaks for the easy end only. Fast-pace scoring still runs on
// weight, so marking a light shoe must not cost it the fast bonus it earns at
// 240 g or under.
const lightSuperTrainer = catalog.find(
  (shoe) => shoe.superTrainer && (shoe.weightG ?? 999) <= 240,
);
if (!lightSuperTrainer) {
  throw new Error("expected a sub-240 g super trainer to test the fast-pace path");
}
const lightFast = scoreShoe(lightSuperTrainer, "midfoot", "fast", "none");
if (!lightFast?.reasons.some((reason) => reason.includes("빠른 페이스에 부담이 적음"))) {
  throw new Error("the mark must not swallow the fast-pace weight bonus");
}
// And it must never help at the easy end: a light super trainer keeps the
// under-240 g penalty and takes the purpose penalty on top of it.
const lightEasy = scoreShoe(lightSuperTrainer, "midfoot", "easy", "none");
const lightUnmarked = scoreShoe(
  { ...lightSuperTrainer, superTrainer: false },
  "midfoot",
  "easy",
  "none",
);
if (!lightEasy || !lightUnmarked || lightEasy.score !== lightUnmarked.score - 6) {
  throw new Error(
    `marking a shoe must only cost it at an easy pace: ${lightEasy?.score} vs ${lightUnmarked?.score}`,
  );
}
// Same shoe, same weight, no mark: it still collects the daily bonus. The two
// must not tie, or the column changed nothing.
const unmarkedTwin: Shoe = { ...zoomFly, superTrainer: false };
const twinPick = scoreShoe(unmarkedTwin, "midfoot", "easy", "none");
if (!twinPick || !(twinPick.score > easyPick.score)) {
  throw new Error(
    `an easy run should prefer the daily trainer: unmarked ${twinPick?.score}, super trainer ${easyPick.score}`,
  );
}
console.log("shoe purpose column ok", {
  marked: superTrainers.length,
  zoomFly: { easy: easyPick.score, fast: fastPick.score, unmarkedEasy: twinPick.score },
});

// --- the subject is carried forward, not taken first ------------------------
// The estimator returns bodies without identities. Asked for one it returns
// one and says nothing about which, and on a clip with a second runner in shot
// a fifth of the frames were the wrong person — foot keypoints a median of
// 234px from the intended subject's, against 9px elsewhere.
{
  // A body is only ever read for its extent here, so two points suffice and
  // the fixture stays legible.
  const body = (x: number, top: number, bottom: number) => [
    { x, y: top },
    { x, y: bottom },
  ];
  const runner = body(0.5, 0.2, 0.9);
  const bystander = body(0.1, 0.1, 0.95);

  if (pickSubject([], null) !== null) {
    throw new Error("no bodies must give no subject");
  }
  if (pickSubject([runner], null) !== runner) {
    throw new Error("one body must be the subject");
  }
  // With nothing before it, the tallest — the same idea the quality gate uses
  // when it asks the subject to fill a quarter of the frame.
  if (pickSubject([runner, bystander], null) !== bystander) {
    throw new Error("with no history the tallest body should be taken");
  }
  // With a subject already established, continuity beats height: the taller
  // bystander must not steal it.
  if (pickSubject([runner, bystander], runner) !== runner) {
    throw new Error("a taller body must not take over from the tracked subject");
  }
  if (pickSubject([bystander, runner], runner) !== runner) {
    throw new Error("the subject must be found whatever order it arrives in");
  }
  // And the failure this exists to stop: the interloper arrives first in the
  // list, every frame, and the subject is still the one measured.
  let held: ReturnType<typeof pickSubject> = null;
  const chosen: number[] = [];
  for (let frame = 0; frame < 8; frame++) {
    // The runner drifts across the frame; the bystander stands still.
    const moving = body(0.5 + frame * 0.02, 0.2, 0.9);
    held = pickSubject([bystander, moving], held ?? moving);
    chosen.push(held === bystander ? 1 : 0);
  }
  if (chosen.some((wrong) => wrong === 1)) {
    throw new Error(`the subject was lost on ${chosen.filter(Boolean).length} of 8 frames`);
  }
  console.log("subject continuity ok", {
    first: "가장 큰 사람",
    then: "앞 프레임과 이어지는 사람",
    drift: `8프레임 유지 ${chosen.filter((w) => w === 0).length}/8`,
  });
}

// --- the force fallback is not a force -------------------------------------
// A landing with no matched stance reads the body's own acceleration instead of
// duty factor, and that fallback does not measure force. Against synthetic runs
// of known duty it returns 2.25 to 2.35 BW whatever the truth is: -19% at
// 2.92 BW, -23% at 3.07, -28% at 3.24, -38% at 3.61, -46% at 4.15. It is
// saturated rather than biased by a factor, so no calibration rescues it, and
// mixing it into the mean made the published force depend on how many stances
// were matched rather than on how the person ran.
{
  const FEET: number[] = [
    LM.leftHeel, LM.leftAnkle, LM.leftFootIndex,
    LM.rightHeel, LM.rightAnkle, LM.rightFootIndex,
  ];
  const average = (values: number[]) => {
    const finite = values.filter(Number.isFinite);
    return finite.length
      ? finite.reduce((a, b) => a + b, 0) / finite.length
      : Number.NaN;
  };
  const opts = { statureM: 1.7, massKg: 70, width: 1280, height: 720 };
  const readings: number[] = [];
  for (const [contactS, flightS] of [
    [0.14, 0.19],
    [0.16, 0.17],
    [0.11, 0.24],
  ] as const) {
    // Parking both feet clear of the ground removes every stance interval
    // without touching the body's motion, which is what the fallback reads.
    const parked = syntheticRunningFrames({ contactS, flightS }).map((frame) => ({
      ...frame,
      landmarks: frame.landmarks
        ? frame.landmarks.map((point, index) =>
            FEET.includes(index) ? { ...point, y: 0.55 } : point,
          )
        : null,
    }));
    const result = analyzeLandings(parked, opts);
    const fallback = result.landings.filter((landing) => !landing.gaitBased);
    if (!fallback.length) {
      throw new Error(
        `parking the feet no longer exercises the fallback at ${contactS}/${flightS}`,
      );
    }
    readings.push(average(fallback.map((landing) => landing.peakGrfBw)));
    // The published mean must not contain it.
    const summary = buildSessionSummary(result);
    if (Number.isFinite(summary.meanPeakGrfBw)) {
      throw new Error(
        `a session with no measured stance published ${summary.meanPeakGrfBw} BW`,
      );
    }
  }
  // Saturation: the true force nearly doubles across these three and the
  // fallback barely moves. If it ever starts tracking, this can be revisited.
  const spread = Math.max(...readings) - Math.min(...readings);
  if (spread > 0.4) {
    throw new Error(
      `the fallback now tracks the force (spread ${spread.toFixed(2)} BW) — re-measure it`,
    );
  }

  // And a landing without a measured stance says so on the still, where it
  // used to print a force beside a withheld contact time.
  const run = analyzeSyntheticSideRun({ ahead: 0.066 });
  const unmeasured = run.landings.find((landing) => !landing.gaitBased);
  const withStance = run.landings.find((landing) => landing.gaitBased);
  if (unmeasured && withStance) {
    const row = (landing: typeof unmeasured, label: string) =>
      buildHudFrame(run, landing, 2).rows.find((r) => r.label === label)?.value ?? "";
    if (row(unmeasured, "추정 최대 반력") !== "측정 불가") {
      throw new Error(
        `an unmeasured stance published a force: ${row(unmeasured, "추정 최대 반력")}`,
      );
    }
    if (row(withStance, "추정 최대 반력") === "측정 불가") {
      throw new Error("a measured stance lost its force");
    }
  }
  console.log("force fallback ok", {
    readings: readings.map((value) => value.toFixed(2)).join(" / "),
    spread: spread.toFixed(2),
    published: "측정된 스탠스만",
  });
}

// --- why there is no split-stance gate --------------------------------------
// A gate on this was built and then removed, and the numbers that removed it
// are kept here so it cannot come back without meeting them.
//
// The idea: a foot lands once per stride, so dividing the ground intervals a
// foot produced by the intervals cadence allows should sit near one, and well
// above one should mean single stances are being split — which would shorten
// the stance and inflate the force, since force comes off duty factor.
//
// It held on two clips and fell apart on six. Measured on the browser path:
//
//   clip  ratio   force vs reference   stance vs reference
//   05    1.07     -4%                 252 against 251 ms
//   01    1.19    +15%                 267 against 219 ms
//   06    1.44    +54%                 170 against 313 ms
//   04    1.45    +19%                 306 against 277 ms
//
// Clip 04 is the refutation. It has the highest ratio of all and its stance is
// *longer* than the reference's, not shortened — so a high interval count does
// not imply a split stance. The ratio counts intervals; the published stance
// comes from the landings matched to them, and the two need not agree. Firing
// on 04 withheld a number that was closer to right than several the gate let
// through, and clip 01 at 1.19 sat one hundredth from the same fate.
//
// The wider finding is that the force is high on five of six clips, from +15%
// to +57%, which is a systematic bias rather than something a per-clip gate
// can catch. That is recorded in docs and left as a decision.
{
  const clip04 = splitRatio([19, 29], 178, 12);
  const clip05 = splitRatio([19, 19], 198, 12);
  if (!(clip04 > clip05)) {
    throw new Error("the clip that refuted the gate must score above the clean one");
  }
  // Nothing in the analysis may act on this. `splitRatio` stays exported
  // because it is worth measuring, not because it is worth gating on.
  const clean = analyzeSyntheticRun({ contactS: 0.18, flightS: 0.14 });
  if ("stanceTrusted" in clean.quality) {
    throw new Error(
      "a stance-trust flag is back on AnalysisQuality — see the numbers above",
    );
  }
  console.log("split-stance gate stays out", {
    refuted: `clip04 ${clip04.toFixed(2)} > clip05 ${clip05.toFixed(2)}`,
    reason: "높은 비율이 짧은 접지를 뜻하지 않음",
  });
}

// --- per-side breakdown -----------------------------------------------------
// Only from the front. Seen from the side the legs pass over each other and
// the pose estimator loses which is which — scored on alternation, its labels
// broke on 12 of 30 consecutive pairs on one real clip — so the app does not
// claim a side there and the per-side table has nothing to stand on.
if (realSummary.sides) {
  throw new Error("a side-on run must not produce per-side stats");
}
{
  const frontal = buildSessionSummary(
    // Landscape, because the frontal fixture's normalised coordinates only
    // read as frontal at a landscape aspect: the pelvis-width ratio that
    // decides the view is computed against the frame, so a portrait frame
    // makes the same pose look side-on (0.105 against 0.330).
    analyzeLandings(syntheticFrontRunFrames({ fps: 60 }), {
      statureM: 1.7,
      massKg: 70,
      width: 1280,
      height: 720,
    }),
  );
  if (!frontal.sides) {
    throw new Error("a frontal run must produce per-side stats");
  }
  const { left, right, unassigned } = frontal.sides;
  const frontalLandings = left.count + right.count + unassigned;
  // Nothing may vanish: a landing the tracker could not assign is counted, not
  // dropped, so the table can never disagree with the landing count above it.
  if (left.count === 0 || right.count === 0) {
    throw new Error(
      `a frontal run must see both feet: ${left.count} left, ${right.count} right`,
    );
  }
  if (unassigned < 0) throw new Error("unassigned landings cannot be negative");
  for (const [name, side] of [["left", left], ["right", right]] as const) {
    if (!Number.isFinite(side.meanPeakGrfBw) || !Number.isFinite(side.meanScore)) {
      throw new Error(`${name} side lost its numbers`);
    }
  }
  console.log("side breakdown ok", {
    sideOn: "좌우 미주장",
    frontal: `좌 ${left.count} · 우 ${right.count} · 미배정 ${unassigned} / ${frontalLandings}`,
  });
}
// A poor clip publishes no numbers, per side included.
if (poorSummary.sides?.left.meanPeakGrfBw !== undefined) {
  const blanked =
    poorSummary.sides === null ||
    !Number.isFinite(poorSummary.sides.left.meanPeakGrfBw);
  if (!blanked) throw new Error("a poor clip must not publish per-side numbers");
}

// --- pace decides purpose, not just geometry --------------------------------
// Same strike label, same midfoot-friendly drop; only the weight differs.
const racer: Shoe = {
  brand: "Test",
  model: "Racer",
  category: "쿠션화",
  recommendedStrike: "midfoot",
  recommendedStrikes: ["midfoot"],
  heelDropMm: 6,
  weightG: 185,
  superTrainer: false,
  features: "",
};
const daily: Shoe = { ...racer, model: "Daily", heelDropMm: 8, weightG: 270 };

const easyRacer = scoreShoe(racer, "midfoot", "steady", "none");
const easyDaily = scoreShoe(daily, "midfoot", "steady", "none");
if (!easyRacer || !easyDaily || easyDaily.score <= easyRacer.score) {
  throw new Error(
    `at an easy pace a daily trainer must outrank a racing flat: ${easyDaily?.score} vs ${easyRacer?.score}`,
  );
}
const fastRacer = scoreShoe(racer, "midfoot", "fast", "none");
const fastDaily = scoreShoe(daily, "midfoot", "fast", "none");
if (!fastRacer || !fastDaily || fastRacer.score <= fastDaily.score) {
  throw new Error(
    `at a fast pace the racing flat must come back: ${fastRacer?.score} vs ${fastDaily?.score}`,
  );
}
// The old rule had a cliff at 200 g, so a 201 g racer scored as a daily shoe.
const justOver = scoreShoe({ ...racer, weightG: 201 }, "midfoot", "steady", "none");
const justUnder = scoreShoe({ ...racer, weightG: 199 }, "midfoot", "steady", "none");
if (!justOver || !justUnder || Math.abs(justOver.score - justUnder.score) > 2) {
  throw new Error(
    `two grams must not change the recommendation: ${justUnder?.score} vs ${justOver?.score}`,
  );
}
console.log("pace-aware shoe scoring ok", {
  easy: { daily: easyDaily.score, racer: easyRacer.score },
  fast: { daily: fastDaily.score, racer: fastRacer.score },
});

// --- session snapshots and comparison ---------------------------------------
const snapA = buildSnapshot({
  id: "a",
  savedAt: 1,
  label: "이전",
  result: realTime,
  summary: realSummary,
});
if (snapA.landingCount !== realTime.landings.length || !Number.isFinite(snapA.meanPeakGrfBw)) {
  throw new Error("snapshot lost the session it came from");
}
if (JSON.stringify(snapA).length > 800) {
  throw new Error(`snapshot should stay small, got ${JSON.stringify(snapA).length} bytes`);
}

const softer = {
  ...snapA,
  id: "b",
  label: "이후",
  meanPeakGrfBw: snapA.meanPeakGrfBw - 0.4,
  meanLoadingRateBwS: snapA.meanLoadingRateBwS - 8,
  meanKneeFlexContact: snapA.meanKneeFlexContact + 9,
};
const softerRun = compareSnapshots(snapA, softer);
if (softerRun.kind !== "ready") throw new Error("two good sessions must compare");
for (const key of ["meanPeakGrfBw", "meanLoadingRateBwS", "meanKneeFlexContact"]) {
  const change = softerRun.changes.find((c) => c.metric.key === key);
  if (change?.direction !== "softer") {
    throw new Error(`${key} should read softer, got ${change?.direction}`);
  }
}
// Contact time only describes the run — a change in it is never a verdict.
const contact = compareSnapshots(snapA, { ...snapA, id: "c", meanContactMs: snapA.meanContactMs + 90 })
  .kind === "ready"
  ? compareSnapshots(snapA, { ...snapA, id: "c", meanContactMs: snapA.meanContactMs + 90 })
  : null;
const contactChange = contact?.kind === "ready"
  ? contact.changes.find((c) => c.metric.key === "meanContactMs")
  : undefined;
if (contactChange?.direction !== "descriptive") {
  throw new Error(`contact time must stay descriptive, got ${contactChange?.direction}`);
}
// Sub-frame wobble is not a change.
const jitter = compareSnapshots(snapA, { ...snapA, id: "d", meanContactMs: snapA.meanContactMs + 5 });
if (jitter.kind !== "ready") throw new Error("jitter comparison must be ready");
if (jitter.changes.find((c) => c.metric.key === "meanContactMs")?.direction !== "flat") {
  throw new Error("a sub-frame difference must read flat");
}
if (!comparisonHeadline(jitter.changes).includes("측정 해상도")) {
  throw new Error("an all-flat comparison should say so");
}
// Rule §품질 게이팅 reaches saved sessions too.
const blocked = compareSnapshots(snapA, { ...snapA, id: "e", quality: "poor" });
if (blocked.kind !== "blocked") {
  throw new Error("a poor session must not be half of a numeric comparison");
}
// Export/import round-trips, and a hostile file is refused rather than parsed
// into NaN halfway down a comparison.
const bundleText = JSON.stringify(toBundle([snapA, softer], 1700000000000));
const roundTrip = parseBundle(bundleText);
if (!roundTrip.ok || roundTrip.sessions.length !== 2) {
  throw new Error("a bundle must survive a round trip");
}
// A withheld field is NaN, JSON writes NaN as null, and the importer used to
// reject the file for carrying a non-number. Any session with a gated value
// could not be imported at all — which was every side-on session once the
// left/right asymmetry stopped being claimed. It must come back as NaN, not
// as null, or a comparison does arithmetic on null further down.
{
  const gated = { ...snapA, id: "gated", asymmetryPct: Number.NaN };
  const back = parseBundle(JSON.stringify(toBundle([gated], 1700000000000)));
  if (!back.ok) {
    throw new Error(`a bundle with a withheld field was refused: ${back.reason}`);
  }
  const value = back.sessions[0].asymmetryPct;
  if (value === null || !Number.isNaN(value)) {
    throw new Error(`a withheld field came back as ${JSON.stringify(value)}, not NaN`);
  }
}
for (const [label, text] of [
  ["not json", "{{{"],
  ["wrong kind", JSON.stringify({ kind: "something-else", version: 1, sessions: [snapA] })],
  ["wrong version", JSON.stringify({ ...toBundle([snapA], 0), version: 99 })],
  ["no sessions", JSON.stringify(toBundle([], 0))],
  ["junk rows", JSON.stringify({ ...toBundle([], 0), sessions: [{ id: "x" }, null, 7] })],
  [
    "string where a number belongs",
    JSON.stringify({ ...toBundle([], 0), sessions: [{ ...snapA, meanPeakGrfBw: "2.1" }] }),
  ],
] as const) {
  if (parseBundle(text).ok) throw new Error(`bad bundle accepted: ${label}`);
}
console.log("session snapshot ok", {
  bytes: JSON.stringify(snapA).length,
  headline: comparisonHeadline(softerRun.changes),
});
if (formatTimingMs(217) !== "약 210 ms" || quantizeMs(33) !== 30) {
  throw new Error(
    `timing display must snap to ~30 ms, got ${formatTimingMs(217)} / ${quantizeMs(33)}`,
  );
}
const regularCadence = cadenceSpm([
  { tContact: 0 },
  { tContact: 0.32 },
  { tContact: 0.64 },
  { tContact: 0.96 },
  { tContact: 1.28 },
]);
const skippedCadence = cadenceSpm([
  { tContact: 0 },
  { tContact: 0.32 },
  { tContact: 0.96 },
  { tContact: 1.28 },
]);
if (Math.abs(regularCadence - 187.5) > 8) {
  throw new Error(`regular cadence should be ~188 spm, got ${regularCadence}`);
}
if (Math.abs(skippedCadence - regularCadence) > 12) {
  throw new Error(
    `cadence must ignore a missed contact: ${skippedCadence} vs ${regularCadence}`,
  );
}
const skippedSpan = (3 / 1.28) * 60;
if (Math.abs(skippedCadence - skippedSpan) < 20) {
  throw new Error("cadence must not follow the first-to-last span after a miss");
}

const gappyFrames = syntheticRunningFrames({
  steps: 10,
  contactS: 0.2,
  flightS: 0.14,
});
const gappy = analyzeLandings(
  gappyFrames.filter((frame) => frame.t < 0.85 || frame.t > 1.7),
  { statureM: 1.7, massKg: 70, width: 1280, height: 720 },
);
if (
  !gappy.quality.reasons.some((reason) => reason.includes("놓친")) &&
  gappy.quality.level === "good"
) {
  throw new Error("dropped contacts should lower quality or name the misses");
}
console.log("timing, score, and cadence gates ok", {
  score: sameLoadFast,
  cadence: Math.round(regularCadence),
  gappy: gappy.quality.level,
});

const liveRun = analyzeSyntheticRun();
const firstHit = liveRun.landings[0];
if (!firstHit) throw new Error("live readout needs a contact");
const liveStance = liveMomentAt(liveRun, firstHit.tContact + 0.03);
if (liveStance.phase !== "stance") {
  throw new Error(`expected stance at contact, got ${liveStance.phase}`);
}
if (!liveStance.headline.includes("접지")) {
  throw new Error(`stance headline should mention 접지, got ${liveStance.headline}`);
}
if (Number.isFinite(firstHit.flightMs) && firstHit.flightMs > 40) {
  const liveFlight = liveMomentAt(
    liveRun,
    firstHit.tContact + firstHit.contactMs / 1000 + 0.03,
  );
  if (liveFlight.phase !== "flight" && liveFlight.phase !== "air") {
    throw new Error(`expected flight after toe-off, got ${liveFlight.phase}`);
  }
}
const livePoor = liveMomentAt(
  tinyRunner,
  tinyRunner.landings[0]?.tContact ?? tinyRunner.series[0]?.t ?? 0,
);
if (livePoor.trusted) {
  throw new Error("poor footage must not trust live GRF");
}
if (Number.isFinite(livePoor.grfBw)) {
  throw new Error("poor live readout must not publish GRF");
}
console.log("live readout ok", {
  phase: liveStance.phase,
  knee: Math.round(liveStance.kneeFlex),
});

// The registry and the folder have to agree in both directions. A slug listed
// with no file behind it renders a broken image, and a file nobody listed is a
// photo the catalog will never show — neither shows up as a failure anywhere
// else, because shoeImageSrc only ever consults the list.
{
  const dir = join(import.meta.dirname, "../../public/images/shoes");
  const onDisk = new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith(".jpg"))
      .map((name) => name.slice(0, -".jpg".length)),
  );
  const listed = new Set(
    catalog.map((shoe) => shoeImageSrc(shoe)).flatMap((src) =>
      src ? [src.replace("/images/shoes/", "").replace(".jpg", "")] : [],
    ),
  );
  const missingFile = [...listed].filter((slug) => !onDisk.has(slug));
  const unlisted = [...onDisk].filter((slug) => !listed.has(slug));
  if (missingFile.length || unlisted.length) {
    throw new Error(
      `shoe photos out of sync — listed without a file: ${
        missingFile.join(", ") || "none"
      }; on disk but unlisted: ${unlisted.join(", ") || "none"}`,
    );
  }
  console.log("shoe photo registry ok", { photos: onDisk.size });
}

console.log("shoe photos ok", {
  primary: syntheticRec.picks.map((pick) => shoeImageSrc(pick.shoe)),
  secondary: syntheticRec.secondaryPicks.map((pick) => shoeImageSrc(pick.shoe)),
});

// The evidence layer is only worth having if the file on disk cannot disagree
// with the YAML people edit, and if every value in it actually says where it
// came from. Both are checked here rather than trusted.
{
  const root = join(import.meta.dirname, "../..");
  const yaml = readFileSync(join(root, "shared/thresholds.yaml"), "utf8");
  const rendered = normalizeText(emitThresholdsModule(yaml));
  const onDisk = normalizeText(
    readFileSync(join(root, "src/lib/thresholds.generated.ts"), "utf8"),
  );
  if (rendered !== onDisk) {
    throw new Error(
      "src/lib/thresholds.generated.ts is out of date — run `npm run emit:thresholds`",
    );
  }

  const records = Object.values(THRESHOLDS);
  for (const record of records) {
    if (!record.source.trim()) {
      throw new Error(`threshold ${record.key} has no source`);
    }
    if (!record.note.trim()) {
      throw new Error(`threshold ${record.key} has no note`);
    }
    if (!VALIDATION_STATUSES.includes(record.validationStatus)) {
      throw new Error(`threshold ${record.key} has an unknown validation status`);
    }
    if (!validationLabel[record.validationStatus]) {
      throw new Error(`no Korean label for status ${record.validationStatus}`);
    }
    if (!validationMeaning[record.validationStatus]) {
      throw new Error(`no explanation for status ${record.validationStatus}`);
    }
  }

  // withheld is a behaviour, not a label: it is the one status that must stop a
  // verdict from being published. If this ever returned true the front-view
  // eversion readout would start printing a classification nothing supports.
  for (const record of records) {
    const expected = record.validationStatus !== "withheld";
    if (isPublishable(record.key as ThresholdKey) !== expected) {
      throw new Error(
        `isPublishable(${record.key}) disagrees with status ${record.validationStatus}`,
      );
    }
  }

  // Footstrike.ts keeps its three bands written out, because /downloads
  // publishes it as a file that has to compile on its own. That is only safe
  // while the literals and the YAML say the same thing.
  const pairs: Array<[ThresholdKey, number]> = [
    ["foot_strike_rearfoot_max_deg", REARFOOT_MAX_ANGLE_DEG],
    ["foot_strike_forefoot_min_deg", FOREFOOT_MIN_ANGLE_DEG],
    ["foot_strike_max_plausible_deg", MAX_PLAUSIBLE_ANGLE_DEG],
  ];
  for (const [key, literal] of pairs) {
    if (threshold(key) !== literal) {
      throw new Error(
        `Footstrike.ts has ${literal} where shared/thresholds.yaml has ${threshold(key)} for ${key}`,
      );
    }
  }

  const statuses = new Map<string, number>();
  for (const record of records) {
    statuses.set(
      record.validationStatus,
      (statuses.get(record.validationStatus) ?? 0) + 1,
    );
  }
  console.log("thresholds ok", {
    count: records.length,
    ...Object.fromEntries(statuses),
  });
}

// /downloads hands out the rule files as standalone reading. They were hand
// copies and they had gone stale — the published Footstrike.ts still carried a
// confidence grade the app had deleted. Compare both the loose files and the
// bundle, so the page cannot quietly serve rules the app no longer follows.
{
  const root = join(import.meta.dirname, "../..");
  const expected = DOWNLOAD_FILES.map(([from, name]) => ({
    name,
    bytes: new TextEncoder().encode(
      normalizeText(readFileSync(join(root, from), "utf8")),
    ),
  }));

  for (const entry of expected) {
    const published = new Uint8Array(
      readFileSync(join(root, "public/downloads", entry.name)),
    );
    if (!sameBytes(published, entry.bytes)) {
      throw new Error(
        `public/downloads/${entry.name} differs from its source — run \`npm run sync:downloads\``,
      );
    }
  }

  const zip = new Uint8Array(
    readFileSync(join(root, "public/downloads", ZIP_NAME)),
  );
  const inZip = readZipEntries(zip);
  if (inZip.length !== expected.length) {
    throw new Error(
      `${ZIP_NAME} holds ${inZip.length} entries, expected ${expected.length} — run \`npm run sync:downloads\``,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (inZip[i].name !== expected[i].name) {
      throw new Error(
        `${ZIP_NAME} entry ${i} is ${inZip[i].name}, expected ${expected[i].name}`,
      );
    }
    if (!sameBytes(inZip[i].bytes, expected[i].bytes)) {
      throw new Error(
        `${ZIP_NAME} entry ${inZip[i].name} is stale — run \`npm run sync:downloads\``,
      );
    }
  }
  // The writer and the reader are each other's only check, so confirm the
  // archive on disk is byte-identical to a fresh build of the same inputs.
  if (!sameBytes(zip, buildZip(expected))) {
    throw new Error(`${ZIP_NAME} is not a clean build — run \`npm run sync:downloads\``);
  }
  console.log("downloads ok", { files: expected.length, zipBytes: zip.length });
}

// Overstriding. The measurement has to survive the two things that break naive
// implementations — a runner who happens to face the other way, and a contact
// index that is not the touchdown frame — and it has to disappear entirely when
// the clip cannot support it.
{
  const meanOf = (xs: number[]) => {
    const finite = xs.filter(Number.isFinite);
    if (!finite.length) return Number.NaN;
    return finite.reduce((a, b) => a + b, 0) / finite.length;
  };
  const measure = (ahead: number, facing: 1 | -1) => {
    const result = analyzeSyntheticSideRun({ ahead, facing });
    if (result.landings.length < 4) {
      throw new Error(
        `side-run fixture ahead=${ahead} facing=${facing} produced ${result.landings.length} contacts`,
      );
    }
    return {
      ratio: meanOf(result.landings.map((l) => l.footAheadRatio)),
      cm: meanOf(result.landings.map((l) => l.footAheadM * 100)),
    };
  };

  // A foot landing under the hip has to read as zero, not as "a bit ahead".
  // This is the check that catches a sign or reference-point mistake, since
  // every other case only asserts a range.
  const under = measure(0, 1);
  if (Math.abs(under.ratio) > 0.02) {
    throw new Error(`foot under the hip read as ${under.ratio.toFixed(3)} of stature`);
  }

  // 0.066 of frame width at this framing is about 17% of the fixture's stature.
  // The window estimator recovers ~95% of it; the shortfall is the three-frame
  // smoothing, and it is under a centimetre.
  const wide = measure(0.066, 1);
  if (!(wide.ratio > 0.13 && wide.ratio < 0.21)) {
    throw new Error(`overstride fixture read as ${wide.ratio.toFixed(3)} of stature`);
  }
  if (!(wide.cm > 20 && wide.cm < 36)) {
    throw new Error(`overstride fixture read as ${wide.cm.toFixed(1)} cm`);
  }

  // The whole point of taking direction from the foot rather than from motion
  // across the frame: mirroring the runner must change nothing.
  const mirrored = measure(0.066, -1);
  if (Math.abs(mirrored.ratio - wide.ratio) > 0.005) {
    throw new Error(
      `mirroring the runner changed the reading: ${wide.ratio.toFixed(3)} vs ${mirrored.ratio.toFixed(3)}`,
    );
  }

  const ladder = [0, 0.033, 0.066, 0.1].map((ahead) => measure(ahead, 1).ratio);
  for (let i = 1; i < ladder.length; i++) {
    if (!(ladder[i] > ladder[i - 1] + 0.03)) {
      throw new Error(`overstride ladder is not monotone: ${ladder.join(", ")}`);
    }
  }

  // A frontal clip collapses the fore-aft axis, so there is nothing to report.
  const front = analyzeSyntheticFrontRun();
  if (front.quality.sideViewRatio <= 0.14) {
    throw new Error("front fixture is not read as frontal");
  }
  const leaked = front.landings.filter((l) => Number.isFinite(l.footAheadRatio));
  if (leaked.length) {
    throw new Error(`${leaked.length} frontal contacts published a fore-aft distance`);
  }
  if (front.landings.some((l) => l.footStrike !== "unknown")) {
    throw new Error("a frontal contact published a strike pattern");
  }

  // The verdict is withheld today, and that has to be what the code does rather
  // than what a comment says.
  if (overstrideVerdict(wide.ratio) !== null) {
    throw new Error("a withheld threshold produced a verdict");
  }
  if (overstrideVerdictOrWithheld(wide.ratio) !== "판정 보류") {
    throw new Error("withheld verdict is not labelled 판정 보류");
  }
  if (overstrideVerdictOrWithheld(Number.NaN) !== "측정 불가") {
    throw new Error("an unmeasured contact must read 측정 불가, not 판정 보류");
  }

  if (formatFootAhead(Number.NaN) !== "측정 불가") {
    throw new Error("formatFootAhead must refuse NaN");
  }
  if (formatFootAhead(0.284) !== "앞 28 cm") {
    throw new Error(`formatFootAhead(0.284) = ${formatFootAhead(0.284)}`);
  }
  if (formatFootAhead(-0.06) !== "뒤 6 cm") {
    throw new Error(`formatFootAhead(-0.06) = ${formatFootAhead(-0.06)}`);
  }
  if (formatFootAheadRatio(0.165) !== "신장의 17%") {
    throw new Error(`formatFootAheadRatio(0.165) = ${formatFootAheadRatio(0.165)}`);
  }

  console.log("overstriding ok", {
    under: under.ratio.toFixed(3),
    wide: `${wide.ratio.toFixed(3)} (${wide.cm.toFixed(0)}cm)`,
    mirrored: mirrored.ratio.toFixed(3),
    ladder: ladder.map((v) => v.toFixed(3)).join(" < "),
    frontal: "측정 없음",
  });
}

// The frontal mode. A clip shot from in front is a different set of
// measurements, not a worse one, and the two halves of that claim are tested
// here: what it gains has to be right, and what it loses has to be absent
// rather than wrong.
{
  const meanOf = (xs: number[]) => {
    const finite = xs.filter(Number.isFinite);
    if (!finite.length) return Number.NaN;
    return finite.reduce((a, b) => a + b, 0) / finite.length;
  };
  const frontal = (valgus: number, pelvicDrop: number, facing: 1 | -1 = 1) => {
    const result = analyzeSyntheticFrontRun({ valgus, pelvicDrop, facing });
    if (result.landings.length < 4) {
      throw new Error(
        `front fixture valgus=${valgus} produced ${result.landings.length} contacts`,
      );
    }
    return {
      result,
      valgusDeg: meanOf(result.landings.map((l) => l.kneeValgusDeg)),
      dropDeg: meanOf(result.landings.map((l) => l.pelvicDropDeg)),
    };
  };

  const aligned = frontal(0, 0);
  if (aligned.result.cameraView !== "front") {
    throw new Error("the front fixture is not read as a frontal clip");
  }
  // Being filmed from the front is not a defect any more. If this starts
  // failing, the view has crept back into assessQuality as a reason.
  if (aligned.result.quality.level !== "good") {
    throw new Error(
      `a clean frontal clip graded ${aligned.result.quality.level}: ${aligned.result.quality.reasons.join(" / ")}`,
    );
  }
  if (Math.abs(aligned.valgusDeg) > 0.5 || Math.abs(aligned.dropDeg) > 0.5) {
    throw new Error(
      `an aligned runner read as ${aligned.valgusDeg.toFixed(2)}° valgus, ${aligned.dropDeg.toFixed(2)}° drop`,
    );
  }

  const ladder = [0.01, 0.02, 0.03].map((v) => frontal(v, 0).valgusDeg);
  for (let i = 1; i < ladder.length; i++) {
    if (!(ladder[i] > ladder[i - 1] + 5)) {
      throw new Error(`valgus ladder is not monotone: ${ladder.join(", ")}`);
    }
  }
  // Outward is the other sign, not a smaller number.
  const outward = frontal(-0.02, 0).valgusDeg;
  if (!(outward < -5)) {
    throw new Error(`a knee held outside the line read as ${outward.toFixed(2)}°`);
  }

  // Filming the same runner from behind mirrors the image and swaps which side
  // of the frame each leg falls on. Nothing about the runner changed, so
  // nothing about the reading may change — this is what pins "inward" to the
  // pelvis rather than to the frame.
  const fromFront = frontal(0.02, 0.012, 1);
  const fromBehind = frontal(0.02, 0.012, -1);
  if (Math.abs(fromFront.valgusDeg - fromBehind.valgusDeg) > 0.2) {
    throw new Error(
      `mirroring changed the valgus: ${fromFront.valgusDeg.toFixed(2)} vs ${fromBehind.valgusDeg.toFixed(2)}`,
    );
  }
  if (Math.abs(fromFront.dropDeg - fromBehind.dropDeg) > 0.2) {
    throw new Error(
      `mirroring changed the pelvic drop: ${fromFront.dropDeg.toFixed(2)} vs ${fromBehind.dropDeg.toFixed(2)}`,
    );
  }

  const drops = [0, 0.006, 0.012].map((d) => frontal(0, d).dropDeg);
  for (let i = 1; i < drops.length; i++) {
    if (!(drops[i] > drops[i - 1] + 1)) {
      throw new Error(`pelvic drop ladder is not monotone: ${drops.join(", ")}`);
    }
  }

  // What the view costs, and the shape of that cost: absent, not wrong.
  const front = frontal(0.02, 0.012).result;
  for (const landing of front.landings) {
    if (Number.isFinite(landing.kneeFlexContact)) {
      throw new Error("a frontal clip published knee flexion");
    }
    if (Number.isFinite(landing.footAheadRatio)) {
      throw new Error("a frontal clip published a fore-aft distance");
    }
    if (landing.footStrike !== "unknown") {
      throw new Error("a frontal clip published a strike pattern");
    }
  }
  if (front.series.some((point) => Number.isFinite(point.kneeFlex))) {
    // The live readout prefers the series sample over the landing, so blanking
    // only the landing would leave the old number on screen during playback.
    throw new Error("the frontal series still carries a knee angle");
  }

  // A side-on clip is the mirror case: the frontal geometry has to refuse,
  // which the pelvis-width gate does without anyone checking the view.
  const side = analyzeSyntheticSideRun();
  if (side.cameraView !== "side") throw new Error("the side fixture is not read as side-on");
  if (
    side.landings.some(
      (l) => Number.isFinite(l.kneeValgusDeg) || Number.isFinite(l.pelvicDropDeg),
    )
  ) {
    throw new Error("a side-on clip published a frontal alignment angle");
  }

  // Dropping the knee term must stretch the other two back over the full
  // hundred. Without that the score would cap at 82 and the top risk band
  // would quietly become unreachable.
  const heavy = { peakGrfBw: 4.5, loadingRateBwS: 90, dutyFactor: 0.2 };
  const withoutKnee = landingLoadScore({
    ...heavy,
    kneeFlexContact: Number.NaN,
    kneeMeasured: false,
  });
  if (withoutKnee !== 100) {
    throw new Error(`the hardest landing scores ${withoutKnee} without the knee term`);
  }
  // And the default has to stay exactly what it was, or every side-on score
  // shifts under a change that was meant for frontal clips only.
  const withKnee = landingLoadScore({ ...heavy, kneeFlexContact: 0 });
  if (withKnee !== 100) {
    throw new Error(`the hardest landing scores ${withKnee} with the knee term`);
  }
  const midWithKnee = landingLoadScore({
    peakGrfBw: 2.4,
    loadingRateBwS: 22,
    dutyFactor: 0.3,
    kneeFlexContact: 28,
  });
  const midWithoutKnee = landingLoadScore({
    peakGrfBw: 2.4,
    loadingRateBwS: 22,
    dutyFactor: 0.3,
    kneeFlexContact: 28,
    kneeMeasured: false,
  });
  if (midWithKnee === midWithoutKnee) {
    throw new Error("kneeMeasured: false changed nothing");
  }

  if (kneeValgusVerdict(fromFront.valgusDeg) !== null) {
    throw new Error("a withheld threshold produced a knee alignment verdict");
  }
  if (pelvicDropVerdict(fromFront.dropDeg) !== null) {
    throw new Error("a withheld threshold produced a pelvic drop verdict");
  }
  if (formatKneeValgusDeg(12.4) !== "안쪽 12°") {
    throw new Error(`formatKneeValgusDeg(12.4) = ${formatKneeValgusDeg(12.4)}`);
  }
  if (formatKneeValgusDeg(-12.4) !== "바깥쪽 12°") {
    throw new Error(`formatKneeValgusDeg(-12.4) = ${formatKneeValgusDeg(-12.4)}`);
  }
  if (formatKneeValgusDeg(Number.NaN) !== "측정 불가") {
    throw new Error("formatKneeValgusDeg must refuse NaN");
  }
  if (formatPelvicDropDeg(4.2) !== "반대쪽 4°") {
    throw new Error(`formatPelvicDropDeg(4.2) = ${formatPelvicDropDeg(4.2)}`);
  }

  console.log("frontal view ok", {
    aligned: `${aligned.valgusDeg.toFixed(1)}°`,
    valgusLadder: ladder.map((v) => v.toFixed(1)).join(" < "),
    outward: `${outward.toFixed(1)}°`,
    mirrored: `${fromFront.valgusDeg.toFixed(1)} = ${fromBehind.valgusDeg.toFixed(1)}`,
    dropLadder: drops.map((v) => v.toFixed(1)).join(" < "),
    sagittal: "측정 없음",
  });
}

// The exported still. Only the parts that decide *what* leaves the browser are
// checked here — the drawing needs a canvas — and those are the parts that
// matter: where the face is, and which numbers a given clip is allowed to put
// on an image that will outlive the page it came from.
{
  const WIDTH = 1280;
  const HEIGHT = 720;
  // Ear to ear is 0.052 of the frame width, which is 67 px here, and the
  // shoulders sit 0.1 of the frame height below the nose — a head and a bit,
  // which is where they are on a person. The box scale is read from that
  // distance, so a fixture with the shoulders parked at the bottom of the frame
  // would let a wildly oversized box pass.
  const faceAt = (x: number, y: number): Landmark[] => {
    const points: Landmark[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.9,
      visibility: 1,
    }));
    points[LM.leftShoulder] = { x: x - 0.055, y: y + 0.1, visibility: 1 };
    points[LM.rightShoulder] = { x: x + 0.055, y: y + 0.1, visibility: 1 };
    points[LM.nose] = { x, y, visibility: 1 };
    points[LM.leftEye] = { x: x - 0.012, y: y - 0.012, visibility: 1 };
    points[LM.rightEye] = { x: x + 0.012, y: y - 0.012, visibility: 1 };
    points[LM.leftEar] = { x: x - 0.026, y: y - 0.008, visibility: 1 };
    points[LM.rightEar] = { x: x + 0.026, y: y - 0.008, visibility: 1 };
    points[LM.mouthLeft] = { x: x - 0.009, y: y + 0.016, visibility: 1 };
    points[LM.mouthRight] = { x: x + 0.009, y: y + 0.016, visibility: 1 };
    return points;
  };

  const box = faceBoxFrom(faceAt(0.5, 0.3), WIDTH, HEIGHT);
  if (!box) throw new Error("a visible face produced no box");
  // The landmarks trace the middle of a face. The box has to reach past them,
  // and further above than below, or it covers the eyes and leaves the head.
  const eyeY = (0.3 - 0.012) * HEIGHT;
  const mouthY = (0.3 + 0.016) * HEIGHT;
  if (!(box.y < eyeY - 20)) {
    throw new Error(`the face box starts at ${box.y.toFixed(0)}, barely above the eyes`);
  }
  if (!(box.y + box.height > mouthY + 10)) {
    throw new Error("the face box stops at the mouth");
  }
  const earLeft = (0.5 - 0.026) * WIDTH;
  const earRight = (0.5 + 0.026) * WIDTH;
  if (!(box.x < earLeft && box.x + box.width > earRight)) {
    throw new Error("the face box does not cover both ears");
  }
  // And covers the face rather than the upper body. Three times the head is a
  // block on the picture, which is what the first version drew.
  const headWidth = earRight - earLeft;
  if (box.width > headWidth * 2.6) {
    throw new Error(
      `the face box is ${(box.width / headWidth).toFixed(1)} heads wide`,
    );
  }
  if (box.height > headWidth * 3.0) {
    throw new Error(
      `the face box is ${(box.height / headWidth).toFixed(1)} heads tall`,
    );
  }

  // Turning sideways hides the far eye and ear, which halves the landmark span.
  // The box must not halve with it, or the view this app is built for is the
  // one it covers worst.
  const profile = faceAt(0.5, 0.3);
  for (const index of [LM.rightEye, LM.rightEar, LM.mouthRight]) {
    profile[index] = { ...profile[index], visibility: 0 };
  }
  const profileBox = faceBoxFrom(profile, WIDTH, HEIGHT);
  if (!profileBox) throw new Error("a face in profile produced no box");
  if (profileBox.width < box.width * 0.7) {
    throw new Error(
      `the profile box collapsed to ${(profileBox.width / box.width).toFixed(2)} of the frontal one`,
    );
  }

  // A face at the edge must not produce a box that hangs outside the frame:
  // the mosaic reads pixels back from those coordinates.
  const corner = faceBoxFrom(faceAt(0.01, 0.01), WIDTH, HEIGHT);
  if (!corner) throw new Error("a face at the corner produced no box");
  if (
    corner.x < 0 ||
    corner.y < 0 ||
    corner.x + corner.width > WIDTH ||
    corner.y + corner.height > HEIGHT
  ) {
    throw new Error("the face box left the frame");
  }

  // The fail-closed ladder. Rung one: no landmarks at all.
  if (faceBoxFrom(null, WIDTH, HEIGHT) !== null) {
    throw new Error("a frame with no landmarks produced a face box");
  }
  // Rung two: the tracker lost the face on this frame, so the neighbours answer.
  const frames = [
    { t: 0, landmarks: faceAt(0.5, 0.3) },
    { t: 0.03, landmarks: null },
    { t: 0.06, landmarks: null },
  ];
  const found = faceBoxNear(frames, 1, WIDTH, HEIGHT);
  if (!found) throw new Error("the search did not reach the neighbouring frame");
  // Which rung answered is reported on the image, so it has to be right.
  if (found.source !== "neighbour") {
    throw new Error(`a neighbouring frame answered but was reported as ${found.source}`);
  }
  const onFrame = faceBoxNear(frames, 0, WIDTH, HEIGHT);
  if (onFrame?.source !== "frame") {
    throw new Error(`the frame's own face was reported as ${onFrame?.source}`);
  }
  if (faceBoxNear([{ t: 0, landmarks: null }], 0, WIDTH, HEIGHT) !== null) {
    throw new Error("faceBoxNear invented a box out of nothing");
  }
  for (const source of ["frame", "neighbour", "fallback", "no-photo"] as const) {
    if (!FACE_COVER_LABEL[source]) {
      throw new Error(`no label for face cover ${source}`);
    }
  }

  // The blur geometry. Both of these fail silently in the picture rather than
  // as an error: a radius that does not scale stops hiding anything on larger
  // footage, and a source rectangle cut to the box leaves the face showing
  // through a soft rim where the blur faded to transparent.
  const small = blurPlan({ x: 100, y: 100, width: 120, height: 140 }, 1280, 720);
  const large = blurPlan({ x: 100, y: 100, width: 480, height: 560 }, 3840, 2160);
  if (!(large.radius > small.radius * 3)) {
    throw new Error(
      `the blur radius does not scale with the face: ${small.radius} then ${large.radius}`,
    );
  }
  if (small.radius < 4) {
    throw new Error(`a ${small.radius}px blur is a smudge, not a cover`);
  }
  const readsLeft = small.x - small.readX;
  const readsRight = small.readX + small.readWidth - (small.x + small.width);
  if (readsLeft < small.radius * 2 || readsRight < small.radius * 2) {
    throw new Error(
      `the blur reads only ${readsLeft}/${readsRight}px around a ${small.radius}px radius`,
    );
  }
  // The feather has to dissolve, and the solid part has to still be a cover.
  // A core that reached the edge would draw the line the fade exists to remove;
  // one that started too early would leave a face readable through the haze.
  if (!(small.coreRadius > 0 && small.coreRadius < small.edgeRadius)) {
    throw new Error(
      `the feather core (${small.coreRadius}) is not inside the edge (${small.edgeRadius})`,
    );
  }
  if (small.coreRadius < small.edgeRadius * 0.5) {
    throw new Error("the blur starts fading before it has covered anything");
  }
  const facePlan = blurPlan(box, WIDTH, HEIGHT);
  if (facePlan.coreRadius * 2 < headWidth) {
    throw new Error(
      `the fully covered core is ${(facePlan.coreRadius * 2).toFixed(0)}px across a ${headWidth.toFixed(0)}px head`,
    );
  }

  // Against the frame edge there is nothing to read from, and the plan must
  // stay inside the canvas rather than ask for pixels that do not exist.
  const atEdge = blurPlan({ x: 0, y: 0, width: 200, height: 220 }, 1280, 720);
  if (atEdge.readX < 0 || atEdge.readY < 0) {
    throw new Error("the blur reads from outside the canvas");
  }
  if (
    atEdge.readX + atEdge.readWidth > 1280 ||
    atEdge.readY + atEdge.readHeight > 720
  ) {
    throw new Error("the blur reads past the far edge of the canvas");
  }

  // The mosaic arithmetic, still the fallback where a context will not blur. A
  // reduced copy that is one pixel on either axis is a flat rectangle, not a
  // mosaic, and a source rectangle that is not whole pixels reads a smeared
  // edge back — both are silent failures in the image.
  const plan = mosaicPlan({ x: 10.4, y: 20.6, width: 213.2, height: 193.7 });
  if (plan.smallWidth < 2 || plan.smallHeight < 2) {
    throw new Error(`the mosaic collapsed to ${plan.smallWidth}x${plan.smallHeight}`);
  }
  if (!Number.isInteger(plan.x) || !Number.isInteger(plan.y)) {
    throw new Error("the mosaic reads from fractional coordinates");
  }
  // The reduced copy must keep the box's proportions, or the rebuilt cells come
  // out stretched and the mosaic looks like a rendering fault.
  const boxRatio = plan.height / plan.width;
  const planRatio = plan.smallHeight / plan.smallWidth;
  if (Math.abs(boxRatio - planRatio) > 0.25) {
    throw new Error(`the mosaic cells are the wrong shape: ${planRatio.toFixed(2)} vs ${boxRatio.toFixed(2)}`);
  }
  const tiny = mosaicPlan({ x: 0, y: 0, width: 3, height: 2 });
  if (tiny.smallWidth < 2 || tiny.smallHeight < 2) {
    throw new Error("a small box produced a degenerate mosaic");
  }
  // Rung three: cover the top third rather than nothing.
  const fallback = fallbackFaceBox(WIDTH, HEIGHT);
  if (fallback.width !== WIDTH || fallback.y !== 0 || fallback.height < HEIGHT / 4) {
    throw new Error("the fallback does not cover the upper frame");
  }

  // What the still is allowed to say, per view. A saved image outlives the
  // caveats printed around it, so it may not carry a number the clip could not
  // support — the same rule the screen follows, checked separately because this
  // path builds its rows itself.
  const sideResult = analyzeSyntheticSideRun({ ahead: 0.066 });
  const sideHud = buildHudFrame(sideResult, sideResult.landings[1], 2);
  const labels = (hud: { rows: Array<{ label: string }> }) =>
    hud.rows.map((row) => row.label);
  for (const label of ["착지 주법", "접지 순간 무릎", "몸 앞 착지"]) {
    if (!labels(sideHud).includes(label)) {
      throw new Error(`the side-on still is missing ${label}`);
    }
  }
  if (labels(sideHud).some((label) => label === "무릎 정렬")) {
    throw new Error("the side-on still offered a frontal measurement");
  }

  const frontResult = analyzeSyntheticFrontRun({ valgus: 0.018, pelvicDrop: 0.009 });
  // The still travels, so it is the last place a bare category could survive.
  // Its strike row has to carry the same doubt the card shows.
  const sideStrike = sideHud.rows.find((row) => row.label === "착지 주법")?.value ?? "";
  if (!sideStrike.includes("±")) {
    throw new Error(`the exported still shows a strike with no doubt: ${sideStrike}`);
  }
  const doubtful = sideResult.landings.find(
    (landing) =>
      landing.footStrike !== "unknown" &&
      !strikeAngleSettles(landing.footStrikeAngleDeg, landing.footStrikeAngleUncertaintyDeg),
  );
  if (doubtful) {
    const row =
      buildHudFrame(sideResult, doubtful, 1).rows.find((r) => r.label === "착지 주법")
        ?.value ?? "";
    if (!row.includes("~")) {
      throw new Error(
        `a strike a frame from another category was named outright on the still: ${row}`,
      );
    }
  }

  const frontHud = buildHudFrame(frontResult, frontResult.landings[1], 2);
  for (const label of ["무릎 정렬", "골반 기울기"]) {
    if (!labels(frontHud).includes(label)) {
      throw new Error(`the frontal still is missing ${label}`);
    }
  }
  for (const label of ["착지 주법", "접지 순간 무릎", "몸 앞 착지"]) {
    if (labels(frontHud).includes(label)) {
      throw new Error(`the frontal still offered ${label}, which it cannot measure`);
    }
  }

  // A clip too poor to publish on screen is too poor to publish on a file
  // somebody keeps.
  const poor = buildHudFrame(
    { ...sideResult, quality: { ...sideResult.quality, level: "poor" } },
    sideResult.landings[1],
    2,
  );
  // "판정 불가" for the strike pattern, which is a judgement rather than a
  // measurement — the same two words the landing card uses.
  const refusals = new Set(["측정 불가", "판정 불가"]);
  const leaked = poor.rows.filter((row) => !refusals.has(row.value));
  if (leaked.length) {
    throw new Error(
      `a poor-quality still published ${leaked.map((r) => `${r.label}=${r.value}`).join(", ")}`,
    );
  }
  if (poor.badge !== "측정 참고용") {
    throw new Error(`a poor-quality still is badged ${poor.badge}`);
  }
  if (sideHud.note !== HUD_NOTE || frontHud.note !== HUD_NOTE) {
    throw new Error("the still lost the note about what the estimate is");
  }

  // Drawing the photograph and covering the face are independent. Coupling them
  // once already produced an export with covering turned off that contained no
  // video frame — a skeleton on a black rectangle, which nothing else here
  // would have caught.
  const withCover = exportPlan({ hasVideo: true, coverFace: true });
  if (!withCover.drawVideo || !withCover.mosaic) {
    throw new Error("covering the face dropped the photograph or the mosaic");
  }
  const withoutCover = exportPlan({ hasVideo: true, coverFace: false });
  if (!withoutCover.drawVideo) {
    throw new Error("turning covering off also dropped the video frame");
  }
  if (withoutCover.mosaic || withoutCover.faceCover !== "off") {
    throw new Error("covering was turned off but the export still says otherwise");
  }
  const sample = exportPlan({ hasVideo: false, coverFace: true });
  if (sample.drawVideo || sample.mosaic || sample.faceCover !== "no-photo") {
    throw new Error("the sample session tried to cover a face it does not have");
  }

  console.log("export still ok", {
    faceBox: `${Math.round(box.width)}x${Math.round(box.height)}`,
    sideRows: labels(sideHud).length,
    frontRows: labels(frontHud).length,
    poor: "전 항목 측정 불가",
  });
}

// The catalog. Both checks here are about one thing: the shoe list is a file
// shared with another implementation, so neither its freshness nor its row
// order can be taken on trust from inside this repository.
{
  const root = join(import.meta.dirname, "../..");
  const csv = readFileSync(join(root, "shared/shoes.csv"), "utf8");
  const rendered = emitShoesJson(csv).replace(/\r\n/g, "\n");
  const onDisk = readFileSync(join(root, "shared/shoes.json"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  if (rendered !== onDisk) {
    throw new Error(
      "shared/shoes.json is out of date — run `npm run emit:shoes`",
    );
  }

  // The app reads the JSON, so an edit to the CSV that was never re-emitted
  // used to leave the catalog on screen one revision behind, with a comment as
  // the only thing asking anyone to notice.
  console.log("catalog json ok", { rows: JSON.parse(onDisk).length });
}

{
  // Reversing the rows changed four of six recommendation sets before the sort
  // settled its own ties: a Gel-Cumulus became a Gel-Nimbus, an Adios Pro a
  // Takumi Sen. Shoes that scored identically, so the winner was whichever had
  // been written down first — and row order belongs to whoever last emitted the
  // shared CSV.
  const rows = listShoes();
  const reversed = [...rows].reverse();
  const rank = (
    catalogRows: Shoe[],
    strike: "rearfoot" | "midfoot" | "forefoot",
    pace: "easy" | "fast",
  ) => {
    const scored = catalogRows.flatMap((shoe) => {
      const pick = scoreShoe(shoe, strike, pace, "none");
      return pick
        ? [
            {
              brand: shoe.brand,
              model: shoe.model,
              score: pick.score,
              strikes: shoe.recommendedStrikes,
            },
          ]
        : [];
    });
    const ranked = rankShoes(scored, strike);
    if (ranked.kind !== "matched") return "general";
    return [...ranked.primary, ...ranked.others]
      .map((item) => `${item.brand} ${item.model}`)
      .join(" | ");
  };

  let compared = 0;
  for (const strike of ["rearfoot", "midfoot", "forefoot"] as const) {
    for (const pace of ["easy", "fast"] as const) {
      const asIs = rank(rows, strike, pace);
      const flipped = rank(reversed, strike, pace);
      if (asIs !== flipped) {
        throw new Error(
          `catalog row order changed the ${strike}/${pace} picks:\n  as-is    ${asIs}\n  reversed ${flipped}`,
        );
      }
      compared += 1;
    }
  }
  console.log("catalog order independence ok", { combinations: compared });
}

// Theme token names, which are not free-form: Tailwind turns every
// --spacing-<name> into an inline-<name> utility as well, so a token called
// `block` makes `inline-block` ambiguous — and Tailwind emits both meanings.
// That set every inline-block element in the app to 3.5rem wide; the header's
// 분석 시작 button became 56px holding four lines of one character, hanging out
// of the top of the header. Nothing in the build, the types or the linter said
// a word about it.
{
  const css = readFileSync(
    join(import.meta.dirname, "../app/globals.css"),
    "utf8",
  );
  // Display keywords that can follow `inline-` in a Tailwind utility.
  const reserved = new Set(["block", "flex", "grid", "table"]);
  const names = [...css.matchAll(/--spacing-([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  if (!names.length) throw new Error("no --spacing-* tokens found; has the theme moved?");
  const clashing = names.filter((name) => reserved.has(name));
  if (clashing.length) {
    throw new Error(
      `spacing token(s) named after a display keyword: ${clashing.join(", ")} — inline-${clashing[0]} would mean two things`,
    );
  }
  console.log("theme tokens ok", { spacing: names.join(", ") });
}

// Cadence. The number a runner is most likely to check against a watch, and it
// used to come from the 40th percentile of the step gaps — a deliberate lean
// towards the short cluster, which read 2 to 3 percent high on clean fixtures
// and doubled outright when the detector split footfalls.
{
  const rows = (gaps: number[], contactMs: number) => {
    let t = 0.5;
    const out = [{ tContact: t, contactMs }];
    for (const gap of gaps) {
      t += gap;
      out.push({ tContact: t, contactMs });
    }
    return out;
  };

  // Against fixtures whose true cadence is known by construction, across the
  // range the app claims to cover.
  for (const gait of [
    { contactS: 0.3, flightS: 0.14 },
    { contactS: 0.26, flightS: 0.12 },
    { contactS: 0.24, flightS: 0.1 },
    { contactS: 0.2, flightS: 0.1 },
    { contactS: 0.14, flightS: 0.1 },
  ]) {
    const truth = 60 / (gait.contactS + gait.flightS);
    const reported = cadenceSpm(
      analyzeSyntheticRun({ ...gait, steps: 10, fps: 60 }).landings,
    );
    if (!(Math.abs(reported - truth) <= 3)) {
      throw new Error(
        `cadence off by ${(reported - truth).toFixed(1)} spm at ${truth.toFixed(0)}: reported ${reported.toFixed(1)}`,
      );
    }
  }

  // A 0.34 s step is 176 spm. Half of the gaps split, then most, then all —
  // the last only recoverable because a foot cannot be on the ground for
  // longer than the step it belongs to, and 270 ms of stance rules out a
  // 170 ms step.
  const split = [
    ["some", [0.34, 0.17, 0.17, 0.34, 0.34, 0.34]],
    ["most", [0.17, 0.17, 0.34, 0.17, 0.17, 0.17, 0.17]],
    ["all", [0.17, 0.17, 0.17, 0.17, 0.17, 0.17]],
  ] as const;
  for (const [label, gaps] of split) {
    const reported = cadenceSpm(rows([...gaps], 270));
    if (!(Math.abs(reported - 176) <= 6)) {
      throw new Error(
        `${label} split footfalls reported ${reported.toFixed(0)} spm instead of ~176`,
      );
    }
  }

  // And the guard must not fire on a gait that is simply fast. A 0.24 s step
  // with 100 ms of stance is a sprint, not a split 0.48 s step.
  const sprint = cadenceSpm(rows([0.24, 0.24, 0.24, 0.24, 0.24, 0.24], 100));
  if (!(Math.abs(sprint - 250) <= 6)) {
    throw new Error(`a real 250 spm sprint reported ${sprint.toFixed(0)} spm`);
  }

  // Walking spends more than half the stride on the ground, so stance exceeds
  // one step interval there. That is a gait, not evidence of a split.
  const walk = cadenceSpm(rows([0.55, 0.55, 0.55, 0.55], 620));
  if (!(Math.abs(walk - 109) <= 6)) {
    throw new Error(`walking reported ${walk.toFixed(0)} spm instead of ~109`);
  }

  console.log("cadence ok", {
    fixtures: "136–250 spm 오차 3 이내",
    split: "절반 간격 보정",
    sprint: Math.round(sprint),
    walk: Math.round(walk),
  });
}

// Session comparison. The card puts two rounded numbers side by side and a
// verdict underneath, so the two have to be reachable from the same
// measurement — a row reading 약 150 ms → 약 120 ms above the words 변화 없음
// is the report contradicting itself in the space of one card.
{
  const base = {
    version: 2,
    id: "before",
    savedAt: 0,
    label: "이전",
    quality: "good" as const,
    durationS: 3.2,
    landingCount: 9,
    cadenceSpm: 176,
    pace: "easy" as const,
    dominantStrike: "midfoot" as const,
    strikePercents: { rearfoot: 0, midfoot: 100, forefoot: 0 },
    meanDutyFactor: 0.38,
    meanContactMs: 270,
    meanFlightMs: 148.6,
    meanPeakGrfBw: 2.62,
    meanLoadingRateBwS: 21,
    meanKneeFlexContact: 20,
    meanScore: 26.4,
    asymmetryPct: 0,
  };
  const direction = (over: Partial<typeof base>, key: string) => {
    const cmp = compareSnapshots(base, { ...base, ...over, id: "after" });
    if (cmp.kind !== "ready") throw new Error("two good sessions must compare");
    const row = cmp.changes.find((c) => c.metric.key === key);
    if (!row) throw new Error(`no comparison row for ${key}`);
    return row;
  };

  // The reported case: a 15 ms shift in the mean of nine landings. It was
  // measured against one frame of single-landing noise and came back flat.
  const flight = direction({ meanFlightMs: 133.2 }, "meanFlightMs");
  if (flight.direction === "flat") {
    throw new Error(
      `a ${Math.abs(flight.diff).toFixed(0)} ms shift across nine landings still reads flat`,
    );
  }
  // Whatever the verdict, the two rounded numbers must not disagree with it.
  const shown = (row: typeof flight) => ({
    before: row.metric.format(row.before),
    after: row.metric.format(row.after),
  });
  const flightShown = shown(flight);
  if (flightShown.before === flightShown.after) {
    throw new Error("a reported change shows the same number twice");
  }

  // Two and a half milliseconds is not a change, and there both numbers round
  // to the same thing so the card has nothing to contradict.
  const steady = direction({ meanFlightMs: 146 }, "meanFlightMs");
  if (steady.direction !== "flat") {
    throw new Error(`2.6 ms reads as ${steady.direction}`);
  }

  // Fewer landings, same shift: a mean of three is not a mean of nine, and the
  // verdict has to be allowed to say so.
  const thin = compareSnapshots(
    { ...base, landingCount: 3 },
    { ...base, id: "after", landingCount: 3, meanFlightMs: 133.2 },
  );
  if (thin.kind !== "ready") throw new Error("thin sessions must still compare");
  const thinFlight = thin.changes.find((c) => c.metric.key === "meanFlightMs");
  if (thinFlight?.direction !== "flat") {
    throw new Error(
      `the same shift over three landings reads ${thinFlight?.direction}, not flat`,
    );
  }

  // A tenth of a bodyweight across nine landings is a real difference, and the
  // card was showing 2.6 → 2.5 while calling it unchanged.
  const force = direction({ meanPeakGrfBw: 2.54 }, "meanPeakGrfBw");
  if (force.direction === "flat") {
    throw new Error("0.08 BW across nine landings still reads flat");
  }

  console.log("session comparison ok", {
    flight: `${flightShown.before} → ${flightShown.after} · ${flight.direction}`,
    steady: steady.direction,
    thin: thinFlight?.direction,
    force: force.direction,
  });
}

// Reading Sports2D output into this app's analysis. The point of the adapter is
// that a comparison between pose estimators is a controlled experiment — same
// clip, same analysis, one variable — so the adapter itself must add nothing.
// It is checked by round-tripping a fixture out to a TRC and back and requiring
// the report to be identical.
{
  const W = 1280;
  const H = 720;

  // The marker list, order and header of a real Sports2D pixel TRC — taken
  // from one, not from the HALPE_26 numbering. Two things in it caught the
  // first version of the adapter out: the order is the skeleton's, not the
  // keypoint set's, and there are 22 markers rather than 26 because the eyes
  // and ears are never written. An adapter reading by column index would have
  // built a pose from the wrong joints without failing.
  const TRC_MARKERS = [
    "Hip", "RHip", "RKnee", "RAnkle", "RBigToe", "RSmallToe", "RHeel",
    "LHip", "LKnee", "LAnkle", "LBigToe", "LSmallToe", "LHeel",
    "Neck", "Head", "Nose",
    "RShoulder", "RElbow", "RWrist", "LShoulder", "LElbow", "LWrist",
  ];

  /** A pixel TRC written from frames whose report we already know. */
  const writeTrc = (
    frames: PoseFrame[],
    flipY: boolean,
    names: string[] = TRC_MARKERS,
  ): string => {
    const rate = 1 / (frames[1].t - frames[0].t);
    const header = [
      "PathFileType\t4\t(X/Y/Z)\tfixture.trc",
      "DataRate\tCameraRate\tNumFrames\tNumMarkers\tUnits\tOrigDataRate\tOrigDataStartFrame\tOrigNumFrames",
      // Units says metres in a file of pixels, exactly as the real one does.
      // Nothing may branch on this field.
      `${rate}\t${rate}\t${frames.length}\t${names.length}\tm\t${rate}\t0\t${frames.length}`,
      "Frame#\tTime\t" + names.map((n) => `${n}\t\t`).join(""),
      "\t\t" + names.map((_, i) => `X${i + 1}\tY${i + 1}\tZ${i + 1}`).join("\t"),
    ];
    const rows = frames.map((frame, i) => {
      const cells: string[] = [String(i), frame.t.toFixed(6)];
      for (const name of names) {
        const key = markerKey(name);
        const index = MARKER_TO_MEDIAPIPE[key];
        // Small toes have no MediaPipe slot, so they are written from the big
        // toe — enough to check that the adapter carries them into footExtras
        // from wherever the column happens to be.
        const from =
          index !== undefined
            ? index
            : key === markerKey(SMALL_TOE_MARKERS.left)
              ? LM.leftFootIndex
              : key === markerKey(SMALL_TOE_MARKERS.right)
                ? LM.rightFootIndex
                : undefined;
        const mark =
          from !== undefined && frame.landmarks ? frame.landmarks[from] : undefined;
        if (!mark || mark.visibility === 0) {
          // A gap in a TRC is blank cells, which is the case the parser has to
          // tell apart from a marker that really sits at the origin. Hip, Neck
          // and Head take this path too: the app has no equivalent joint.
          cells.push("", "", "");
          continue;
        }
        const y = flipY ? (1 - mark.y) * H : mark.y * H;
        cells.push((mark.x * W).toFixed(4), y.toFixed(4), "0.0000");
      }
      return cells.join("\t");
    });
    return [...header, ...rows, ""].join("\n");
  };

  const original = syntheticSideRunFrames({ ahead: 0.066 });
  const opts = { statureM: 1.7, massKg: 70, width: W, height: H };
  const digest = (result: ReturnType<typeof analyzeLandings>) =>
    result.landings
      .map(
        (l) =>
          `${l.tContact.toFixed(3)}/${l.footStrike}/${l.peakGrfBw.toFixed(2)}/${l.footAheadRatio.toFixed(3)}`,
      )
      .join(" ");
  const expected = digest(analyzeLandings(original, opts));

  // Both vertical conventions, because the analysis speaks image coordinates
  // and a world-up file flips every strike angle — which does not fail, it
  // reports rearfoot contacts as forefoot. The convention is read out of the
  // data rather than remembered.
  for (const flipY of [false, true]) {
    const table = parseTrc(writeTrc(original, flipY));
    if (table.markers.length !== TRC_MARKERS.length) {
      throw new Error(`TRC marker count read as ${table.markers.length}`);
    }
    if (table.frames.length !== original.length) {
      throw new Error(
        `TRC frame count read as ${table.frames.length}, wrote ${original.length}`,
      );
    }
    const axis = detectVerticalAxis(table);
    const wanted = flipY ? "world-up" : "image-down";
    if (axis !== wanted) {
      throw new Error(`vertical axis detected as ${axis}, wrote ${wanted}`);
    }
    const adapted = halpe26ToPoseFrames(table, {
      width: W,
      height: H,
      verticalAxis: axis,
    });
    if (digest(analyzeLandings(adapted, opts)) !== expected) {
      throw new Error(
        `the adapter changed the report (flipY=${flipY}):\n  wrote  ${expected}\n  read   ${digest(analyzeLandings(adapted, opts))}`,
      );
    }
  }

  // Blank cells are a tracking gap, not a marker at the origin. A parser that
  // read them as 0,0 would put a foot in the corner of the frame and the
  // analysis would believe it.
  const gapped = writeTrc(original, false)
    .split("\n")
    .map((line, i) =>
      i === 8
        ? [
            line.split("\t")[0],
            line.split("\t")[1],
            ...Array(TRC_MARKERS.length * 3).fill(""),
          ].join("\t")
        : line,
    )
    .join("\n");
  const gappedTable = parseTrc(gapped);
  const gappedFrame = gappedTable.frames[8 - 5];
  if (gappedFrame && gappedFrame.points.some((point) => point !== null)) {
    throw new Error("a blank TRC row produced marker positions");
  }
  const gappedPoses = halpe26ToPoseFrames(gappedTable, {
    width: W,
    height: H,
    verticalAxis: "image-down",
  });
  if (gappedPoses[8 - 5]?.landmarks !== null) {
    throw new Error("a frame with no markers must adapt to a null pose");
  }

  // Markers are found by name, so the column order must not matter. Reversing
  // it has to leave the report untouched; the index-based mapping this
  // replaced would have produced a pose made of the wrong joints instead.
  const reversed = parseTrc(writeTrc(original, false, [...TRC_MARKERS].reverse()));
  const fromReversed = halpe26ToPoseFrames(reversed, {
    width: W,
    height: H,
    verticalAxis: "image-down",
  });
  if (digest(analyzeLandings(fromReversed, opts)) !== expected) {
    throw new Error("marker order changed the report — matching is positional");
  }

  // The small toes are the reason for the whole exercise, so their arrival is
  // checked rather than assumed: MediaPipe has no slot for them and they ride
  // in footExtras, from whatever column the file put them in.
  const withToes = halpe26ToPoseFrames(parseTrc(writeTrc(original, false)), {
    width: W,
    height: H,
    verticalAxis: "image-down",
  });
  const tracked = withToes.find((frame) => frame.landmarks);
  if (!tracked?.footExtras?.leftSmallToe || !tracked.footExtras.rightSmallToe) {
    throw new Error("small toes did not reach footExtras");
  }

  // Every joint the analysis reads needs a source in the file, or it silently
  // arrives at zero visibility. The exemptions are the face: HALPE_26 has no
  // mouth at all, and Sports2D does not write the eyes and ears even though
  // the keypoint set defines them — so no face box can be built from a TRC.
  // Offline comparison never draws one; a server path that wanted to would
  // have to get the face from somewhere else.
  const mapped = new Set(
    TRC_MARKERS.map((name) => MARKER_TO_MEDIAPIPE[markerKey(name)]).filter(
      (index): index is number => index !== undefined,
    ),
  );
  const exempt = new Set<number>([
    LM.mouthLeft,
    LM.mouthRight,
    LM.leftEye,
    LM.rightEye,
    LM.leftEar,
    LM.rightEar,
  ]);
  const unmapped = Object.entries(LM).filter(
    ([, index]) => !mapped.has(index) && !exempt.has(index),
  );
  if (unmapped.length) {
    throw new Error(
      `no TRC marker for ${unmapped.map(([name]) => name).join(", ")}`,
    );
  }

  // The flag has to do something, or a comparison would quietly include our
  // own smoothing on top of Sports2D's.
  const smoothed = analyzeLandings(original, opts);
  const asGiven = analyzeLandings(original, { ...opts, preFiltered: true });
  if (digest(smoothed) === digest(asGiven)) {
    throw new Error("preFiltered changed nothing — the flag is not wired");
  }

  // Bringing a Sports2D result into the browser. The refusals are the point:
  // every one of them exists because the alternative is a plausible wrong
  // answer rather than a visible failure.
  const CALIB = 'size = [ 720, 1280]\nmatrix = [ [ 1.0, 0.0, 360.0] ]\n';
  const named = (name: string, text: string) => ({ name, text });
  const trcText = writeTrc(original, false);
  const good = importTrc([
    named("clip_Sports2D_px_person00.trc", trcText),
    named("clip_Sports2D_calib.toml", CALIB),
  ]);
  if (!good.ok) throw new Error(`a complete pair was refused: ${good.reason}`);
  if (good.value.width !== 720 || good.value.height !== 1280) {
    throw new Error(
      `frame size read as ${good.value.width}x${good.value.height}, calib says 720x1280`,
    );
  }
  if (good.value.verticalAxis !== "image-down") {
    throw new Error(`axis read as ${good.value.verticalAxis}`);
  }

  // No calibration file means no frame size, and a guessed one tilts every
  // foot angle. It has to refuse rather than pick the video's usual shape.
  const noCalib = importTrc([named("clip_Sports2D_px_person00.trc", trcText)]);
  if (noCalib.ok) throw new Error("a TRC with no calib.toml was accepted");

  // The metre TRC sits in the same folder and is the easy file to grab. Taking
  // it would silently swap Sports2D's scale in for ours, which is a change we
  // mean to measure separately.
  const metre = importTrc([
    named("clip_Sports2D_m_person00.trc", trcText),
    named("clip_Sports2D_calib.toml", CALIB),
  ]);
  if (metre.ok) throw new Error("the metre TRC was accepted as the pixel one");
  if (!metre.reason.includes("_px_")) {
    throw new Error(`the metre refusal does not say what to pick: ${metre.reason}`);
  }

  // A file with no one tracked in it is a refusal, not an empty report.
  const emptyRows = trcText
    .split("\n")
    .map((line, i) =>
      i >= 5 && line.trim()
        ? [
            line.split("\t")[0],
            line.split("\t")[1],
            ...Array(TRC_MARKERS.length * 3).fill(""),
          ].join("\t")
        : line,
    )
    .join("\n");
  const nobody = importTrc([
    named("clip_Sports2D_px_person00.trc", emptyRows),
    named("clip_Sports2D_calib.toml", CALIB),
  ]);
  if (nobody.ok) throw new Error("a TRC with no tracked frames was accepted");

  // What the screen shows must come from the same import that produced the
  // frames, so the analysis and the provenance line cannot disagree.
  const imported = analyzeLandings(good.value.frames, {
    statureM: 1.7,
    massKg: 70,
    width: good.value.width,
    height: good.value.height,
    slowMotionFactor: 1,
    preFiltered: true,
  });
  if (!imported.landings.length) {
    throw new Error("an imported TRC produced no landings");
  }

  // Choosing between people. Sports2D writes a file per person it tracked and
  // its default ordering is `on_click`, which decides nothing in a run nobody
  // watched — on a race clip it wrote thirteen files and the walk's last match
  // was a spectator, which made a perfectly usable clip look like 4% tracked
  // and one landing. The count of frames a person appears in is what separates
  // the runner from somebody crossing the shot.
  const blanks = trcText
    .split("\n")
    .map((line, i) =>
      i >= 5 && line.trim() && i % 2 === 0
        ? [line.split("\t")[0], line.split("\t")[1], ...Array(TRC_MARKERS.length * 3).fill("")].join("\t")
        : line,
    )
    .join("\n");
  const whole = trackedFrameCount(parseTrc(trcText));
  const half = trackedFrameCount(parseTrc(blanks));
  if (!(whole > half && half > 0)) {
    throw new Error(`tracked frames counted ${whole} and ${half}; blanking half changed nothing`);
  }

  // Handed a whole Sports2D output folder — the easiest thing for a person to
  // do — only the two files that matter may be read. The folder also holds a
  // rendered video and a frame image per frame, and reading those as text
  // would stall the page for megabytes of nothing.
  const folder = [
    "clip_Sports2D_px_person00.trc",
    "clip_Sports2D_calib.toml",
    "clip_Sports2D_m_person00.trc",
    "clip_Sports2D.mp4",
    "clip_Sports2D_angles_person00.mot",
    "clip_Sports2D_img/clip_Sports2D_00042.png",
    "stride-lab.json",
  ];
  const candidates = folder.filter(isImportCandidate);
  if (candidates.length !== 4) {
    throw new Error(`folder filter kept ${candidates.join(", ")}`);
  }
  if (candidates.some((name) => /\.(mp4|png|mot)$/i.test(name))) {
    throw new Error("a video, image or mot file would have been read as text");
  }

  // The manifest is what lets the skeleton be drawn over the footage: a TRC
  // times itself from zero whatever part of the clip it covers, so without the
  // window start a run of seconds 5 to 8 lines up against the first three
  // seconds and looks plausible while being wrong.
  const withManifest = importTrc([
    named("clip_Sports2D_px_person00.trc", trcText),
    named("clip_Sports2D_calib.toml", CALIB),
    named(
      "stride-lab.json",
      JSON.stringify({ clip: "clip.mp4", start_s: 5, mode: "performance" }),
    ),
  ]);
  if (!withManifest.ok) throw new Error(`manifest refused: ${withManifest.reason}`);
  if (withManifest.value.clip !== "clip.mp4" || withManifest.value.startS !== 5) {
    throw new Error(
      `manifest read as ${withManifest.value.clip} @ ${withManifest.value.startS}`,
    );
  }

  // No manifest, or a broken one, is not a reason to refuse the numbers — it is
  // a reason not to claim which clip they came from. A start of zero here would
  // be a claim.
  if (good.value.clip !== null || good.value.startS !== 0) {
    throw new Error("a run with no manifest claimed a clip");
  }
  const broken = importTrc([
    named("clip_Sports2D_px_person00.trc", trcText),
    named("clip_Sports2D_calib.toml", CALIB),
    named("stride-lab.json", "{ not json"),
  ]);
  if (!broken.ok) throw new Error("a broken manifest refused the whole run");
  if (broken.value.clip !== null) throw new Error("a broken manifest was believed");

  // The window offset has to survive the round trip through the time mapping,
  // or the overlay sits on the wrong part of the clip.
  const videoAt = videoTimeFromAnalysis(2, 1, 5);
  if (videoAt !== 7) throw new Error(`analysis 2s at offset 5 mapped to ${videoAt}`);
  if (analysisTimeFromVideo(videoAt, 1, 5) !== 2) {
    throw new Error("the time mapping does not round-trip with an offset");
  }
  // Slow motion and the offset compose in the order the video sees them: the
  // clip is scaled, then the window starts somewhere.
  if (videoTimeFromAnalysis(2, 4, 5) !== 13) {
    throw new Error("offset and slow motion do not compose");
  }

  console.log("trc import ok", {
    size: `${good.value.width}x${good.value.height}`,
    tracked: `${good.value.trackedFrames}/${good.value.frames.length}`,
    landings: imported.landings.length,
    refusals: "calib 없음 · 미터 TRC · 추적 0",
    folder: `${folder.length}개 중 ${candidates.length}개만 읽음`,
    manifest: "클립·구간 시작 읽음 · 없거나 깨지면 주장하지 않음",
    people: `추적 프레임 ${whole} vs ${half} 로 사람 구분`,
  });

  console.log("sports2d adapter ok", {
    roundTrip: "image-down · world-up 모두 동일",
    markers: `${TRC_MARKERS.length}개 · 이름으로 매칭 (순서 무관)`,
    axis: "데이터에서 판별",
    smallToes: "footExtras 도달",
    landings: analyzeLandings(original, opts).landings.length,
    preFiltered: "동작",
  });
}

// Comparing two pose estimators over one clip. This is the measurement the
// whole Sports2D detour exists to make, so the ways it could quietly lie are
// what get pinned: pairing that shifts after a missed footfall, and a
// comparison across inputs that do not match.
{
  const W = 1280;
  const H = 720;
  const opts = { statureM: 1.7, massKg: 70, width: W, height: H };
  const frames = syntheticSideRunFrames({ ahead: 0.066 });
  const result = analyzeLandings(frames, opts);
  const tracked = frames.filter((frame) => frame.landmarks).length;

  const pass = (
    key: "browser" | "sports2d",
    over: Partial<PipelinePass> = {},
  ): PipelinePass => ({
    key,
    label: key,
    result,
    trackedFrames: tracked,
    totalFrames: frames.length,
    clip: "same-clip",
    windowS: 12,
    clockFactor: 1,
    ...over,
  });

  // A pass against itself must come out identical. If it does not, the table
  // reports estimator error where there is none, and every real reading after
  // that is unreadable.
  const self = comparePipelines(pass("browser"), pass("sports2d"));
  if (!self.comparable.ok) {
    throw new Error(`identical passes judged incomparable: ${self.comparable.reasons}`);
  }
  if (self.disagreements !== 0) {
    const off = self.rows.filter((row) => !row.agree && !row.note).map((row) => row.label);
    throw new Error(`a pass compared to itself disagreed on ${off.join(", ")}`);
  }
  if (self.paired.length !== result.landings.length) {
    throw new Error(
      `self-comparison paired ${self.paired.length} of ${result.landings.length}`,
    );
  }
  if (self.browserOnly.length || self.sports2dOnly.length) {
    throw new Error("a pass compared to itself left landings unpaired");
  }

  // The reason pairing is nearest-first. Drop one footfall from the middle:
  // walking both lists in order would pair every later contact with the wrong
  // partner and report a disagreement at each one. Only the dropped footfall
  // may come back unpaired.
  const all = result.landings;
  if (all.length < 5) throw new Error("the fixture needs enough landings to drop one");
  const dropAt = 2;
  const missing = all.filter((_, i) => i !== dropAt);
  const gapped = pairLandings(all, missing);
  if (gapped.paired.length !== missing.length) {
    throw new Error(
      `dropping one footfall paired ${gapped.paired.length} of ${missing.length}`,
    );
  }
  if (gapped.browserOnly.length !== 1 || gapped.sports2dOnly.length !== 0) {
    throw new Error(
      `a missed footfall left ${gapped.browserOnly.length} and ${gapped.sports2dOnly.length} unpaired`,
    );
  }
  if (gapped.browserOnly[0].tContact !== all[dropAt].tContact) {
    throw new Error("the unpaired landing is not the one that was dropped");
  }
  if (gapped.paired.some((pair) => pair.browser.tContact !== pair.sports2d.tContact)) {
    throw new Error("pairing drifted past the gap — it is walking in order");
  }

  // Contacts further apart than the window are different footfalls, not the
  // same one measured badly.
  const shifted = all.map((landing) => ({ ...landing, tContact: landing.tContact + 0.2 }));
  if (pairLandings(all, shifted).paired.length) {
    throw new Error("contacts 200ms apart were paired");
  }

  // Two different clips, or two different windows, must be refused as a
  // comparison even though every row still computes.
  const otherClip = comparePipelines(pass("browser"), pass("sports2d", { clip: "elsewhere" }));
  if (otherClip.comparable.ok) throw new Error("two different clips compared as one");
  const otherWindow = comparePipelines(pass("browser"), pass("sports2d", { windowS: 3 }));
  if (otherWindow.comparable.ok) throw new Error("3s and 12s windows compared as one");
  if (!otherWindow.comparable.reasons.length) {
    throw new Error("an incomparable pair gave no reason");
  }

  // The one that got through the first version of this check. A clip read as
  // eight-times slow motion covers the same footage on a clock eight times
  // slower: the source window matches to the second, and not one landing time
  // does. Real numbers from a real clip were compared this way before the
  // clock became part of the question.
  const otherClock = comparePipelines(
    pass("browser", { clockFactor: 8, windowS: 1.5 }),
    pass("sports2d"),
  );
  if (otherClock.comparable.ok) throw new Error("8x and 1x clocks compared as one");
  if (!otherClock.comparable.reasons.some((reason) => reason.includes("배속"))) {
    throw new Error(`the clock mismatch was not named: ${otherClock.comparable.reasons}`);
  }
  // And a clock mismatch alone, with the spans agreeing, must still refuse.
  const sneaky = comparePipelines(pass("browser", { clockFactor: 4 }), pass("sports2d"));
  if (sneaky.comparable.sameClock || sneaky.comparable.ok) {
    throw new Error("a clock mismatch passed when the windows agreed");
  }

  // Every strike the union allows gets counted, `unknown` included: an
  // estimator that cannot tell would otherwise have those landings disappear
  // from the table meant to show disagreement.
  const counts = strikeCounts(all);
  if (!("unknown" in counts)) throw new Error("strikeCounts drops unknown");
  const counted = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (counted !== all.length) {
    throw new Error(`strikeCounts totalled ${counted} of ${all.length}`);
  }

  console.log("pipeline compare ok", {
    self: `${self.paired.length}쌍 · 차이 0`,
    gap: "빠진 착지 1개만 미짝",
    refuses: "다른 클립 · 다른 구간 · 다른 배속",
    strikes: `${counted}회 전부 분류`,
  });
}

// What the frame rate takes out of the strike verdict, and which sampling
// window gets it back. The whole finding lives in tools/sports2d/strike-bias.ts,
// which nobody runs on a schedule, so the part that must not regress is here.
//
// The setting this pins down is not a preference. Ordinary phone video is
// 30 fps, one frame is 33 ms, and a rearfoot foot rotates to flat in about
// 40 ms — so a window that includes the sample after touchdown has already
// lost most of the angle it exists to measure, and it loses it toward zero,
// which is toward midfoot.
{
  const W = 1280;
  const H = 720;
  const opts = { statureM: 1.7, massKg: 70, width: W, height: H };

  /** The hardest honest condition: the foot still settling, and noisy points. */
  const hard = { swingDriftDeg: -6, jitterPx: 3, flattenS: 0.04, ahead: 0.066 };

  const read = (strikeDeg: number, fps: number, sampling: StrikeAngleSampling) => {
    const frames = syntheticSideRunFrames({
      ...hard,
      fps,
      strikeDeg,
      aspect: W / H,
    });
    const result = analyzeLandings(frames, { ...opts, strikeAngleSampling: sampling });
    const angles = result.landings
      .map((landing) => landing.footStrikeAngleDeg)
      .filter(Number.isFinite);
    return {
      mean: angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : Number.NaN,
      correct: result.landings.filter((landing) => landing.footStrike === want(strikeDeg))
        .length,
      judged: result.landings.filter((landing) => landing.footStrike !== "unknown").length,
    };
  };

  function want(strikeDeg: number): FootStrike {
    if (strikeDeg <= threshold("foot_strike_rearfoot_max_deg")) return "rearfoot";
    if (strikeDeg >= threshold("foot_strike_forefoot_min_deg")) return "forefoot";
    return "midfoot";
  }

  // The fixture has to be capable of the thing being measured, or every
  // assertion below passes for the wrong reason. At 240 fps the grid is not the
  // limiting factor and the angle should come back close to what went in.
  const truth = read(-18, 240, "around");
  if (!(Math.abs(truth.mean + 18) < 4)) {
    throw new Error(`the fixture does not reproduce -18° at 240 fps: ${truth.mean}`);
  }

  // The defect, stated as a measurement. A ten-degree rearfoot contact — an
  // ordinary one — is reported as midfoot at 30 fps by the window that reads
  // either side of contact.
  const around10 = read(-10, 30, "around");
  if (around10.correct !== 0) {
    throw new Error(
      `around now judges -10° at 30fps correctly ${around10.correct} times; if that is` +
        " a real improvement, this test and the default it guards should change together",
    );
  }

  // And the fix, stated the same way. Reading the largest inclination in the
  // 50 ms before contact recovers every verdict in this sweep.
  for (const strikeDeg of [-18, -10, 0, 12]) {
    const peak = read(strikeDeg, 30, "peak");
    if (peak.correct !== peak.judged || peak.judged === 0) {
      throw new Error(
        `peak got ${peak.correct}/${peak.judged} right at ${strikeDeg}° (mean ${peak.mean.toFixed(1)}°)`,
      );
    }
  }

  // Peak's own failure mode, bounded rather than denied. It takes an extreme,
  // so a foot still rotating during late swing lends it a couple of degrees in
  // the direction of that rotation — visible here as a midfoot contact reading
  // slightly rearfoot. It has to stay well inside the band, or the fix would
  // invent a strike pattern where there is none.
  const flat = read(0, 30, "peak");
  const band = threshold("foot_strike_forefoot_min_deg");
  if (!(Math.abs(flat.mean) < band / 2)) {
    throw new Error(
      `peak reads a flat foot as ${flat.mean.toFixed(1)}°, over half the ${band}° band`,
    );
  }

  // Sampling has to matter at 30 fps and stop mattering once the grid is fine
  // enough, which is the claim that the frame rate is at fault rather than the
  // window being a lucky guess.
  //
  // Asked on a still foot, and that qualification is the point. With the foot
  // still rotating in late swing the two windows disagree at every frame rate,
  // because `peak` deliberately looks back 50 ms and the foot really was at a
  // different angle there — at 240 fps that is twelve samples of drift, not
  // one. That is the design working, so measuring convergence against it would
  // be measuring the drift instead.
  const still = (fps: number, sampling: StrikeAngleSampling) => {
    const frames = syntheticSideRunFrames({
      flattenS: 0.04,
      ahead: 0.066,
      fps,
      strikeDeg: -18,
      aspect: W / H,
    });
    const angles = analyzeLandings(frames, { ...opts, strikeAngleSampling: sampling })
      .landings.map((landing) => landing.footStrikeAngleDeg)
      .filter(Number.isFinite);
    return angles.reduce((a, b) => a + b, 0) / (angles.length || 1);
  };
  const fine = Math.abs(still(240, "around") - still(240, "peak"));
  const coarse = Math.abs(still(30, "around") - still(30, "peak"));
  if (fine > 3) {
    throw new Error(`at 240 fps on a still foot the windows disagree by ${fine.toFixed(1)}°`);
  }
  if (coarse < fine + 3) {
    throw new Error(
      `sampling barely matters at 30 fps (${coarse.toFixed(1)}° vs ${fine.toFixed(1)}°)` +
        " — the frame grid is no longer the thing this guards against",
    );
  }

  // The default itself, so it cannot drift back without this failing. Pinned
  // by behaviour rather than by reading the constant: what matters is which
  // window an ordinary call gets.
  const byDefault = read(-18, 30, undefined as unknown as StrikeAngleSampling);
  const asBefore = read(-18, 30, "before");
  const asAround = read(-18, 30, "around");
  if (Math.abs(byDefault.mean - asBefore.mean) > 0.01) {
    throw new Error(
      `the default window reads ${byDefault.mean.toFixed(1)}° where 'before' reads` +
        ` ${asBefore.mean.toFixed(1)}° — the default is no longer 'before'`,
    );
  }
  if (Math.abs(byDefault.mean - asAround.mean) < 1) {
    throw new Error("the default is indistinguishable from 'around'");
  }

  console.log("strike sampling ok", {
    truth: `240fps ${truth.mean.toFixed(1)}°`,
    around: `30fps -10° → ${around10.mean.toFixed(1)}° · 정답 0`,
    peak: `30fps 전 구간 정답 · 평평한 발 ${flat.mean.toFixed(1)}°`,
    default: `before (${byDefault.mean.toFixed(1)}°) · around 이 아님 (${asAround.mean.toFixed(1)}°)`,
    grid: `표본창 차이 30fps ${coarse.toFixed(1)}° · 240fps ${fine.toFixed(1)}°`,
  });
}

// One foot never accounted for, and everything that quietly followed from it.
//
// A real clip put this on screen: twenty-four contacts, twenty of them on the
// same foot, no contact time for any of them, three pairs of identical
// readings a third of a step apart — and the quality gate called it `fair`.
//
// The consequence is not a mislabelled side. The strike angle is read from
// whichever foot's series the side names, so a wrong side does not mislabel
// the answer, it answers about the other foot; the report was publishing
// plausible angles for feet that were never measured.
//
// The fixture holds one foot in the air. Contacts are still found — they come
// from the body's own acceleration, not from the feet — and every one of them
// is assigned to the foot that is down. Whether that is an estimator that lost
// a leg or a clip of somebody hopping does not change what the analysis may
// say about it.
{
  const W = 1280;
  const H = 720;
  const opts = { statureM: 1.7, massKg: 70, width: W, height: H };
  const clean = syntheticSideRunFrames({ ahead: 0.066, strikeDeg: -12, aspect: W / H });

  const oneFooted = (frames: PoseFrame[]) =>
    frames.map((frame) => ({
      ...frame,
      landmarks: frame.landmarks
        ? frame.landmarks.map((point, index) =>
            index === LM.leftHeel || index === LM.leftAnkle || index === LM.leftFootIndex
              ? // Parked at mid-thigh height, well clear of the ground line.
                { ...point, y: 0.62 }
              : point,
          )
        : null,
    }));

  const before = analyzeLandings(clean, opts);
  const after = analyzeLandings(oneFooted(clean), opts);

  // Counted on the channel, not on the published side. From the side the app
  // does not claim a side at all, so a check written on `side` would now be
  // reading `unknown` for every contact and would pass by measuring nothing.
  const share = (result: ReturnType<typeof analyzeLandings>) => {
    const named = result.landings.filter((l) => l.footChannel !== "unknown");
    const left = named.filter((landing) => landing.footChannel === "left").length;
    return named.length ? Math.min(left, named.length - left) / named.length : Number.NaN;
  };

  // The fixture has to actually produce the lopsided reading, or the assertions
  // below pass because nothing happened.
  if (!(share(after) < threshold("min_foot_channel_share"))) {
    throw new Error(
      `one foot in the air left the channels balanced at ${share(after).toFixed(2)} —` +
        " the fixture no longer reproduces the failure this guards against",
    );
  }
  if (after.landings.length < 6) {
    throw new Error(`only ${after.landings.length} contacts, below where the check looks`);
  }
  if (after.quality.level !== "poor") {
    throw new Error(`a clip with one foot unaccounted for is graded ${after.quality.level}`);
  }
  if (!after.quality.reasons.some((reason) => reason.includes("한쪽 발"))) {
    throw new Error(
      `nothing says a foot went missing: ${after.quality.reasons.join(" / ")}`,
    );
  }

  // And it must not fire on a runner whose feet were both seen, or every clip
  // arrives refused.
  if (before.quality.reasons.some((reason) => reason.includes("한쪽 발"))) {
    throw new Error("a two-footed clip was accused of losing a foot");
  }
  if (before.quality.level === "poor") {
    throw new Error("the clean fixture is now graded poor");
  }

  // Below six contacts the count skews on which foot started and finished, so
  // the check stays quiet rather than refusing a short clip on arithmetic.
  const short = analyzeLandings(
    oneFooted(syntheticSideRunFrames({ ahead: 0.066, steps: 3, aspect: W / H })),
    opts,
  );
  if (short.quality.reasons.some((reason) => reason.includes("한쪽 발"))) {
    throw new Error(
      `a ${short.landings.length}-contact clip was judged on side balance`,
    );
  }

  // The published side is a separate question from the channel, and the point
  // of separating them is that the angle survives while the name does not.
  // A side-on clip must claim no side and still measure every strike.
  if (before.landings.some((landing) => landing.side !== "unknown")) {
    throw new Error("a side-on clip claimed which foot a contact was");
  }
  const measured = before.landings.filter((landing) =>
    Number.isFinite(landing.footStrikeAngleDeg),
  ).length;
  if (measured < before.landings.length - 1) {
    throw new Error(
      `dropping the side cost the angle: ${measured}/${before.landings.length} measured`,
    );
  }

  console.log("one-footed clip ok", {
    clean: `${before.landings.length}회 · 소수쪽 채널 ${(share(before) * 100).toFixed(0)}% · ${before.quality.level} · 각도 ${measured}회`,
    oneFooted: `${after.landings.length}회 · 소수쪽 채널 ${(share(after) * 100).toFixed(0)}% · ${after.quality.level}`,
    short: `${short.landings.length}회 · 판단 보류`,
  });
}

// Saying the strike angle with the doubt that belongs to it.
//
// The reading is anchored on a frame, and measurement says that frame is not
// reliably the one the foot landed on: the detected contact runs one to two
// frames late against the start of the foot's height plateau, and the angle
// moves fifteen to twenty-nine degrees across the frames around touchdown. The
// midfoot category is sixteen degrees wide, so one frame of doubt can span it
// whole. Printing a bare angle claims a precision the frame rate does not
// support, and printing a bare category claims more than that.
{
  const band = threshold("foot_strike_forefoot_min_deg");

  // Inside a category with room to spare: one name, and the doubt shown.
  if (!strikeAngleSettles(20, 3)) throw new Error("+20° ±3° should settle on forefoot");
  if (strikeAngleSpan(20, 3).join() !== "forefoot") {
    throw new Error(`+20° ±3° spans ${strikeAngleSpan(20, 3).join("/")}`);
  }

  // Straddling a boundary: two names, because a frame either way would have
  // been reported as a different strike.
  const straddling = strikeAngleSpan(band - 1, 4);
  if (straddling.length !== 2 || !straddling.includes("forefoot")) {
    throw new Error(`just under the forefoot line spans ${straddling.join("/")}`);
  }
  if (strikeAngleSettles(band - 1, 4)) {
    throw new Error("an angle a frame away from another category was called settled");
  }

  // The case the reference clips actually produce: doubt wider than the whole
  // midfoot band, which cannot name a category at all.
  const wide = strikeAngleSpan(0, band * 2);
  if (wide.length !== 3) {
    throw new Error(`doubt of ±${band * 2}° spans only ${wide.join("/")}`);
  }

  // No doubt figure is not the same as no doubt. A missing uncertainty must
  // not silently widen or narrow the span.
  if (strikeAngleSpan(20, Number.NaN).join() !== "forefoot") {
    throw new Error("a missing uncertainty changed the span");
  }
  if (formatStrikeAngleWithDoubt(20, "forefoot", Number.NaN).includes("±")) {
    throw new Error("a missing uncertainty printed a ±");
  }
  if (!formatStrikeAngleWithDoubt(20, "forefoot", 4.4).includes("±4°")) {
    throw new Error(
      `the doubt is not shown: ${formatStrikeAngleWithDoubt(20, "forefoot", 4.4)}`,
    );
  }
  // A refused strike says so rather than saying so with a tolerance.
  if (formatStrikeAngleWithDoubt(Number.NaN, "unknown", 4) !== "측정 불가") {
    throw new Error("an unmeasured angle was given a tolerance");
  }

  // And the analysis has to produce the figure at all, on a fixture whose
  // angle is deliberately moving through touchdown.
  const moving = analyzeLandings(
    syntheticSideRunFrames({
      ahead: 0.066,
      fps: 30,
      strikeDeg: -14,
      flattenS: 0.04,
      aspect: 1280 / 720,
    }),
    { statureM: 1.7, massKg: 70, width: 1280, height: 720 },
  );
  const withDoubt = moving.landings.filter((landing) =>
    Number.isFinite(landing.footStrikeAngleUncertaintyDeg),
  );
  if (withDoubt.length < moving.landings.length / 2) {
    throw new Error(
      `only ${withDoubt.length} of ${moving.landings.length} landings carry a doubt figure`,
    );
  }
  if (!withDoubt.some((landing) => landing.footStrikeAngleUncertaintyDeg > 1)) {
    throw new Error("a foot rotating through touchdown reported no doubt at all");
  }

  console.log("strike doubt ok", {
    settles: "+20° ±3° → 포어풋",
    straddles: `±4° at ${band - 1}° → ${straddling.length}개 카테고리`,
    wide: `±${band * 2}° → ${wide.length}개`,
    fixture: `${withDoubt.length}/${moving.landings.length} 착지에 ±값`,
  });
}

// Telling a wrong capture rate from a failed detection.
//
// Real-time footage came back advised to reanalyse at four times slow, on a
// clip whose cadence at real time was 181 spm — a perfectly human number.
// Following it would have divided every timing by four and made the report
// worse. Three of six test clips had their strike verdicts withheld through
// this one path, because the advice also grades the clip `poor`.
//
// The cause was a scoring function in which the terms that depend on finding
// the start and end of stance outweigh the term that does not. Those are the
// first to fail when the feet are poorly tracked, and once they have failed a
// wrong factor can win by dividing the broken numbers into a plausible-looking
// window. Contact spacing does not fail the same way: a missed toe-off costs a
// stance, not a step. So it gates rather than scores.
{
  const W = 1280;
  const H = 720;
  const opts = { statureM: 1.7, massKg: 70, width: W, height: H };

  // Real-time running, with the feet made unreliable enough that stance cannot
  // be timed — which is the state the misdiagnosis needs.
  const realTime = syntheticSideRunFrames({ ahead: 0.066, fps: 30, aspect: W / H });
  const shaky = realTime.map((frame, i) => ({
    ...frame,
    landmarks: frame.landmarks
      ? frame.landmarks.map((point, index) =>
          index === LM.leftHeel ||
          index === LM.rightHeel ||
          index === LM.leftFootIndex ||
          index === LM.rightFootIndex
            ? { ...point, y: point.y + (i % 2 ? 0.012 : -0.012) }
            : point,
        )
      : null,
  }));

  const asShot = analyzeLandingsAuto(shaky, { ...opts, slowMotionFactor: 1 });
  const cadence = cadenceSpm(asShot.result.landings);
  // The fixture has to put cadence in the human band, or the guard being tested
  // is not the thing deciding the outcome.
  if (!(cadence >= 140 && cadence <= 220)) {
    throw new Error(`the fixture's cadence is ${cadence.toFixed(0)} spm, outside the band`);
  }
  if (asShot.suggestedFactor) {
    throw new Error(
      `real-time footage at ${cadence.toFixed(0)} spm was told to try` +
        ` ${asShot.suggestedFactor}x slow motion`,
    );
  }

  // And the other direction has to keep working, or the guard has simply
  // switched the capture-rate detection off. Footage shot at 240 and played
  // back at 30 is genuinely eight times slow, and reading it as real time puts
  // the step outside what a person can take.
  const slow = syntheticSideRunFrames({ ahead: 0.066, fps: 30, aspect: W / H }).map(
    (frame, i) => ({ ...frame, t: i / 30 * 8 }),
  );
  const misread = analyzeLandingsAuto(slow, { ...opts, slowMotionFactor: 1 });
  if (!misread.suggestedFactor || misread.suggestedFactor <= 1) {
    throw new Error(
      "eight-times slow motion read as real time produced no suggestion to change",
    );
  }

  console.log("capture rate ok", {
    realTime: `${cadence.toFixed(0)} spm · 제안 없음`,
    slowMotion: `제안 ${misread.suggestedFactor}배`,
  });
}
