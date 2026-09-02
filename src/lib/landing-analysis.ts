import {
  classifyFootStrike,
  FOREFOOT_MIN_ANGLE_DEG,
  REARFOOT_MAX_ANGLE_DEG,
  type CameraView,
  type FootStrike,
} from "@/lib/Footstrike";
import {
  distPx,
  frontalKneeValgusDeg,
  isVisible,
  kneeFlexionDeg,
  LM,
  mid,
  pelvicTiltLeftLowerDeg,
  type Landmark,
} from "@/lib/pose";
import {
  argMax,
  argMin,
  clamp,
  derivative,
  median,
  movingAverage,
  percentile,
  rollingPercentile,
} from "@/lib/signal";
import { isPublishable, threshold, WITHHELD_LABEL } from "@/lib/thresholds";

export const G = 9.80665;

/**
 * Peak vertical ground reaction force as a function of duty factor, which is
 * stance time over stride time.
 *
 * Treating stance as a clean half-sine gives peak = (pi/2) / (2 * duty). That
 * is right in spirit but climbs far too steeply once duty drops, because the
 * real force trace broadens as pace rises. This curve keeps the same 1/duty
 * shape but is anchored to reported peaks instead: about 2.1 BW for an easy
 * jog near duty 0.38, 2.4 BW for a steady run near 0.32, and 3.7 BW for a
 * sprint near 0.18.
 */
export function peakForceFromDuty(dutyFactor: number): number {
  if (!Number.isFinite(dutyFactor) || dutyFactor <= 0) return Number.NaN;
  if (dutyFactor >= 0.5) {
    // Walking carries a double-support phase and never loads like running.
    return clamp(1.05 + (0.6 - dutyFactor), 1, 1.4);
  }
  return 0.55 / dutyFactor + 0.65;
}

/** Published peak GRF from duty: the curve, then the reported-range cap. */
export function clampedPeakGrfBw(dutyFactor: number): number {
  const raw = peakForceFromDuty(dutyFactor);
  return Number.isFinite(raw)
    ? clamp(raw, threshold("peak_grf_min_bw"), threshold("peak_grf_max_bw"))
    : raw;
}

export type PoseFrame = {
  t: number;
  landmarks: Landmark[] | null;
  /**
   * Foot keypoints an estimator supplies that MediaPipe's 33 have no slot for.
   *
   * HALPE_26 — the set behind Sports2D's default model — carries the big *and*
   * small toe per side, which allows a foot long axis from heel to the midpoint
   * of the two rather than to one toe, and so a strike angle that does not
   * swing with toe-out. Filled by the adapter and deliberately not read yet:
   * the estimator comparison has to change one thing at a time, and a better
   * foot axis landing in the same commit as a better estimator would make the
   * difference unattributable.
   */
  footExtras?: {
    leftSmallToe?: Landmark;
    rightSmallToe?: Landmark;
  };
};

export type SeriesPoint = {
  t: number;
  comM: number;
  vel: number;
  acc: number;
  grfBw: number;
  kneeFlex: number;
  leftFootM: number;
  rightFootM: number;
  leftFootVel: number;
  rightFootVel: number;
  leftFootSpeed: number;
  rightFootSpeed: number;
  leftFootStrikeAngle: number;
  rightFootStrikeAngle: number;
  /**
   * How far the foot is ahead of the hip along the direction of travel, in
   * metres. Positive is ahead. See `footAheadOfHip` for why the sign comes
   * from the foot itself rather than from the body's motion across the frame.
   */
  leftFootAheadM: number;
  rightFootAheadM: number;
  /**
   * Frontal-plane alignment, and NaN whenever the pelvis is too narrow in the
   * image to resolve it — which is every side-on clip, by construction.
   * Positive valgus is the knee falling inward; positive tilt is the runner's
   * left hip sitting lower than the right.
   */
  leftKneeValgusDeg: number;
  rightKneeValgusDeg: number;
  pelvicTiltLeftLowerDeg: number;
};

export type Risk = "low" | "moderate" | "elevated" | "high" | "severe";

export type FootSide = "left" | "right" | "unknown";
export type { FootStrike };
export { classifyFootStrike };

export const footStrikeLabel: Record<FootStrike, string> = {
  rearfoot: "리어풋",
  midfoot: "미드풋",
  forefoot: "포어풋",
  unknown: "판정 불가",
};

export type Landing = {
  index: number;
  tContact: number;
  tPeakForce: number;
  impactVelocity: number;
  peakGrfBw: number;
  peakForceN: number;
  absorptionMs: number;
  contactMs: number;
  flightMs: number;
  dutyFactor: number;
  equivalentDropCm: number;
  loadingRateBwS: number;
  kneeFlexContact: number;
  kneeFlexPeak: number;
  damageScore: number;
  risk: Risk;
  side: FootSide;
  gaitBased: boolean;
  footStrike: FootStrike;
  footStrikeAngleDeg: number;
  /**
   * Overstriding: how far ahead of the hip the foot was at first contact.
   * Metres, and the same distance as a fraction of the runner's height so two
   * people can be compared. NaN when the clip cannot support it — a frontal
   * view, or quality too poor to publish.
   */
  footAheadM: number;
  footAheadRatio: number;
  /**
   * What a frontal clip can say and a side-on one cannot: the stance leg's
   * worst inward knee collapse, and how far the opposite hip dropped, both
   * taken as the peak over the stance phase rather than at touchdown — that is
   * where each of them peaks. NaN from the side.
   */
  kneeValgusDeg: number;
  pelvicDropDeg: number;
  note: string;
};

export type QualityLevel = "good" | "fair" | "poor";

export type AnalysisQuality = {
  level: QualityLevel;
  subjectHeightRatio: number;
  detectedRatio: number;
  cadenceConsistency: number;
  sideViewRatio: number;
  reasons: string[];
};

export type AnalysisResult = {
  series: SeriesPoint[];
  landings: Landing[];
  detectedRatio: number;
  metersPerPixel: number;
  /**
   * Which way the camera was pointing, as the analysis read it. Not a quality
   * grade: a frontal clip is a different set of measurements, not a worse one,
   * and the report branches on this rather than apologising for it.
   */
  cameraView: CameraView;
  quality: AnalysisQuality;
  reportedPaceMinPerKm?: number;
  warnings: string[];
};

export type AnalyzeOptions = {
  statureM: number;
  massKg: number;
  width: number;
  height: number;
  /** Playback slowdown of the clip: 2 means it was shot at twice real speed. */
  slowMotionFactor?: number;
  /** Optional real pace supplied by the runner, in minutes per kilometre. */
  reportedPaceMinPerKm?: number;
  /**
   * Whether the trajectories arrived already low-pass filtered.
   *
   * Sports2D runs a Hampel outlier pass and a fourth-order Butterworth at 6 Hz
   * before it writes anything, and two low-pass stages in series widen the
   * effective window — which is the mechanism that would broaden the contact
   * edges and shift stance. The size of that on real filtered input is not
   * known yet and is one of the things the estimator comparison is for; on a
   * clean fixture, turning our own smoothing off moves the contact estimate by
   * under a tenth of a millisecond, shifts mean force by about 2%, and finds
   * one more contact. The flag exists so the comparison is not partly
   * measuring our smoothing and reporting it as pose estimation.
   */
  preFiltered?: boolean;
};

function riskFromScore(score: number): Risk {
  if (score < threshold("load_score_moderate_min")) return "low";
  if (score < threshold("load_score_elevated_min")) return "moderate";
  if (score < threshold("load_score_high_min")) return "elevated";
  if (score < threshold("load_score_severe_min")) return "high";
  return "severe";
}

export function riskLabel(risk: Risk): string {
  switch (risk) {
    case "low":
      return "낮음";
    case "moderate":
      return "보통";
    case "elevated":
      return "주의";
    case "high":
      return "높음";
    case "severe":
      return "매우 높음";
  }
}

/**
 * Weights of the three terms, in points. They sum to 100 so the score really
 * uses the scale it is displayed on: the old 45 / 25 / 15 topped out at 85, so
 * `riskFromScore`'s 80+ band was five points wide and the 0–100 clamp never
 * did anything. The ratio between them is unchanged (9 : 5 : 3), so the terms
 * still carry the same relative weight.
 */
const BW_POINTS = 53;
const RATE_POINTS = 29;
const KNEE_POINTS = 18;

/**
 * Per-landing load score, 0–100. Short contact / low duty is pace, not damage,
 * so the scale uses peak force, loading rate, and knee give only.
 *
 * `kneeMeasured: false` is for a clip where the knee angle is not merely
 * missing but unmeasurable — a frontal view, where the knee bends along the
 * camera axis. The term is then dropped and the two that remain are stretched
 * back over the full 100, because leaving it out without rescaling would cap
 * the score at 82 and quietly narrow the top risk band to nothing. Substituting
 * a default angle instead, which is what the caller's `finiteOr(..., 20)`
 * fallback would otherwise do, is worse than either: it reports a stiff landing
 * nobody measured.
 */
