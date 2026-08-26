export type FootStrike = "rearfoot" | "midfoot" | "forefoot" | "unknown";
export type StrikeConfidence = "high" | "medium" | "low";

export function classifyFootStrike(angleDeg: number): {
  type: FootStrike;
  confidence: StrikeConfidence;
} {
  // NaN loses every comparison, so a missing landmark would otherwise fall
  // through to midfoot. Outer bands are classified first: a midfoot-first
  // `angle <= 8` would swallow the +8° forefoot edge.
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) > 40) {
    return { type: "unknown", confidence: "low" };
  }
  let type: FootStrike;
  if (angleDeg <= -8) type = "rearfoot";
  else if (angleDeg >= 8) type = "forefoot";
  else type = "midfoot";
  const magnitude = Math.abs(angleDeg);
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
