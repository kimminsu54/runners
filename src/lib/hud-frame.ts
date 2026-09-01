/**
 * What the exported still says.
 *
 * Kept apart from the drawing so the choice of what appears can be tested
 * without a canvas — and because the choice is the interesting part. The export
 * has to obey the same rule as the screen: it may only carry numbers this clip
 * could actually produce. A frontal frame that printed a strike pattern, or a
 * poor-quality one that printed a force, would be worse than the screen it came
 * from, because a saved image outlives the caveats around it.
 */

import {
  compareHint,
  footStrikeLabel,
  formatFootAhead,
  formatKneeFlexDeg,
  formatKneeValgusDeg,
  formatLoadingRateBwS,
  formatPelvicDropDeg,
  formatSeconds,
  formatStrikeAngleDeg,
  formatTimingMs,
  riskLabel,
  type AnalysisResult,
  type Landing,
} from "@/lib/landing-analysis";

export type HudRow = { label: string; value: string };

export type HudFrame = {
  title: string;
  subtitle: string;
  badge: string;
  rows: HudRow[];
  hint: string;
  note: string;
};

/** The one line that has to survive being separated from the app. */
export const HUD_NOTE =
  "영상 기반 2D 추정입니다. 힘판·IMU 측정과 다르며 의료 진단이나 훈련 처방이 아닙니다.";

export function buildHudFrame(
  result: AnalysisResult,
  landing: Landing,
  order: number,
): HudFrame {
  const trusted = result.quality.level !== "poor";
  const front = result.cameraView === "front";

  const rows: HudRow[] = [];
  if (!front) {
    rows.push({
      label: "착지 주법",
      value:
        trusted && landing.footStrike !== "unknown"
          ? `${footStrikeLabel[landing.footStrike]} · ${formatStrikeAngleDeg(
              landing.footStrikeAngleDeg,
              landing.footStrike,
            )}`
          : "판정 불가",
    });
  }
  rows.push({
    label: "추정 최대 반력",
    value: trusted ? `${landing.peakGrfBw.toFixed(1)} BW` : "측정 불가",
  });
  rows.push({
    label: "부하율",
    value: trusted ? formatLoadingRateBwS(landing.loadingRateBwS) : "측정 불가",
  });
  rows.push({
    label: "접지 · 체공",
    value:
      trusted && landing.gaitBased
        ? `${formatTimingMs(landing.contactMs)} · ${formatTimingMs(landing.flightMs)}`
        : "측정 불가",
  });

  if (front) {
    // The frontal pair, and only those: knee flexion from this view bends along
    // the camera axis, so it is not merely missing but unmeasurable.
    rows.push({
      label: "무릎 정렬",
      value: trusted ? formatKneeValgusDeg(landing.kneeValgusDeg) : "측정 불가",
    });
    rows.push({
      label: "골반 기울기",
      value: trusted ? formatPelvicDropDeg(landing.pelvicDropDeg) : "측정 불가",
    });
  } else {
    rows.push({
      label: "접지 순간 무릎",
      value: trusted ? formatKneeFlexDeg(landing.kneeFlexContact) : "측정 불가",
    });
    rows.push({
      label: "몸 앞 착지",
      value: trusted ? formatFootAhead(landing.footAheadM) : "측정 불가",
    });
  }

  return {
    title: `착지 ${order}`,
    subtitle: front
      ? `${formatSeconds(landing.tContact)} · 정면 촬영`
      : `${formatSeconds(landing.tContact)} · 옆모습 촬영`,
    badge: trusted ? `점수 ${landing.damageScore} · ${riskLabel(landing.risk)}` : "측정 참고용",
    rows,
    hint: trusted
      ? compareHint(landing.damageScore)
      : "촬영 조건이 부족해 충격을 평가하지 않았습니다.",
    note: HUD_NOTE,
  };
}