export function landingLoadScore(input: {
  peakGrfBw: number;
  loadingRateBwS: number;
  dutyFactor: number;
  kneeFlexContact: number;
  kneeMeasured?: boolean;
}): number {
  const kneeMeasured = input.kneeMeasured ?? true;
  // Easy jogging sits near 1.8 BW and a sprint near 4.5 BW, so anchor the
  // scale there instead of letting ordinary running saturate the score.
  const bwTerm = clamp(((input.peakGrfBw - 1.7) / 2.8) * BW_POINTS, 0, BW_POINTS);
  const rateTerm = clamp(
    ((input.loadingRateBwS - 12) / 70) * RATE_POINTS,
    0,
    RATE_POINTS,
  );
  if (!kneeMeasured) {
    const spread = 100 / (BW_POINTS + RATE_POINTS);
    return clamp(Math.round((bwTerm + rateTerm) * spread), 0, 100);
  }
  const stiffKnee = clamp((55 - input.kneeFlexContact) / 55, 0, 1) * KNEE_POINTS;
  return clamp(Math.round(bwTerm + rateTerm + stiffKnee), 0, 100);
}

function damageScore(input: {
  peakGrfBw: number;
  loadingRateBwS: number;
  dutyFactor: number;
  kneeFlexContact: number;
  kneeMeasured?: boolean;
}): number {
  return landingLoadScore(input);
}

function landingNote(l: Omit<Landing, "note" | "index">): string {
  const bits: string[] = [];
  if (l.kneeFlexContact < 18 && l.kneeFlexPeak - l.kneeFlexContact < 10) {
    bits.push("무릎을 거의 편 채로 받아 뻣뻣한 착지로 보입니다.");
  } else if (l.kneeFlexPeak - l.kneeFlexContact > 25) {
    bits.push("착지 후 무릎을 굽혀 충격을 나눠 받은 편입니다.");
  }
  if (Number.isFinite(l.contactMs) && l.contactMs > 0) {
    bits.push(
      `접지 ${formatTimingMs(l.contactMs)} · 체공 ${formatTimingMs(l.flightMs)}.`,
    );
  }
  // How big the landing was overall is `compareHint(score)`'s job, and it is
  // said once. Repeating it from peakGrfBw alone either duplicates that
  // sentence or contradicts it: loading rate and knee flexion carry 47 of the
  // 100 points, so a sub-2 BW landing can still score past the "walking pace"
  // band. Describe the rate here instead — it is the part of the score the
  // card would otherwise leave unexplained.
  if (l.loadingRateBwS >= 55) {
    bits.push(
      `힘이 실리는 속도가 ${formatLoadingRateBwS(l.loadingRateBwS)}로 빠른 편입니다.`,
    );
  } else if (l.loadingRateBwS <= 20) {
    bits.push(
      `힘이 ${formatLoadingRateBwS(l.loadingRateBwS)}로 천천히 실렸습니다.`,
    );
  }
  if (!bits.length) {
    bits.push("일반적인 달리기 착지 범위에 가깝습니다.");
  }
  return bits.join(" ");
}

function measureSubject(
  frames: PoseFrame[],
  statureM: number,
  width: number,
  height: number,
): { metersPerPixel: number; staturePx: number; sideViewRatio: number } {
  const lengths: number[] = [];
  const profileRatios: number[] = [];
  for (const frame of frames) {
    const lm = frame.landmarks;
    if (!lm) continue;
    const nose = lm[LM.nose];
    const heel = mid(lm[LM.leftHeel], lm[LM.rightHeel]) ?? mid(lm[LM.leftAnkle], lm[LM.rightAnkle]);
    if (!isVisible(nose, 0.3) || !heel) continue;
    const px = distPx(nose, heel, width, height);
    if (px > 20) {
      const staturePx = px / 0.92;
      lengths.push(staturePx);
      const shoulderWidth = Math.abs(lm[LM.leftShoulder].x - lm[LM.rightShoulder].x) * width;
      const hipWidth = Math.abs(lm[LM.leftHip].x - lm[LM.rightHip].x) * width;
      profileRatios.push(Math.max(shoulderWidth, hipWidth) / staturePx);
    }
  }
  const staturePx = median(lengths);
  if (!Number.isFinite(staturePx) || staturePx < 40) {
    return {
      metersPerPixel: statureM / (height * 0.55),
      staturePx: Number.isFinite(staturePx) ? staturePx : Number.NaN,
      sideViewRatio: median(profileRatios),
    };
  }
  return {
    metersPerPixel: statureM / staturePx,
    staturePx,
    sideViewRatio: median(profileRatios),
  };
}

/**
 * A profile ratio above the threshold means the shoulders and hips are spread
 * across the frame, which is a camera in front of the runner rather than beside
 * them. `NaN` — nobody measured — is not frontal: the side-view path is the one
 * that degrades gracefully, since every other gate still applies.
 */
export function isFrontal(sideViewRatio: number): boolean {
  return (
    Number.isFinite(sideViewRatio) &&
    sideViewRatio > threshold("side_view_max_profile_ratio")
  );
}

function assessQuality(
  subjectHeightRatio: number,
  detectedRatio: number,
  landings: Landing[],
  sideViewRatio: number,
): AnalysisQuality {
  const gaps = landings
    .slice(1)
    .map((l, i) => l.tContact - landings[i].tContact);
  const stepGaps = gaps.filter((gap) => gap >= 0.15 && gap <= 0.7);
  const typical = median(stepGaps.length ? stepGaps : gaps);
  const cadenceConsistency =
    gaps.length >= 3 && Number.isFinite(typical) && typical > 0
      ? gaps.filter((g) => Math.abs(g - typical) <= typical * 0.3).length /
        gaps.length
      : Number.NaN;
  const missedLandings = estimateMissedLandings(gaps, typical);

  const reasons: string[] = [];
  if (!(subjectHeightRatio >= threshold("min_subject_height_ratio"))) {
    reasons.push(
      `사람이 화면 높이의 ${Math.round((subjectHeightRatio || 0) * 100)}%만 차지합니다. 접지 순간을 재려면 25% 이상으로 크게 담아 주세요.`,
    );
  }
  if (detectedRatio < threshold("min_detected_ratio_fair")) {
    reasons.push(
      `자세가 ${Math.round(detectedRatio * 100)}% 구간에서만 잡혔습니다. 전신이 계속 보이도록 찍어 주세요.`,
    );
  }
  // Being filmed from the front used to land here, as a reason that dragged the
  // whole clip down to "fair" and asked the runner to shoot it again. It is not
  // a fault: contact timing, ground reaction force and cadence all survive a
  // frontal view, and the alignment measurements only exist there. What the
  // view costs — strike pattern, fore-aft distance, knee flexion — is said by
  // the frontal report itself, next to what it buys.
  if (missedLandings >= 2) {
    reasons.push(
      `착지 간격으로 보면 약 ${missedLandings}회를 놓친 것으로 보입니다. 전신이 계속 보이게, 같은 속도로 곧게 달리는 구간이 좋습니다.`,
    );
  } else if (
    Number.isFinite(cadenceConsistency) &&
    cadenceConsistency < threshold("min_cadence_consistency_fair")
  ) {
    reasons.push(
      "착지 간격이 고르지 않아 일부 착지를 놓쳤을 수 있습니다. 같은 속도로 곧게 달리는 구간이 좋습니다.",
    );
  }

  const expected = landings.length + missedLandings;
  const missedRatio = expected > 0 ? missedLandings / expected : 0;
  const severe =
    !(subjectHeightRatio >= threshold("min_subject_height_ratio")) ||
    detectedRatio < threshold("min_detected_ratio_publish") ||
    (Number.isFinite(cadenceConsistency) &&
      cadenceConsistency < threshold("min_cadence_consistency_publish")) ||
    missedRatio >= 0.3;
  const level: QualityLevel = severe ? "poor" : reasons.length ? "fair" : "good";
  return {
    level,
    subjectHeightRatio,
    detectedRatio,
    cadenceConsistency,
    sideViewRatio,
    reasons,
  };
}

function estimateMissedLandings(gaps: number[], typical: number): number {
  if (!Number.isFinite(typical) || typical <= 0 || gaps.length < 2) return 0;
  return gaps.reduce((missed, gap) => {
    if (!(gap > typical * 1.7)) return missed;
    return missed + Math.max(1, Math.round(gap / typical) - 1);
  }, 0);
}

