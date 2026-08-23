import {
  assertDetectsLanding,
  assertDetectsRunningSteps,
} from "./synthetic-jump";

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
