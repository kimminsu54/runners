import {
  analyzeLandings,
  analyzeLandingsAuto,
  cadenceSpm,
  classifyFootStrike,
  clampedPeakGrfBw,
  formatTimingMs,
  landingLoadScore,
  peakForceFromDuty,
  quantizeMs,
} from "./landing-analysis";
import { buildSessionSummary, paceLabel, type SessionSummary } from "./session-summary";
import {
  PRIORITY_BRANDS,
  isPreferredBrand,
  listShoes,
  recommendShoes,
  shoeImageSrc,
  shoeSlug,
  type MatchedShoeRecommendation,
  type ShoeRecommendation,
} from "./shoes";
import {
  analyzeSyntheticRun,
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
if (catalog.length !== 104) {
  throw new Error(`expected 104 shoes, got ${catalog.length}`);
}
if (!catalog.some((shoe) => shoe.brand === "Nike" && shoe.model === "Pegasus 40")) {
  throw new Error("catalog is missing a known daily trainer");
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

console.log("shoe photos ok", {
  primary: syntheticRec.picks.map((pick) => shoeImageSrc(pick.shoe)),
  secondary: syntheticRec.secondaryPicks.map((pick) => shoeImageSrc(pick.shoe)),
});