export function analyzeLandings(
  frames: PoseFrame[],
  options: AnalyzeOptions,
): AnalysisResult {
  const warnings: string[] = [];
  const detected = frames.filter((f) => f.landmarks && f.landmarks.length >= 29).length;
  const detectedRatio = frames.length ? detected / frames.length : 0;
  if (detectedRatio < 0.35) {
    warnings.push("사람 자세가 잘 잡히지 않았습니다. 전신이 나오고 옆모습·밝은 영상이 더 정확합니다.");
  }

  const { metersPerPixel: mpp, staturePx, sideViewRatio } = measureSubject(
    frames,
    options.statureM,
    options.width,
    options.height,
  );
  const subjectHeightRatio = Number.isFinite(staturePx)
    ? staturePx / options.height
    : Number.NaN;
  // Slow-motion footage stretches every duration by the same factor, so undo it
  // on the clock rather than trying to correct each derived quantity.
  const timeScale =
    options.slowMotionFactor && options.slowMotionFactor > 0
      ? 1 / options.slowMotionFactor
      : 1;
  const comRaw: number[] = [];
  const kneeRaw: number[] = [];
  const leftFootRaw: number[] = [];
  const rightFootRaw: number[] = [];
  const leftFootAbsRaw: number[] = [];
  const rightFootAbsRaw: number[] = [];
  const leftStrikeAngleRaw: number[] = [];
  const rightStrikeAngleRaw: number[] = [];
  const leftAheadRaw: number[] = [];
  const rightAheadRaw: number[] = [];
  const leftValgusRaw: number[] = [];
  const rightValgusRaw: number[] = [];
  const pelvicTiltRaw: number[] = [];
  const t: number[] = [];

  for (const frame of frames) {
    t.push(frame.t * timeScale);
    const lm = frame.landmarks;
    if (!lm) {
      comRaw.push(Number.NaN);
      kneeRaw.push(Number.NaN);
      leftFootRaw.push(Number.NaN);
      rightFootRaw.push(Number.NaN);
      leftFootAbsRaw.push(Number.NaN);
      rightFootAbsRaw.push(Number.NaN);
      leftStrikeAngleRaw.push(Number.NaN);
      rightStrikeAngleRaw.push(Number.NaN);
      leftAheadRaw.push(Number.NaN);
      rightAheadRaw.push(Number.NaN);
      leftValgusRaw.push(Number.NaN);
      rightValgusRaw.push(Number.NaN);
      pelvicTiltRaw.push(Number.NaN);
      continue;
    }
    const hip = mid(lm[LM.leftHip], lm[LM.rightHip]);
    if (!hip) {
      comRaw.push(Number.NaN);
      kneeRaw.push(Number.NaN);
      leftFootRaw.push(Number.NaN);
      rightFootRaw.push(Number.NaN);
      leftFootAbsRaw.push(Number.NaN);
      rightFootAbsRaw.push(Number.NaN);
      leftStrikeAngleRaw.push(Number.NaN);
      rightStrikeAngleRaw.push(Number.NaN);
      leftAheadRaw.push(Number.NaN);
      rightAheadRaw.push(Number.NaN);
      leftValgusRaw.push(Number.NaN);
      rightValgusRaw.push(Number.NaN);
      pelvicTiltRaw.push(Number.NaN);
      continue;
    }
    comRaw.push(-hip.y * options.height * mpp);
    leftFootRaw.push(
      footDropFromHip(lm[LM.leftHeel], lm[LM.leftAnkle], hip, options.height, mpp),
    );
    rightFootRaw.push(
      footDropFromHip(lm[LM.rightHeel], lm[LM.rightAnkle], hip, options.height, mpp),
    );
    leftFootAbsRaw.push(
      footAbsolute(lm[LM.leftHeel], lm[LM.leftAnkle], options.height, mpp),
    );
    rightFootAbsRaw.push(
      footAbsolute(lm[LM.rightHeel], lm[LM.rightAnkle], options.height, mpp),
    );
    leftStrikeAngleRaw.push(
      footStrikeAngleDeg(
        lm[LM.leftHeel],
        lm[LM.leftFootIndex],
        options.width,
        options.height,
      ),
    );
    rightStrikeAngleRaw.push(
      footStrikeAngleDeg(
        lm[LM.rightHeel],
        lm[LM.rightFootIndex],
        options.width,
        options.height,
      ),
    );
    leftAheadRaw.push(
      footAheadOfHip(
        lm[LM.leftAnkle],
        lm[LM.leftHeel],
        lm[LM.leftFootIndex],
        hip,
        options.width,
        mpp,
      ),
    );
    rightAheadRaw.push(
      footAheadOfHip(
        lm[LM.rightAnkle],
        lm[LM.rightHeel],
        lm[LM.rightFootIndex],
        hip,
        options.width,
        mpp,
      ),
    );
    const minPelvisPx = threshold("frontal_pelvis_min_width_px");
    leftValgusRaw.push(
      frontalKneeValgusDeg(
        "left",
        lm[LM.leftHip],
        lm[LM.rightHip],
        lm[LM.leftKnee],
        lm[LM.leftAnkle],
        options.width,
        options.height,
        minPelvisPx,
      ),
    );
    rightValgusRaw.push(
      frontalKneeValgusDeg(
        "right",
        lm[LM.leftHip],
        lm[LM.rightHip],
        lm[LM.rightKnee],
        lm[LM.rightAnkle],
        options.width,
        options.height,
        minPelvisPx,
      ),
    );
    pelvicTiltRaw.push(
      pelvicTiltLeftLowerDeg(
        lm[LM.leftHip],
        lm[LM.rightHip],
        options.width,
        options.height,
        minPelvisPx,
      ),
    );
    const flexL = kneeFlexionDeg(
      lm[LM.leftHip],
      lm[LM.leftKnee],
      lm[LM.leftAnkle],
      options.width,
      options.height,
    );
    const flexR = kneeFlexionDeg(
      lm[LM.rightHip],
      lm[LM.rightKnee],
      lm[LM.rightAnkle],
      options.width,
      options.height,
    );
    const flexes = [flexL, flexR].filter((v): v is number => v !== null);
    kneeRaw.push(flexes.length ? flexes.reduce((a, b) => a + b, 0) / flexes.length : Number.NaN);
  }

  /**
   * Position smoothing, skipped when the input arrived filtered.
   *
   * A branch rather than a window of 1: `movingAverage` floors its half-window
   * at one sample, so the narrowest window it can express is three, and asking
   * for 1 still averages three. Derivatives keep their smoothing either way —
   * differentiating amplifies noise whatever was done to the positions.
   */
  const smoothPath = (values: number[], window: number) =>
    options.preFiltered ? values : movingAverage(values, window);

  // Only bridge momentary dropouts. Holding the last value across a long gap
  // invents a motionless body, which then reads as a very long ground contact.
  const comAbsolute = smoothPath(fillShortGaps(comRaw, 3), 5);
  // Subtract the slow drift so camera tilt and depth changes do not show up as
  // a steady vertical velocity of the runner. The window has to stay well above
  // one gait cycle or it would flatten the motion we are trying to measure.
  const frameStep = median(t.slice(1).map((time, i) => time - t[i]));
  const trendWindow = Number.isFinite(frameStep) && frameStep > 0
    ? Math.max(9, Math.round(1.5 / frameStep))
    : 9;
  const comTrend = movingAverage(comAbsolute, trendWindow);
  const com = comAbsolute.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(comTrend[i]) ? v - comTrend[i] : Number.NaN,
  );
  const vel = movingAverage(derivative(com, t), 5);
  const acc = movingAverage(derivative(vel, t), 5);
  const knee = fillGaps(kneeRaw);
  const leftFoot = smoothPath(fillShortGaps(leftFootRaw, 2), 3);
  const rightFoot = smoothPath(fillShortGaps(rightFootRaw, 2), 3);
  const leftFootVel = movingAverage(derivative(leftFoot, t), 3);
  const rightFootVel = movingAverage(derivative(rightFoot, t), 3);
  // Absolute foot speed tells stance from swing even while the hip rises and
  // falls, which the hip-relative height alone cannot do.
  const leftFootSpeed = movingAverage(
    derivative(smoothPath(fillShortGaps(leftFootAbsRaw, 2), 3), t),
    3,
  ).map(Math.abs);
  const rightFootSpeed = movingAverage(
    derivative(smoothPath(fillShortGaps(rightFootAbsRaw, 2), 3), t),
    3,
  ).map(Math.abs);
  // Same treatment as the other per-foot signals: bridge single-frame dropouts,
  // then smooth, so one occluded ankle cannot move a contact by centimetres.
  const leftFootAhead = smoothPath(fillShortGaps(leftAheadRaw, 2), 3);
  const rightFootAhead = smoothPath(fillShortGaps(rightAheadRaw, 2), 3);
  // Joint angles from a lite pose model are noisier than positions, and these
  // two are read as peaks over stance, where a single bad frame would set the
  // whole number. Smooth them before anything takes a maximum.
  const leftValgus = smoothPath(fillShortGaps(leftValgusRaw, 2), 5);
  const rightValgus = smoothPath(fillShortGaps(rightValgusRaw, 2), 5);
  const pelvicTilt = smoothPath(fillShortGaps(pelvicTiltRaw, 2), 5);
  const leftFootStrikeAngle = normalizeFootAngles(
    smoothPath(leftStrikeAngleRaw, 3),
    leftFootSpeed,
    leftFoot,
  );
  const rightFootStrikeAngle = normalizeFootAngles(
    smoothPath(rightStrikeAngleRaw, 3),
    rightFootSpeed,
    rightFoot,
  );

  // Decided before the series is assembled, because it changes what the series
  // is allowed to contain: a frontal clip has no usable knee flexion.
  const cameraView: CameraView = isFrontal(sideViewRatio) ? "front" : "side";

  const series: SeriesPoint[] = t.map((time, i) => {
    const a = acc[i];
    const grfBw = Number.isFinite(a) ? clamp(1 + a / G, 0.2, 12) : Number.NaN;
    return {
      t: time,
      comM: com[i],
      vel: vel[i],
      acc: a,
      grfBw,
      // Sagittal knee flexion measured in the image plane is only knee flexion
      // when the camera is beside the runner. From in front the joint bends
      // along the camera axis and the angle collapses towards zero, which reads
      // as a stiff landing that never happened. Blanked at the source so the
      // live readout, which prefers this sample over the landing's own value,
      // cannot show it either.
      kneeFlex: cameraView === "front" ? Number.NaN : knee[i],
      leftFootM: leftFoot[i],
      rightFootM: rightFoot[i],
      leftFootVel: leftFootVel[i],
      rightFootVel: rightFootVel[i],
      leftFootSpeed: leftFootSpeed[i],
      rightFootSpeed: rightFootSpeed[i],
      leftFootStrikeAngle: leftFootStrikeAngle[i],
      rightFootStrikeAngle: rightFootStrikeAngle[i],
      leftFootAheadM: leftFootAhead[i],
      rightFootAheadM: rightFootAhead[i],
      leftKneeValgusDeg: leftValgus[i],
      rightKneeValgusDeg: rightValgus[i],
      pelvicTiltLeftLowerDeg: pelvicTilt[i],
    };
  });

  const detectedLandings = detectLandings(
    series,
    options.massKg,
    options.statureM,
    cameraView,
  );
  const quality = assessQuality(
    subjectHeightRatio,
    detectedRatio,
    detectedLandings,
    sideViewRatio,
  );

  // Contact and flight timing is only meaningful when the runner is big enough
  // and tracked continuously. Publishing a number from a poor clip is what made
  // every video look like the same hard landing.
  const strikeChecked = isFrontal(sideViewRatio)
    ? detectedLandings.map(withoutFootStrike)
    : detectedLandings;
  const landings =
    quality.level === "poor"
      ? strikeChecked.map(withoutGaitTiming)
      : strikeChecked;

  if (quality.level === "poor" && landings.length) {
    warnings.push(
      `촬영 조건이 부족해 접지·체공 시간과 페이스는 표시하지 않습니다. ${quality.reasons[0] ?? ""}`.trim(),
    );
  } else if (quality.level === "fair" && landings.length) {
    warnings.push(`측정 오차가 큰 조건입니다. ${quality.reasons[0] ?? ""}`.trim());
  }
  if (!landings.length) {
    warnings.push("뚜렷한 착지 충격을 찾지 못했습니다. 발이 떨어졌다 닿는 구간이 보이게 찍어 보세요.");
  }

  return {
    series,
    landings,
    detectedRatio,
    metersPerPixel: mpp,
    cameraView,
    quality,
    reportedPaceMinPerKm: options.reportedPaceMinPerKm,
    warnings,
  };
}

