export type FootStrike = "rearfoot" | "midfoot" | "forefoot" | "unknown";
export type StrikeConfidence = "high" | "medium" | "low";
export type CameraView = "side" | "front" | "unknown";

/** Inclusive. 40° still classifies; 40.1° is unknown. */
export const MAX_PLAUSIBLE_ANGLE_DEG = 40;

/** Inclusive: exactly -8° is rearfoot. */
export const REARFOOT_MAX_ANGLE_DEG = -8;

/** Inclusive: exactly +8° is forefoot. */
export const FOREFOOT_MIN_ANGLE_DEG = 8;

export function classifyFootStrike(
  angleDeg: number,
  view: CameraView = "side",
): {
  type: FootStrike;
  confidence: StrikeConfidence;
} {
  // Rule §3: a frontal clip cannot read heel–toe angle.
  if (view !== "side") {
    return { type: "unknown", confidence: "low" };
  }
  // NaN loses every comparison, so a missing landmark would otherwise fall
  // through to midfoot. Outer bands are classified first: a midfoot-first
  // `angle <= 8` would swallow the +8° forefoot edge.
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) > MAX_PLAUSIBLE_ANGLE_DEG) {
    return { type: "unknown", confidence: "low" };
  }
  let type: FootStrike;
  if (angleDeg <= REARFOOT_MAX_ANGLE_DEG) type = "rearfoot";
  else if (angleDeg >= FOREFOOT_MIN_ANGLE_DEG) type = "forefoot";
  else type = "midfoot";
  const magnitude = Math.abs(angleDeg);
  // 4 / 15 / 35 are display-only confidence bands; source is not documented.
  const confidence: StrikeConfidence =
    type === "midfoot"
      ? magnitude <= 4
        ? "high"
        : "medium"
      : magnitude >= 15 && magnitude <= 35
        ? "high"
        : "medium";
  return { type, confidence };
}

export function summarizeFootStrikes(
  strikes: Array<{ type: FootStrike }>,
): {
  known: number;
  counts: Record<Exclude<FootStrike, "unknown">, number>;
  percents: Record<Exclude<FootStrike, "unknown">, number>;
} {
  const counts = { rearfoot: 0, midfoot: 0, forefoot: 0 };
  for (const strike of strikes) {
    if (strike.type === "unknown") continue;
    counts[strike.type] += 1;
  }
  const known = counts.rearfoot + counts.midfoot + counts.forefoot;
  const percent = (count: number) =>
    known === 0 ? 0 : Math.round((count / known) * 100);
  return {
    known,
    counts,
    percents: {
      rearfoot: percent(counts.rearfoot),
      midfoot: percent(counts.midfoot),
      forefoot: percent(counts.forefoot),
    },
  };
}
