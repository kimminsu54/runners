/**
 * The one way the app reads a judgement threshold.
 *
 * Every number that decides what the screen says about a run — the foot-strike
 * bands, the quality gates, the physiological windows, the score bands — comes
 * from `shared/thresholds.yaml` through here, carrying the reason it holds that
 * value and how far that reason goes. Before this layer the numbers were bare
 * literals scattered across the analysis: each was explained in a comment, but
 * a comment cannot be shown to the person reading the result, and nothing
 * distinguished a value that reflects reported running measurements from one
 * this project simply chose.
 *
 * `withheld` is the part that does work rather than describe it. A threshold
 * with no running-specific basis must not produce a verdict at all, so
 * `isPublishable` returns false for it and the caller shows the raw measurement
 * with "판정 보류" instead of a classification. That is the difference between
 * admitting a limit and papering over it.
 */

import {
  THRESHOLDS,
  THRESHOLDS_VERSION,
  type ThresholdKey,
  type ThresholdRecord,
  type ValidationStatus,
} from "@/lib/thresholds.generated";

export { THRESHOLDS, THRESHOLDS_VERSION };
export type { ThresholdKey, ThresholdRecord, ValidationStatus };

/** The numeric value. Unknown keys are a programming error, not a fallback. */
export function threshold(key: ThresholdKey): number {
  return THRESHOLDS[key].value;
}

export function evidence(key: ThresholdKey): ThresholdRecord {
  return THRESHOLDS[key];
}

export function evidenceFor(keys: readonly ThresholdKey[]): ThresholdRecord[] {
  return keys.map((key) => THRESHOLDS[key]);
}

/**
 * Whether a judgement resting on this threshold may be shown as a judgement.
 * False only for `withheld` — a value with no running basis. The measurement
 * itself can still be displayed; the verdict drawn from it cannot.
 */
export function isPublishable(key: ThresholdKey): boolean {
  return THRESHOLDS[key].validationStatus !== "withheld";
}

export const WITHHELD_LABEL = "판정 보류";

export const validationLabel: Record<ValidationStatus, string> = {
  literature: "보고된 측정 범위",
  derived: "계산으로 유도",
  convention: "현장 관행",
  internal: "자체 기준",
  withheld: "근거 없음 · 판정 보류",
};

/**
 * One sentence per status, for the evidence table. Written to be readable by
 * someone who did not ask what "validation status" means: it says what they can
 * lean on the number for.
 */
export const validationMeaning: Record<ValidationStatus, string> = {
  literature: "보고된 러닝 측정 범위를 반영한 값입니다. 특정 논문 한 편을 인용하지는 않았습니다.",
  derived: "위 근거값에서 계산으로 나온 값입니다.",
  convention: "현장에서 널리 쓰이는 경계입니다. 이 앱이 공개 데이터셋과 대조하지는 않았습니다.",
  internal: "이 앱이 정하고 자체 픽스처로만 확인한 값입니다. 다른 도구의 숫자와 다를 수 있습니다.",
  withheld: "러닝에서 검증된 기준이 없어, 이 값으로 판정을 내리지 않고 측정값만 보여 줍니다.",
};

export function formatThresholdValue(record: ThresholdRecord): string {
  const rounded =
    Math.abs(record.value) >= 1 || record.value === 0
      ? String(record.value)
      : record.value.toFixed(2).replace(/0$/, "");
  switch (record.unit) {
    case "deg":
      return `${record.value > 0 ? "+" : ""}${rounded}°`;
    // A magnitude bound rather than a signed boundary: ±40°, not +40°.
    case "deg_abs":
      return `±${Math.abs(record.value)}°`;
    case "s":
      return `${rounded} s`;
    case "BW":
      return `${rounded} BW`;
    case "score":
      return `${rounded}점`;
    case "ratio":
      return `${Math.round(record.value * 100)}%`;
    default:
      return rounded;
  }
}