const SLOW_MOTION_CANDIDATES = [1, 2, 4, 8];

/**
 * Phones record slow motion without marking it, and every duration in the clip
 * is then stretched by that factor. Running cadence and stance duration have
 * narrow physiological ranges, so try the usual factors and keep whichever one
 * describes a gait a human could actually produce.
 */
export type SlowMotionAnalysis = {
  result: AnalysisResult;
  slowMotionFactor: number;
  autoDetected: boolean;
  /** Set when the evidence clearly favours a factor other than the chosen one. */
  suggestedFactor?: number;
};

export function analyzeLandingsAuto(
  frames: PoseFrame[],
  options: AnalyzeOptions,
): SlowMotionAnalysis {
  if (options.slowMotionFactor && options.slowMotionFactor > 0) {
    const chosen = analyzeLandings(frames, options);
    const best = bestSlowMotion(frames, options);
    const chosenScore = gaitPlausibility(chosen);
    // A wrong capture rate pushes stance and step outside human limits, so the
    // gait falls apart. Say so instead of quietly reporting the broken numbers.
    const suggestedFactor =
      best &&
      best.factor !== options.slowMotionFactor &&
      best.score > chosenScore + 0.5
        ? best.factor
        : undefined;
    return {
      result: applyClockToQuality(chosen, {
        suggestedFactor,
        chosenScore,
        bestScore: best?.score,
      }),
      slowMotionFactor: options.slowMotionFactor,
      autoDetected: false,
      suggestedFactor,
    };
  }

  // Do not infer playback speed from a runner too small or intermittently
  // tracked. A missed step can mimic slow motion exactly.
  const baseline = analyzeLandings(frames, { ...options, slowMotionFactor: 1 });
  if (
    baseline.quality.subjectHeightRatio < threshold("min_subject_height_ratio") ||
    baseline.quality.detectedRatio < threshold("min_detected_ratio_publish")
  ) {
    return { result: baseline, slowMotionFactor: 1, autoDetected: false };
  }

  const best = bestSlowMotion(frames, options);

  const chosen = best ?? {
    result: analyzeLandings(frames, { ...options, slowMotionFactor: 1 }),
    factor: 1,
    score: 0,
  };
  return {
    result: applyClockToQuality(chosen.result, {
      chosenScore: chosen.score,
    }),
    slowMotionFactor: chosen.factor,
    autoDetected: chosen.factor !== 1,
  };
}

function bestSlowMotion(
  frames: PoseFrame[],
  options: AnalyzeOptions,
): { result: AnalysisResult; factor: number; score: number } | null {
  let best: { result: AnalysisResult; factor: number; score: number } | null = null;
  for (const factor of SLOW_MOTION_CANDIDATES) {
    const result = analyzeLandings(frames, { ...options, slowMotionFactor: factor });
    const score = gaitPlausibility(result) - (factor === 1 ? 0 : 0.12);
    if (!best || score > best.score) best = { result, factor, score };
  }
  return best;
}

function gaitPlausibility(result: AnalysisResult): number {
  const { landings, quality } = result;
  if (landings.length < 4) return 0;

  const gaps = landings
    .slice(1)
    .map((l, i) => l.tContact - landings[i].tContact);
  const stepPeriod = median(gaps);
  if (!Number.isFinite(stepPeriod) || stepPeriod <= 0) return 0;
  const cadence = 60 / stepPeriod;
  const contactS = median(landings.map((l) => l.contactMs)) / 1000;
  const duty = median(landings.map((l) => l.dutyFactor));

  let score = Number.isFinite(quality.cadenceConsistency)
    ? quality.cadenceConsistency
    : 0;
  if (cadence >= 140 && cadence <= 220) score += 0.6;
  else if (cadence >= 110 && cadence < 140) score += 0.2;
  if (contactS >= 0.08 && contactS <= 0.32) score += 0.4;
  if (Number.isFinite(duty) && duty >= 0.18 && duty <= 0.48) score += 0.3;
  score += (landings.filter((l) => l.gaitBased).length / landings.length) * 0.4;

  // Limb speed is an independent check on the clock, since it comes from the
  // body scale rather than from any contact timing. A swinging foot travels
  // several metres per second relative to the hip, so a factor that leaves it
  // far below that is reading slow-motion footage as if it were real time.
  const swingSpeed = percentile(
    [
      ...result.series.map((s) => Math.abs(s.leftFootVel)),
      ...result.series.map((s) => Math.abs(s.rightFootVel)),
    ].filter(Number.isFinite),
    0.9,
  );
  if (swingSpeed >= 3.5 && swingSpeed <= 11) score += 0.5;
  else if (swingSpeed > 11 || swingSpeed < 2) score -= 0.6;

  return score;
}

function withoutFootStrike(landing: Landing): Landing {
  return {
    ...landing,
    footStrike: "unknown",
    footStrikeAngleDeg: Number.NaN,
    // A frontal clip loses the fore-aft distance along with the strike angle:
    // both are measured in the plane the camera has collapsed.
    footAheadM: Number.NaN,
    footAheadRatio: Number.NaN,
  };
}

function withoutGaitTiming(landing: Landing): Landing {
  const fallbackGrf = landing.gaitBased
    ? clamp(landing.peakGrfBw, 1.05, 3)
    : landing.peakGrfBw;
  const score = damageScore({
    peakGrfBw: fallbackGrf,
    loadingRateBwS: landing.loadingRateBwS,
    dutyFactor: Number.NaN,
    kneeFlexContact: landing.kneeFlexContact,
    // A landing that reached here from a frontal clip still has no knee angle,
    // and rescoring it must not reinstate one through the fallback.
    kneeMeasured: Number.isFinite(landing.kneeFlexContact),
  });
  return {
    ...landing,
    peakGrfBw: fallbackGrf,
    peakForceN:
      landing.gaitBased && landing.peakGrfBw
        ? (landing.peakForceN / landing.peakGrfBw) * fallbackGrf
        : landing.peakForceN,
    contactMs: Number.NaN,
    flightMs: Number.NaN,
    dutyFactor: Number.NaN,
    gaitBased: false,
    footStrike: "unknown",
    footStrikeAngleDeg: Number.NaN,
    // Too small in frame or too intermittently tracked to publish timing is
    // also too coarse to publish centimetres of fore-aft distance, or degrees
    // of frontal alignment.
    footAheadM: Number.NaN,
    footAheadRatio: Number.NaN,
    kneeValgusDeg: Number.NaN,
    pelvicDropDeg: Number.NaN,
    damageScore: score,
    risk: riskFromScore(score),
  };
}

/**
 * Capture-rate choice and quality grade are one decision. A wrong slow-motion
 * factor stretches every duration, so do not publish those numbers as a run.
 */
