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
import {
  analyzeLandings,
  analyzeLandingsAuto,
  cadenceSpm,
  classifyFootStrike,
  clampedPeakGrfBw,
  formatFootAhead,
  formatFootAheadRatio,
  formatKneeFlexDeg,
  formatLoadingRateBwS,
  formatStrikeAngleDeg,
  formatTimingMs,
  landingLoadScore,
  overstrideVerdict,
  overstrideVerdictOrWithheld,
  peakForceFromDuty,
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
  assertDetectsLanding,
  assertDetectsRunningSteps,
  syntheticRunningFrames,
} from "./synthetic-jump";
import { liveMomentAt } from "./live-readout";
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
for (const label of ["평균 반력", "평균 점수", "접지 / 체공"] as const) {
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
  "dominantStrike" | "strikeCounts" | "pace" | "meanPeakGrfBw" | "patterns"
> {
  return {
    dominantStrike: "midfoot",
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

// --- per-side breakdown -----------------------------------------------------
if (!realSummary.sides) {
  throw new Error("a two-footed run must produce per-side stats");
}
{
  const { left, right, unassigned } = realSummary.sides;
  // Nothing may vanish: a landing the tracker could not assign is counted, not
  // dropped, so the table can never disagree with the landing count above it.
  if (left.count + right.count + unassigned !== realTime.landings.length) {
    throw new Error(
      `sides must account for every landing: ${left.count} + ${right.count} + ${unassigned} of ${realTime.landings.length}`,
    );
  }
  if (unassigned < 0) throw new Error("unassigned landings cannot be negative");
  for (const [name, side] of [["left", left], ["right", right]] as const) {
    if (!Number.isFinite(side.meanPeakGrfBw) || !Number.isFinite(side.meanScore)) {
      throw new Error(`${name} side lost its numbers`);
    }
  }
}
// A poor clip publishes no numbers, per side included.
if (poorSummary.sides?.left.meanPeakGrfBw !== undefined) {
  const blanked = poorSummary.sides === null || !Number.isFinite(poorSummary.sides.left.meanPeakGrfBw);
  if (!blanked) throw new Error("a poor clip must not publish per-side numbers");
}
console.log("side breakdown ok", {
  left: realSummary.sides.left.count,
  right: realSummary.sides.right.count,
  unassigned: realSummary.sides.unassigned,
  landings: realTime.landings.length,
});

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
