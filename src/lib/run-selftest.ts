import { analyzeLandings } from "./landing-analysis";
import { buildSessionSummary } from "./session-summary";
import {
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

const running = analyzeLandings(syntheticRunningFrames(), {
  statureM: 1.7,
  massKg: 70,
  width: 1280,
  height: 720,
});
const session = buildSessionSummary(running);
if (!session.headline || session.paragraphs.length < 3) {
  throw new Error("expected a multi-sentence session summary");
}
if (session.metrics.length < 4) {
  throw new Error("expected aggregated session metrics");
}
console.log("session summary ok", session.headline, session.metrics[0]);