function applyClockToQuality(
  result: AnalysisResult,
  clock: {
    suggestedFactor?: number;
    chosenScore: number;
    bestScore?: number;
  },
): AnalysisResult {
  const reasons = [...result.quality.reasons];
  let level = result.quality.level;
  const warnings = [...result.warnings];

  if (clock.suggestedFactor) {
    const label =
      clock.suggestedFactor === 1
        ? "일반 속도"
        : `${clock.suggestedFactor}배 슬로우`;
    reasons.push(
      `선택한 촬영 배속으로는 접지·케이던스가 사람 보행 범위를 벗어납니다. ${label}로 다시 분석해 보세요.`,
    );
    const implausible =
      clock.chosenScore < 1.2 ||
      (clock.bestScore !== undefined &&
        clock.bestScore > clock.chosenScore + 0.5);
    if (implausible) level = "poor";
    else if (level === "good") level = "fair";
  } else if (result.landings.length >= 4 && clock.chosenScore < 0.7) {
    reasons.push(
      "접지·케이던스가 사람 보행 범위와 맞지 않아 숫자를 내지 않습니다. 촬영 배속과 촬영 거리를 확인해 주세요.",
    );
    level = "poor";
  }

  const landings =
    level === "poor" && result.quality.level !== "poor"
      ? result.landings.map(withoutGaitTiming)
      : result.landings;

  if (level === "poor" && result.quality.level !== "poor" && landings.length) {
    warnings.push(
      `촬영 조건이 부족해 접지·체공 시간과 페이스는 표시하지 않습니다. ${reasons.at(-1) ?? ""}`.trim(),
    );
  }

  return {
    ...result,
    quality: { ...result.quality, level, reasons },
    landings,
    warnings,
  };
}

function normalizeFootAngles(
  angles: number[],
  speed: number[],
  footHeight: number[],
): number[] {
  const finiteSpeed = speed.filter(Number.isFinite);
  const finiteHeight = footHeight.filter(Number.isFinite);
  const speedCut = percentile(finiteSpeed, 0.35);
  const groundCut = percentile(finiteHeight, 0.7);
  const stanceAngles = angles.filter(
    (angle, i) =>
      Number.isFinite(angle) &&
      Math.abs(angle) <= threshold("foot_strike_max_plausible_deg") &&
      Number.isFinite(speed[i]) &&
      speed[i] <= speedCut &&
      Number.isFinite(footHeight[i]) &&
      footHeight[i] >= groundCut,
  );
  // A planted foot supplies the local ground/camera-roll reference. Requiring
  // several samples prevents one occluded frame from rotating every contact.
  const baseline = stanceAngles.length >= 5 ? median(stanceAngles) : 0;
  return angles.map((angle) =>
    Number.isFinite(angle) ? angle - baseline : Number.NaN,
  );
}

function footStrikeAngleDeg(
  heel: Landmark | undefined,
  toe: Landmark | undefined,
  width: number,
  height: number,
): number {
  if (!heel || !toe || !isVisible(heel, 0.45) || !isVisible(toe, 0.45)) {
    return Number.NaN;
  }
  const dx = (toe.x - heel.x) * width;
  const dy = (toe.y - heel.y) * height;
  const length = Math.hypot(dx, dy);
  if (length < 4) return Number.NaN;
  // Image y grows down. Positive means the forefoot is below the heel, which
  // indicates a forefoot-first contact; negative means heel-first.
  return (Math.asin(clamp(dy / length, -1, 1)) * 180) / Math.PI;
}

/**
 * Signed fore-aft distance from the hip to the foot, in metres, positive when
 * the foot is ahead.
 *
 * "Ahead" needs a direction, and the obvious source — which way the body moves
 * across the frame — is the one thing this analysis refuses to trust, because a
 * panning camera slides the whole runner sideways. The foot supplies it
 * instead: a foot points the way it is going, so the sign of toe minus heel is
 * the direction of travel, read inside the same frame it is used in and immune
 * to camera motion.
 *
 * The ankle is the reference point rather than the heel or the toe, so the
 * measurement does not change meaning with strike pattern — a forefoot contact
 * would otherwise read as further forward than a rearfoot one from the same hip
 * position.
 */
function footAheadOfHip(
  ankle: Landmark | undefined,
  heel: Landmark | undefined,
  toe: Landmark | undefined,
  hip: Landmark,
  width: number,
  metersPerPixel: number,
): number {
  if (!isVisible(heel, 0.35) || !isVisible(toe, 0.35)) return Number.NaN;
  const point = isVisible(ankle, 0.35) ? ankle : heel;
  if (!point || !heel || !toe) return Number.NaN;
  const footLengthPx = (toe.x - heel.x) * width;
  // A foot seen end-on has no length in the image and so no direction. Below a
  // few pixels the sign is noise, and a wrong sign flips the whole reading.
  if (Math.abs(footLengthPx) < 6) return Number.NaN;
  const direction = Math.sign(footLengthPx);
  return (point.x - hip.x) * width * direction * metersPerPixel;
}

function footAbsolute(
  heel: Landmark | undefined,
  ankle: Landmark | undefined,
  height: number,
  metersPerPixel: number,
): number {
  const candidates = [heel, ankle].filter(
    (p): p is Landmark => Boolean(p) && isVisible(p, 0.25),
  );
  if (!candidates.length) return Number.NaN;
  return Math.max(...candidates.map((p) => p.y)) * height * metersPerPixel;
}

function footDropFromHip(
  heel: Landmark | undefined,
  ankle: Landmark | undefined,
  hip: Landmark,
  height: number,
  metersPerPixel: number,
): number {
  const candidates = [heel, ankle].filter(
    (p): p is Landmark => Boolean(p) && isVisible(p, 0.25),
  );
  if (!candidates.length) return Number.NaN;
  // Measure how far the foot sits below the hip rather than where it sits in
  // the frame. A panning or tilting camera slides the whole body across the
  // image, which would otherwise drag the ground line along with it.
  const lowest = Math.max(...candidates.map((p) => p.y));
  return (lowest - hip.y) * height * metersPerPixel;
}

function fillGaps(values: number[]): number[] {
  const out = values.slice();
  let last = out.find((v) => Number.isFinite(v)) ?? 0;
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i])) last = out[i];
    else out[i] = last;
  }
  return out;
}

function fillShortGaps(values: number[], maxRun: number): number[] {
  const out = values.slice();
  let runStart = -1;
  for (let i = 0; i <= out.length; i++) {
    const missing = i < out.length && !Number.isFinite(out[i]);
    if (missing && runStart < 0) runStart = i;
    if (!missing && runStart >= 0) {
      const before = out[runStart - 1];
      const after = i < out.length ? out[i] : Number.NaN;
      const length = i - runStart;
      if (length <= maxRun && Number.isFinite(before) && Number.isFinite(after)) {
        for (let k = runStart; k < i; k++) {
          out[k] = before + ((after - before) * (k - runStart + 1)) / (length + 1);
        }
      }
      runStart = -1;
    }
  }
  return out;
}

type ContactInterval = {
  side: FootSide;
  startIdx: number;
  endIdx: number;
  start: number;
  end: number;
};

type RawLanding = {
  contactIdx: number;
  peakIdx: number;
  absorbIdx: number;
  impactVel: number;
  contactS: number;
  side: FootSide;
  strikeIdx: number;
  /** Last frame of the stance this contact belongs to, where one was matched. */
  stanceEndIdx: number;
};

// Human running stance and step timings. Anything outside these came from a
// tracking dropout, not from the runner. The values and the reason each one
// holds are in shared/thresholds.yaml.
const MIN_CONTACT_S = threshold("min_contact_s");
const MAX_CONTACT_S = threshold("max_contact_s");
/**
 * Thresholding the foot height always clips the roll-in at heel strike and the
 * peel-off at the toe, because the foot is neither at its lowest nor fully
 * still through those phases. That truncation shortens stance and therefore
 * inflates the force estimate, so add back a fixed allowance for the two edges.
 */
const STANCE_EDGE_ALLOWANCE_S = threshold("stance_edge_allowance_s");
const MIN_STEP_S = threshold("min_step_s");
const MAX_STEP_S = threshold("max_step_s");

