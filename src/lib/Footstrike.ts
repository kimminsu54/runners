export type FootStrike = "rearfoot" | "midfoot" | "forefoot" | "unknown";
export type CameraView = "side" | "front" | "unknown";

/** Inclusive. 40° still classifies; 40.1° is unknown. */
export const MAX_PLAUSIBLE_ANGLE_DEG = 40;

/** Inclusive: exactly -8° is rearfoot. */
export const REARFOOT_MAX_ANGLE_DEG = -8;

/** Inclusive: exactly +8° is forefoot. */
export const FOREFOOT_MIN_ANGLE_DEG = 8;

/**
 * There is no confidence grade here on purpose. The old one split classified
 * strikes into "high" / "medium" at 4 / 15 / 35 degrees, thresholds with no
 * documented source that nothing ever displayed, and its "low" was returned
 * only where the type was already "unknown" — so every caller's
 * `confidence !== "low"` check merely repeated `type !== "unknown"`. What the
 * function can honestly say is whether it could classify at all.
 */
export function classifyFootStrike(
  angleDeg: number,
  view: CameraView = "side",
): { type: FootStrike } {
  // Rule §3: a frontal clip cannot read heel–toe angle.
  if (view !== "side") return { type: "unknown" };
  // NaN loses every comparison, so a missing landmark would otherwise fall
  // through to midfoot. Outer bands are classified first: a midfoot-first
  // `angle <= 8` would swallow the +8° forefoot edge.
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) > MAX_PLAUSIBLE_ANGLE_DEG) {
    return { type: "unknown" };
  }
  if (angleDeg <= REARFOOT_MAX_ANGLE_DEG) return { type: "rearfoot" };
  if (angleDeg >= FOREFOOT_MIN_ANGLE_DEG) return { type: "forefoot" };
  return { type: "midfoot" };
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
