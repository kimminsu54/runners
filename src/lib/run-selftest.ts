import { analyzeLandingsAuto } from "./landing-analysis";
import { buildSessionSummary, paceLabel } from "./session-summary";
import {
  analyzeSyntheticRun,
  assertDetectsLanding,
  assertDetectsRunningSteps,
  syntheticRunningFrames,
} from "./synthetic-jump";
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

const slow = buildSessionSummary(
  analyzeSyntheticRun({ contactS: 0.31, flightS: 0.05 }),
);
const fast = buildSessionSummary(
  analyzeSyntheticRun({ contactS: 0.13, flightS: 0.14 }),
);
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
if (!(fast.meanPeakGrfBw > slow.meanPeakGrfBw * 1.35)) {
  throw new Error(
    `fast pace should load much harder: slow ${slow.meanPeakGrfBw} vs fast ${fast.meanPeakGrfBw}`,
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
if (slow.meanPeakGrfBw > 2.4) {
  throw new Error(`slow jogging should stay near 2 BW, got ${slow.meanPeakGrfBw}`);
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