function detectLandings(
  series: SeriesPoint[],
  massKg: number,
  statureM: number,
  view: CameraView = "side",
): Landing[] {
  if (series.length < 8) return [];
  const acc = series.map((s) => s.acc);
  const vel = series.map((s) => s.vel);
  const dtMedian = median(
    series.slice(1).map((s, i) => s.t - series[i].t),
  );
  const dt = Number.isFinite(dtMedian) && dtMedian > 0 ? dtMedian : 1 / 30;
  const minSep = Math.max(3, Math.round(0.2 / dt));
  const intervals = groundContactIntervals(series, dt);

  const raws: RawLanding[] = [];
  for (const candidate of contactCandidates(series, dt)) {
    let contactIdx = candidate;
    const prior = Math.max(0, contactIdx - Math.round(0.2 / dt));
    const minVelIdx = argMin(vel, prior, contactIdx);
    const impactVel = vel[minVelIdx];
    if (!Number.isFinite(impactVel) || impactVel > -0.06) continue;


    // Acceleration often starts one or two frames before the visible heel
    // settles. Move contact back to that onset when it is clear.
    for (let k = minVelIdx; k <= candidate; k++) {
      if (acc[k] > 3.5) {
        contactIdx = k;
        break;
      }
    }

    const after = Math.min(
      series.length - 1,
      contactIdx + Math.round(0.25 / dt),
    );
    let absorbIdx = after;
    for (let k = contactIdx + 1; k <= after; k++) {
      if (vel[k] >= -0.03) {
        absorbIdx = k;
        break;
      }
    }
    const peakWindowEnd = Math.min(
      after,
      contactIdx + Math.max(2, Math.round(0.18 / dt)),
    );
    const interval = matchInterval(intervals, contactIdx, dt);
    const rawContactS = interval ? interval.end - interval.start : Number.NaN;
    raws.push({
      contactIdx,
      peakIdx: argMax(acc, contactIdx, peakWindowEnd),
      absorbIdx,
      impactVel,
      contactS:
        rawContactS >= MIN_CONTACT_S && rawContactS <= MAX_CONTACT_S
          ? rawContactS
          : Number.NaN,
      side: interval?.side ?? inferFootSide(series[contactIdx]),
      strikeIdx: interval?.startIdx ?? contactIdx,
      // Without a matched interval, fall back to the frames between contact and
      // the end of absorption. It is shorter than a real stance, which keeps
      // the peak search inside the contact rather than letting it wander into
      // the next swing.
      stanceEndIdx: interval?.endIdx ?? Math.max(absorbIdx, contactIdx),
    });
  }

  const deduped = dedupe(raws, acc, minSep);
  const medianContactS = median(deduped.map((r) => r.contactS));
  // Cadence is the most reliable timing we have, so read the step period from
  // the contacts themselves and take flight as whatever the stance leaves over.
  const stepPeriodS = median(
    deduped
      .slice(1)
      .map((r, i) => series[r.contactIdx].t - series[deduped[i].contactIdx].t)
      .filter((gap) => gap >= MIN_STEP_S && gap <= MAX_STEP_S),
  );

  return deduped.map((raw) => {
    // A single stance is measured to within a frame or two, so keep each
    // contact near the clip's median rather than letting one noisy frame
    // produce a five-bodyweight outlier.
    const measuredContactS = Number.isFinite(raw.contactS)
      ? Number.isFinite(medianContactS)
        ? clamp(raw.contactS, medianContactS * 0.75, medianContactS * 1.35)
        : raw.contactS
      : medianContactS;
    const contactS = Number.isFinite(measuredContactS)
      ? measuredContactS + STANCE_EDGE_ALLOWANCE_S
      : measuredContactS;
    const gaitBased =
      Number.isFinite(contactS) &&
      Number.isFinite(stepPeriodS) &&
      contactS <= stepPeriodS;
    const flightS = gaitBased ? Math.max(0, stepPeriodS - contactS) : Number.NaN;

    const vImp = Math.abs(raw.impactVel);
    const peakAcc = Math.max(0, acc[raw.peakIdx]);
    const measuredGrfBw = 1 + peakAcc / G;
    const dutyForForce = gaitBased ? contactS / (2 * stepPeriodS) : Number.NaN;
    const peakGrfBw = gaitBased
      ? clampedPeakGrfBw(dutyForForce)
      : clamp(measuredGrfBw, 1.05, 4);

    const absorptionMs = (series[raw.absorbIdx].t - series[raw.contactIdx].t) * 1000;
    const measuredRiseS = series[raw.peakIdx].t - series[raw.contactIdx].t;
    const riseS = gaitBased
      ? Math.max(0.4 * contactS, dt)
      : Math.max(measuredRiseS, dt);
    const loadingRateBwS = peakGrfBw / riseS;
    const dutyFactor = gaitBased ? contactS / (2 * stepPeriodS) : Number.NaN;

    // The 20-degree fallback covers a landmark the tracker lost for a frame.
    // It must not cover a view that cannot show knee flexion at all, which is
    // why that case is a flag rather than another missing value.
    const kneeMeasured = view === "side";
    const kneeFlexContact = kneeMeasured
      ? finiteOr(series[raw.contactIdx].kneeFlex, 20)
      : Number.NaN;
    const kneeSlice = series
      .slice(raw.contactIdx, raw.absorbIdx + 1)
      .map((s) => s.kneeFlex)
      .filter(Number.isFinite);
    const kneeFlexPeak = kneeMeasured
      ? Math.max(kneeFlexContact, ...kneeSlice)
      : Number.NaN;

    const score = damageScore({
      peakGrfBw,
      loadingRateBwS,
      dutyFactor,
      kneeFlexContact,
      kneeMeasured,
    });
    const side = raw.side;
    const footStrikeAngle = strikeAngleAt(series, raw.strikeIdx, side);
    const strike = classifyFootStrike(footStrikeAngle, view);
    // Fore-aft position needs the runner seen from the side for the same reason
    // the strike angle does: from in front, the distance is along the camera
    // axis and the image says nothing about it.
    const footAheadM =
      view === "side" ? footAheadAt(series, raw.strikeIdx, side, dt) : Number.NaN;
    // The mirror image of the rule above: these two need the camera in front of
    // the runner, and the pelvis-width gate inside the geometry already returns
    // NaN from the side, so the view check here is belt and braces on a value
    // the report would otherwise have to explain.
    const frontal =
      view === "front"
        ? frontalPeaksOver(series, raw.strikeIdx, raw.stanceEndIdx, side)
        : { kneeValgusDeg: Number.NaN, pelvicDropDeg: Number.NaN };
    const landing: Landing = {
      index: raw.peakIdx,
      tContact: series[raw.contactIdx].t,
      tPeakForce: series[raw.peakIdx].t,
      impactVelocity: vImp,
      peakGrfBw,
      peakForceN: peakGrfBw * massKg * G,
      absorptionMs,
      contactMs: gaitBased ? contactS * 1000 : Number.NaN,
      flightMs: gaitBased ? Math.max(0, flightS) * 1000 : Number.NaN,
      dutyFactor,
      equivalentDropCm: ((vImp * vImp) / (2 * G)) * 100,
      loadingRateBwS,
      kneeFlexContact,
      kneeFlexPeak,
      damageScore: score,
      risk: riskFromScore(score),
      side,
      gaitBased,
      footStrike: strike.type,
      footStrikeAngleDeg: footStrikeAngle,
      footAheadM,
      footAheadRatio:
        Number.isFinite(footAheadM) && statureM > 0
          ? footAheadM / statureM
          : Number.NaN,
      kneeValgusDeg: frontal.kneeValgusDeg,
      pelvicDropDeg: frontal.pelvicDropDeg,
      note: "",
    };
    landing.note = landingNote(landing);
    return landing;
  });
}

// Pulling contact back to the acceleration onset can land two candidates on the
// same frame, so collapse neighbours only after that adjustment.
function dedupe(
  raws: RawLanding[],
  acc: number[],
  minSep: number,
): RawLanding[] {
  const sorted = [...raws].sort((a, b) => a.contactIdx - b.contactIdx);
  const out: RawLanding[] = [];
  for (const raw of sorted) {
    const previous = out.at(-1);
    if (previous && raw.contactIdx - previous.contactIdx < minSep) {
      if (acc[raw.peakIdx] > acc[previous.peakIdx]) out[out.length - 1] = raw;
      continue;
    }
    out.push(raw);
  }
  return out;
}

function strikeAngleAt(
  series: SeriesPoint[],
  index: number,
  side: FootSide,
): number {
  let resolved = side;
  if (resolved === "unknown") resolved = inferFootSide(series[index]);
  if (resolved === "unknown") return Number.NaN;

  const values: number[] = [];
  // The detected contact can lead or trail the visible first-contact frame by
  // one sample. Use a very small window so the flat foot later in stance does
  // not wash out heel-first or forefoot-first contact.
  for (let i = Math.max(0, index - 1); i <= Math.min(series.length - 1, index + 1); i++) {
    const angle =
      resolved === "left"
        ? series[i].leftFootStrikeAngle
        : series[i].rightFootStrikeAngle;
    if (Number.isFinite(angle)) values.push(angle);
  }
  return median(values);
}

/**
 * The fore-aft distance at first contact, for the foot that made it.
 *
 * Taken as the furthest-forward value in a short window rather than the value
 * at the contact index, because the index is not the touchdown frame: the
 * contact interval is deliberately grown backwards over the heel roll-in, so
 * reading it directly samples a foot that is still swinging forward and
 * understates the distance — by about a quarter on the fixtures.
 *
 * The maximum is not a workaround for that but the definition. A foot travels
 * forward through swing and backwards through stance, so its fore-aft extreme
 * *is* the moment it lands. Anchoring to the extreme also makes the reading
 * independent of how well contact detection is aligned, which is the part that
 * varies between clips.
 */
function footAheadAt(
  series: SeriesPoint[],
  index: number,
  side: FootSide,
  dt: number,
): number {
  let resolved = side;
  if (resolved === "unknown") resolved = inferFootSide(series[index]);
  if (resolved === "unknown") return Number.NaN;

  // Wide enough to cover the roll-in the interval was grown over, narrow
  // enough that mid-stance — where the foot is well behind the hip — cannot
  // enter the window.
  const half = Math.max(2, Math.round(0.05 / dt));
  let best = Number.NaN;
  for (
    let i = Math.max(0, index - half);
    i <= Math.min(series.length - 1, index + half);
    i++
  ) {
    const value =
      resolved === "left" ? series[i].leftFootAheadM : series[i].rightFootAheadM;
    if (!Number.isFinite(value)) continue;
    if (!Number.isFinite(best) || value > best) best = value;
  }
  return best;
}

/**
 * Worst inward knee collapse and worst opposite-hip drop over one stance.
 *
 * Both are read as peaks across the stance phase rather than at touchdown,
 * because that is when each of them happens: the knee falls furthest inward
 * around mid-stance, under load, and the pelvis drops as the swing leg passes.
 * Sampling the contact frame instead would consistently report a runner as
 * better aligned than they are.
 */
function frontalPeaksOver(
  series: SeriesPoint[],
  startIdx: number,
  endIdx: number,
  side: FootSide,
): { kneeValgusDeg: number; pelvicDropDeg: number } {
  const blank = { kneeValgusDeg: Number.NaN, pelvicDropDeg: Number.NaN };
  let resolved = side;
  if (resolved === "unknown") resolved = inferFootSide(series[startIdx]);
  if (resolved === "unknown") return blank;

  const from = Math.max(0, startIdx);
  const to = Math.min(series.length - 1, Math.max(startIdx, endIdx));
  let valgus = Number.NaN;
  let drop = Number.NaN;
  for (let i = from; i <= to; i++) {
    const point = series[i];
    const knee =
      resolved === "left" ? point.leftKneeValgusDeg : point.rightKneeValgusDeg;
    if (Number.isFinite(knee) && (!Number.isFinite(valgus) || knee > valgus)) {
      valgus = knee;
    }
    // The tilt is stored as "left hip lower". Contralateral drop is that value
    // seen from whichever foot is carrying the runner.
    const tilt = point.pelvicTiltLeftLowerDeg;
    const contralateral = resolved === "left" ? -tilt : tilt;
    if (
      Number.isFinite(contralateral) &&
      (!Number.isFinite(drop) || contralateral > drop)
    ) {
      drop = contralateral;
    }
  }
  return { kneeValgusDeg: valgus, pelvicDropDeg: drop };
}

function matchInterval(
  intervals: ContactInterval[],
  contactIdx: number,
  dt: number,
): ContactInterval | null {
  const tolerance = Math.round(0.12 / dt) + 1;
  let best: ContactInterval | null = null;
  let bestGap = Infinity;
  for (const interval of intervals) {
    const gap = Math.abs(interval.startIdx - contactIdx);
    if (gap <= tolerance && gap < bestGap) {
      best = interval;
      bestGap = gap;
    }
  }
  return best;
}

function groundContactIntervals(
  series: SeriesPoint[],
  dt: number,
): ContactInterval[] {
  return [
    ...footIntervals(
      series.map((s) => s.leftFootM),
      series.map((s) => s.leftFootSpeed),
      series,
      dt,
      "left",
    ),
    ...footIntervals(
      series.map((s) => s.rightFootM),
      series.map((s) => s.rightFootSpeed),
      series,
      dt,
      "right",
    ),
  ].sort((a, b) => a.start - b.start);
}

function footIntervals(
  foot: number[],
  speed: number[],
  series: SeriesPoint[],
  dt: number,
  side: FootSide,
): ContactInterval[] {
  const finite = foot.filter(Number.isFinite);
  if (finite.length < foot.length * 0.5) return [];
  const swing = percentile(finite, 0.9) - percentile(finite, 0.1);
  if (!(swing > 0.03)) return [];

  // The ground line drifts as the runner crosses the frame, so track it in a
  // window rather than assuming one level for the whole clip.
  const ground = rollingPercentile(foot, Math.max(4, Math.round(0.7 / dt)), 0.92);
  // Hysteresis. A single threshold clips the partly loaded frames at heel
  // strike and toe-off, which shortens stance and inflates the force estimate.
  // Find the clearly planted core, then grow it over the looser band.
  const coreTolerance = Math.max(0.02, swing * 0.22);
  const growTolerance = Math.max(0.03, swing * 0.5);
  const swingSpeed = percentile(speed.filter(Number.isFinite), 0.8);
  const stillSpeed =
    Number.isFinite(swingSpeed) && swingSpeed > 0
      ? Math.max(0.24, swingSpeed * 0.9)
      : Number.POSITIVE_INFINITY;
  const core = foot.map(
    (value, i) =>
      Number.isFinite(value) &&
      value >= ground[i] - coreTolerance &&
      (!Number.isFinite(speed[i]) || speed[i] <= stillSpeed),
  );
  // Growth relaxes only the height band. The foot must still be moving slowly,
  // which is what keeps a short sprint stance from swallowing its own swing.
  const loose = foot.map(
    (value, i) =>
      Number.isFinite(value) &&
      value >= ground[i] - growTolerance &&
      (!Number.isFinite(speed[i]) || speed[i] <= stillSpeed),
  );

  const minFrames = Math.max(2, Math.round(MIN_CONTACT_S / dt));
  const maxFrames = Math.ceil(MAX_CONTACT_S / dt) + 1;
  const maxGapFrames = Math.max(1, Math.round(0.05 / dt));
  // Rolling onto the heel and pushing off the toe take a few tens of
  // milliseconds each, so allow only that much beyond the planted core.
  const maxGrow = Math.max(1, Math.round(0.06 / dt));

  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= core.length; i++) {
    const on = i < core.length && core[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      let from = start;
      let to = i - 1;
      for (let k = 0; k < maxGrow && from > 0 && loose[from - 1]; k++) from -= 1;
      for (let k = 0; k < maxGrow && to < core.length - 1 && loose[to + 1]; k++) {
        to += 1;
      }
      spans.push([from, to]);
      start = -1;
    }
  }

  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span[0] - previous[1] - 1 <= maxGapFrames) {
      previous[1] = span[1];
    } else {
      merged.push([...span]);
    }
  }

  return merged
    .filter(
      ([from, to]) =>
        to - from + 1 >= minFrames && to - from + 1 <= maxFrames,
    )
    .map(([from, to]) => ({
      side,
      startIdx: from,
      endIdx: to,
      start: series[from].t,
      end: series[to].t + dt,
    }));
}

function contactCandidates(series: SeriesPoint[], dt: number): number[] {
  const acc = series.map((s) => s.acc);
  const vel = series.map((s) => s.vel);
  const candidates: number[] = [];

  // Jump and hard-landing path: a local upward acceleration peak following a
  // descending COM. This remains useful when a foot is occluded.
  for (let i = 2; i < series.length - 2; i++) {
    const a = acc[i];
    const isPeak =
      Number.isFinite(a) &&
      a >= 6 &&
      a >= acc[i - 1] &&
      a >= acc[i + 1] &&
      a >= acc[i - 2] &&
      a >= acc[i + 2];
    if (!isPeak) continue;
    const prior = Math.max(0, i - Math.round(0.18 / dt));
    if (vel[argMin(vel, prior, i)] < -0.12) {
      candidates.push(i);
    }
  }

  // Running path: each foot descends quickly, then its vertical velocity drops
  // around zero as it meets the ground. Looking at each foot independently
  // avoids the cancellation caused by averaging alternating feet.
  addFootContacts(
    series.map((s) => s.leftFootM),
    series.map((s) => s.leftFootVel),
    dt,
    candidates,
  );
  addFootContacts(
    series.map((s) => s.rightFootM),
    series.map((s) => s.rightFootVel),
    dt,
    candidates,
  );

  candidates.sort((a, b) => a - b);
  const merged: number[] = [];
  const cluster = Math.max(2, Math.round(0.12 / dt));
  for (const index of candidates) {
    const last = merged.at(-1);
    if (last === undefined || index - last > cluster) {
      merged.push(index);
    } else {
      // Keep the earlier point in a same-contact cluster. Heel settling and the
      // acceleration peak can describe the same landing a few frames apart.
      merged[merged.length - 1] = Math.min(last, index);
    }
  }
  return merged;
}

function addFootContacts(
  foot: number[],
  footVel: number[],
  dt: number,
  output: number[],
): void {
  const lookBack = Math.max(2, Math.round(0.18 / dt));
  const lookAhead = Math.max(2, Math.round(0.1 / dt));
  for (let i = lookBack; i < foot.length - lookAhead; i++) {
    const priorDown = Math.max(...footVel.slice(i - lookBack, i));
    const settlesNow = footVel[i - 1] > 0.1 && footVel[i] <= 0.1;
    const localLow = Math.max(
      ...foot.slice(i - 1, i + lookAhead + 1),
    );
    const nearGroundTurn = foot[i] >= localLow - 0.018;
    if (priorDown > 0.18 && settlesNow && nearGroundTurn) {
      output.push(i);
    }
  }
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function inferFootSide(point: SeriesPoint): FootSide {
  const left = point.leftFootM;
  const right = point.rightFootM;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return "unknown";
  const gap = left - right;
  if (Math.abs(gap) < 0.012) return "unknown";
  return gap > 0 ? "left" : "right";
}

export function formatSeconds(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (m) return `${m}:${s.toFixed(2).padStart(5, "0")}`;
  return `${s.toFixed(2)}s`;
}

/** 30 fps is one sample every 33 ms; display to the nearest 30 ms. */
export const DISPLAY_FRAME_MS = 30;

export function quantizeMs(ms: number): number {
  if (!Number.isFinite(ms)) return Number.NaN;
  return Math.round(ms / DISPLAY_FRAME_MS) * DISPLAY_FRAME_MS;
}

export function formatTimingMs(ms: number): string {
  if (!Number.isFinite(ms)) return "측정 불가";
  return `약 ${quantizeMs(ms)} ms`;
}

export function formatTimingPair(contactMs: number, flightMs: number): string {
  if (!Number.isFinite(contactMs) || !Number.isFinite(flightMs)) {
    return "측정 불가";
  }
  return `약 ${quantizeMs(contactMs)} / ${quantizeMs(flightMs)} ms`;
}

/** How fast the force arrives. Feeds `rateTerm` in the landing score. */
export function formatLoadingRateBwS(bwPerS: number): string {
  if (!Number.isFinite(bwPerS)) return "측정 불가";
  return `${Math.round(bwPerS)} BW/s`;
}

/** Pose angles carry a few degrees of noise, so whole degrees is the floor. */
export function formatKneeFlexDeg(deg: number): string {
  if (!Number.isFinite(deg)) return "측정 불가";
  return `약 ${Math.round(deg)}°`;
}

/**
 * Print the strike angle so it can never contradict its own label.
 *
 * Rounding alone breaks that: 7.6° classifies as midfoot but prints as "+8°",
 * and rule §3 defines +8° as forefoot. Keep the printed degree inside the band
 * the classification came from. The nudge is under one degree — smaller than
 * the pose noise the "약" already admits to — and the bounds come from the
 * classifier's own constants so the two cannot drift apart.
 */
export function formatStrikeAngleDeg(deg: number, strike: FootStrike): string {
  if (!Number.isFinite(deg) || strike === "unknown") return "측정 불가";
  let shown = Math.round(deg);
  if (strike === "rearfoot") {
    shown = Math.min(shown, REARFOOT_MAX_ANGLE_DEG);
  } else if (strike === "forefoot") {
    shown = Math.max(shown, FOREFOOT_MIN_ANGLE_DEG);
  } else {
    shown = clamp(shown, REARFOOT_MAX_ANGLE_DEG + 1, FOREFOOT_MIN_ANGLE_DEG - 1);
  }
  return `약 ${shown > 0 ? "+" : ""}${shown}°`;
}

/**
 * Steps per minute, from the spacing the clip actually repeats.
 *
 * Not from the first-to-last span, which a missed contact stretches, and no
 * longer from the 40th percentile of the gaps either. That percentile was
 * chosen to lean past a doubled gap where a footfall was missed, and leaning
 * short is exactly the wrong instinct: a detector that splits one footfall in
 * two halves a gap, and a percentile that favours the short cluster then
 * reports twice the cadence. Even with no split at all it ran 2–3% high on
 * clean fixtures, which is a bias in the direction nobody wants — telling a
 * runner their cadence is higher than it is.
 */
export function cadenceSpm(
  landings: Array<{ tContact: number; contactMs?: number }>,
): number {
  const step = stepPeriodSeconds(landings);
  return Number.isFinite(step) && step > 0 ? 60 / step : Number.NaN;
}

/** How close a gap has to sit to a candidate period to count as that period. */
const STEP_AGREEMENT = threshold("cadence_step_agreement");

/**
 * The most of a step interval one foot can spend on the ground.
 *
 * Stance over stride is the duty factor, and this analysis computes it as
 * contact / (2 × step). Running sits between 0.18 and 0.48, so contact never
 * exceeds one step interval; walking goes past 0.5 and can reach about 0.65,
 * so contact can exceed a step but not by half again. Past that the candidate
 * is not a gait, and the interval being measured is half of the real one.
 */
const MAX_CONTACT_PER_STEP = threshold("cadence_max_contact_per_step");

/**
 * The repeated step interval, in seconds.
 *
 * The median first, which assumes nothing about which way the errors go. Then
 * one check against its own double: a split footfall halves gaps, so if twice
 * the median is the spacing more of the clip agrees with, the median was the
 * half and the double is the step. Finally an average of the gaps that agree,
 * so the answer comes from every step rather than the one in the middle.
 */
function stepPeriodSeconds(
  landings: Array<{ tContact: number; contactMs?: number }>,
): number {
  if (landings.length < 2) return Number.NaN;
  const gaps = landings
    .slice(1)
    .map((landing, i) => landing.tContact - landings[i].tContact)
    .filter((gap) => gap >= MIN_STEP_S && gap <= MAX_STEP_S);
  if (!gaps.length) return Number.NaN;

  const middle = median(gaps);
  if (!Number.isFinite(middle) || middle <= 0) return Number.NaN;

  const agreeing = (period: number) =>
    gaps.filter((gap) => Math.abs(gap - period) <= period * STEP_AGREEMENT);

  // Two ways the median can be half of the real step, and they need different
  // evidence. Where only some footfalls were split, the unsplit ones are still
  // there and outnumber the halves. Where most were split they do not, and the
  // measurement that settles it is how long a foot was on the ground: a foot
  // cannot be down for longer than the step it is part of.
  const contact =
    median(
      landings
        .map((landing) => landing.contactMs ?? Number.NaN)
        .filter(Number.isFinite),
    ) / 1000;
  const impossible =
    Number.isFinite(contact) && middle * MAX_CONTACT_PER_STEP < contact;

  const doubled = middle * 2;
  // Only worth asking when a doubled step is still a step a person could take.
  const fundamental =
    doubled <= MAX_STEP_S &&
    (impossible || agreeing(doubled).length > agreeing(middle).length)
      ? doubled
      : middle;

  const matched = agreeing(fundamental);
  return matched.length
    ? matched.reduce((sum, gap) => sum + gap, 0) / matched.length
    : fundamental;
}

/**
 * How far ahead the foot landed, in centimetres. Rounded to the nearest
 * centimetre: the ankle landmark moves a few pixels between frames, and at a
 * typical framing one pixel is already several millimetres, so a decimal here
 * would be inventing precision.
 */
export function formatFootAhead(meters: number): string {
  if (!Number.isFinite(meters)) return "측정 불가";
  const cm = Math.round(meters * 100);
  // Behind the hip at contact is rare but real — it happens on an uphill or a
  // hard acceleration — and printing it as a negative distance is clearer than
  // clamping it to zero and pretending the foot landed under the body.
  return `${cm > 0 ? "앞 " : cm < 0 ? "뒤 " : ""}${Math.abs(cm)} cm`;
}

/** The same distance against the runner's own height, so two people compare. */
export function formatFootAheadRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "측정 불가";
  return `신장의 ${Math.round(ratio * 100)}%`;
}

/**
 * Whether the fore-aft distance may be turned into a verdict, and if so what it
 * says.
 *
 * Today it never may: `overstride_ratio_notable` is marked withheld in
 * shared/thresholds.yaml because running has no agreed boundary for this, and
 * the honest thing to publish is the centimetres, not a grade. The comparison
 * is written out anyway rather than deleted — it is what the screen would say
 * the moment the threshold earns a real status, and leaving it here keeps that
 * change to one line of YAML.
 */
export function overstrideVerdict(ratio: number): string | null {
  if (!Number.isFinite(ratio)) return null;
  if (!isPublishable("overstride_ratio_notable")) return null;
  return ratio >= threshold("overstride_ratio_notable")
    ? "몸보다 뚜렷하게 앞에서 닿았습니다."
    : "몸 아래에 가깝게 닿았습니다.";
}

/** What to show where a verdict would go while the threshold is withheld. */
export function overstrideVerdictOrWithheld(ratio: number): string {
  if (!Number.isFinite(ratio)) return "측정 불가";
  return overstrideVerdict(ratio) ?? WITHHELD_LABEL;
}

/**
 * Frontal knee alignment, in whole degrees. Inward is the direction worth
 * naming, so the sign is spelled out rather than left as a minus.
 */
export function formatKneeValgusDeg(deg: number): string {
  if (!Number.isFinite(deg)) return "측정 불가";
  const rounded = Math.round(deg);
  if (rounded === 0) return "0°";
  return `${rounded > 0 ? "안쪽" : "바깥쪽"} ${Math.abs(rounded)}°`;
}

/** Opposite-hip drop, in whole degrees. Positive is the swing side dropping. */
export function formatPelvicDropDeg(deg: number): string {
  if (!Number.isFinite(deg)) return "측정 불가";
  const rounded = Math.round(deg);
  if (rounded === 0) return "0°";
  return `${rounded > 0 ? "반대쪽 " : "디딘 쪽 "}${Math.abs(rounded)}°`;
}

/**
 * Both frontal readings are published as angles and never as grades, for the
 * same reason the fore-aft distance is: the thresholds they would be compared
 * against are marked withheld, because the boundaries that exist come from slow
 * single-leg screening rather than from running video. These two functions are
 * what the screen will call once that changes, and until then they return null
 * so a caller cannot accidentally show one.
 */
export function kneeValgusVerdict(deg: number): string | null {
  if (!Number.isFinite(deg)) return null;
  if (!isPublishable("frontal_knee_valgus_notable_deg")) return null;
  return deg >= threshold("frontal_knee_valgus_notable_deg")
    ? "디딘 다리의 무릎이 안쪽으로 뚜렷하게 들어갑니다."
    : "무릎이 발과 엉덩이 사이에 대체로 정렬돼 있습니다.";
}

export function pelvicDropVerdict(deg: number): string | null {
  if (!Number.isFinite(deg)) return null;
  if (!isPublishable("frontal_pelvic_drop_notable_deg")) return null;
  return deg >= threshold("frontal_pelvic_drop_notable_deg")
    ? "디딘 다리 반대쪽 골반이 뚜렷하게 내려갑니다."
    : "골반이 비교적 수평으로 유지됩니다.";
}

export function compareHint(score: number): string {
  if (score < 25) return "평지 걷기·부드러운 조깅에 가깝습니다.";
  if (score < 45) return "일반적인 달리기의 착지 충격 범위입니다.";
  if (score < 65) return "빠른 달리기나 다소 딱딱한 착지일 수 있습니다.";
  if (score < 80) return "드롭 점프·급정지에 가까운 높은 충격입니다.";
  return "매우 짧은 시간에 큰 힘이 실리는 착지입니다. 영상을 여러 각도에서 다시 확인해 보세요.";
}
