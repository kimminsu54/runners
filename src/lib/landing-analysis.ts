import {
  distPx,
  isVisible,
  kneeFlexionDeg,
  LM,
  mid,
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

export const G = 9.80665;

// A running stance looks roughly like a half-sine of vertical force, so the
// peak sits about pi/2 above the mean force carried during that contact.
const PEAK_OVER_MEAN = 1.2;

export type PoseFrame = {
  t: number;
  landmarks: Landmark[] | null;
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
};

export type Risk = "low" | "moderate" | "elevated" | "high" | "severe";

export type FootSide = "left" | "right" | "unknown";

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
  note: string;
};

export type QualityLevel = "good" | "fair" | "poor";

export type AnalysisQuality = {
  level: QualityLevel;
  subjectHeightRatio: number;
  detectedRatio: number;
  cadenceConsistency: number;
  reasons: string[];
};

export type AnalysisResult = {
  series: SeriesPoint[];
  landings: Landing[];
  detectedRatio: number;
  metersPerPixel: number;
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
};

function riskFromScore(score: number): Risk {
  if (score < 25) return "low";
  if (score < 45) return "moderate";
  if (score < 65) return "elevated";
  if (score < 80) return "high";
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

function damageScore(input: {
  peakGrfBw: number;
  loadingRateBwS: number;
  dutyFactor: number;
  kneeFlexContact: number;
}): number {
  // Easy jogging sits near 1.8 BW and a sprint near 4.5 BW, so anchor the
  // scale there instead of letting ordinary running saturate the score.
  const bwTerm = clamp(((input.peakGrfBw - 1.7) / 2.8) * 45, 0, 45);
  const rateTerm = clamp(((input.loadingRateBwS - 12) / 70) * 25, 0, 25);
  const stiffKnee = clamp((55 - input.kneeFlexContact) / 55, 0, 1) * 15;
  const duty = input.dutyFactor;
  const flightTerm = !Number.isFinite(duty)
    ? 0
    : duty < 0.25
      ? 15
      : duty < 0.3
        ? 10
        : duty < 0.35
          ? 5
          : 0;
  return clamp(
    Math.round(bwTerm + rateTerm + stiffKnee + flightTerm),
    0,
    100,
  );
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
      `접지 ${Math.round(l.contactMs)} ms · 체공 ${Math.round(l.flightMs)} ms.`,
    );
  }
  if (l.peakGrfBw >= 3.4) {
    bits.push("빠른 페이스에서 나타나는 큰 반력입니다.");
  } else if (l.peakGrfBw < 2) {
    bits.push("걷기·가벼운 조깅에 가까운 충격 수준입니다.");
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
): { metersPerPixel: number; staturePx: number } {
  const lengths: number[] = [];
  for (const frame of frames) {
    const lm = frame.landmarks;
    if (!lm) continue;
    const nose = lm[LM.nose];
    const heel = mid(lm[LM.leftHeel], lm[LM.rightHeel]) ?? mid(lm[LM.leftAnkle], lm[LM.rightAnkle]);
    if (!isVisible(nose, 0.3) || !heel) continue;
    const px = distPx(nose, heel, width, height);
    if (px > 20) lengths.push(px / 0.92);
  }
  const staturePx = median(lengths);
  if (!Number.isFinite(staturePx) || staturePx < 40) {
    return {
      metersPerPixel: statureM / (height * 0.55),
      staturePx: Number.isFinite(staturePx) ? staturePx : Number.NaN,
    };
  }
  return { metersPerPixel: statureM / staturePx, staturePx };
}

function assessQuality(
  subjectHeightRatio: number,
  detectedRatio: number,
  landings: Landing[],
): AnalysisQuality {
  const gaps = landings
    .slice(1)
    .map((l, i) => l.tContact - landings[i].tContact);
  const typical = median(gaps);
  const cadenceConsistency =
    gaps.length >= 3 && Number.isFinite(typical) && typical > 0
      ? gaps.filter((g) => Math.abs(g - typical) <= typical * 0.3).length /
        gaps.length
      : Number.NaN;

  const reasons: string[] = [];
  if (!(subjectHeightRatio >= 0.2)) {
    reasons.push(
      `사람이 화면 높이의 ${Math.round((subjectHeightRatio || 0) * 100)}%만 차지합니다. 접지 순간을 재려면 25% 이상으로 크게 담아 주세요.`,
    );
  }
  if (detectedRatio < 0.8) {
    reasons.push(
      `자세가 ${Math.round(detectedRatio * 100)}% 구간에서만 잡혔습니다. 전신이 계속 보이도록 찍어 주세요.`,
    );
  }
  if (Number.isFinite(cadenceConsistency) && cadenceConsistency < 0.55) {
    reasons.push(
      "착지 간격이 고르지 않아 일부 착지를 놓쳤을 수 있습니다. 같은 속도로 곧게 달리는 구간이 좋습니다.",
    );
  }

  const severe =
    !(subjectHeightRatio >= 0.2) ||
    detectedRatio < 0.75 ||
    (Number.isFinite(cadenceConsistency) && cadenceConsistency < 0.45);
  const level: QualityLevel = severe ? "poor" : reasons.length ? "fair" : "good";
  return {
    level,
    subjectHeightRatio,
    detectedRatio,
    cadenceConsistency,
    reasons,
  };
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

  const { metersPerPixel: mpp, staturePx } = measureSubject(
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

  // Only bridge momentary dropouts. Holding the last value across a long gap
  // invents a motionless body, which then reads as a very long ground contact.
  const comAbsolute = movingAverage(fillShortGaps(comRaw, 3), 5);
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
  const leftFoot = movingAverage(fillShortGaps(leftFootRaw, 2), 3);
  const rightFoot = movingAverage(fillShortGaps(rightFootRaw, 2), 3);
  const leftFootVel = movingAverage(derivative(leftFoot, t), 3);
  const rightFootVel = movingAverage(derivative(rightFoot, t), 3);
  // Absolute foot speed tells stance from swing even while the hip rises and
  // falls, which the hip-relative height alone cannot do.
  const leftFootSpeed = movingAverage(
    derivative(movingAverage(fillShortGaps(leftFootAbsRaw, 2), 3), t),
    3,
  ).map(Math.abs);
  const rightFootSpeed = movingAverage(
    derivative(movingAverage(fillShortGaps(rightFootAbsRaw, 2), 3), t),
    3,
  ).map(Math.abs);

  const series: SeriesPoint[] = t.map((time, i) => {
    const a = acc[i];
    const grfBw = Number.isFinite(a) ? clamp(1 + a / G, 0.2, 12) : Number.NaN;
    return {
      t: time,
      comM: com[i],
      vel: vel[i],
      acc: a,
      grfBw,
      kneeFlex: knee[i],
      leftFootM: leftFoot[i],
      rightFootM: rightFoot[i],
      leftFootVel: leftFootVel[i],
      rightFootVel: rightFootVel[i],
      leftFootSpeed: leftFootSpeed[i],
      rightFootSpeed: rightFootSpeed[i],
    };
  });

  const detectedLandings = detectLandings(series, options.massKg);
  const quality = assessQuality(subjectHeightRatio, detectedRatio, detectedLandings);

  // Contact and flight timing is only meaningful when the runner is big enough
  // and tracked continuously. Publishing a number from a poor clip is what made
  // every video look like the same hard landing.
  const landings =
    quality.level === "poor"
      ? detectedLandings.map(withoutGaitTiming)
      : detectedLandings;

  if (quality.level === "poor" && landings.length) {
    warnings.push(
      `촬영 조건이 부족해 접지·체공 시간과 페이스는 표시하지 않습니다. ${quality.reasons[0] ?? ""}`.trim(),
    );
  } else if (quality.level === "fair" && landings.length) {
    warnings.push(`측정 오차가 큰 조건입니다. ${quality.reasons[0] ?? ""}`.trim());
  }
  if (!landings.length) {
    warnings.push("뚜렷한 착지 충격을 찾지 못했습니다. 점프·달리기처럼 발이 떨어졌다 닿는 구간이 보이게 찍어 보세요.");
  }

  return {
    series,
    landings,
    detectedRatio,
    metersPerPixel: mpp,
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
export function analyzeLandingsAuto(
  frames: PoseFrame[],
  options: AnalyzeOptions,
): { result: AnalysisResult; slowMotionFactor: number; autoDetected: boolean } {
  if (options.slowMotionFactor && options.slowMotionFactor > 0) {
    return {
      result: analyzeLandings(frames, options),
      slowMotionFactor: options.slowMotionFactor,
      autoDetected: false,
    };
  }

  // Do not infer playback speed from a runner too small or intermittently
  // tracked. A missed step can mimic slow motion exactly.
  const baseline = analyzeLandings(frames, { ...options, slowMotionFactor: 1 });
  if (
    baseline.quality.subjectHeightRatio < 0.2 ||
    baseline.quality.detectedRatio < 0.75
  ) {
    return { result: baseline, slowMotionFactor: 1, autoDetected: false };
  }

  let best: { result: AnalysisResult; factor: number; score: number } | null = null;
  for (const factor of SLOW_MOTION_CANDIDATES) {
    const result = analyzeLandings(frames, { ...options, slowMotionFactor: factor });
    const score = gaitPlausibility(result) - (factor === 1 ? 0 : 0.12);
    if (!best || score > best.score) best = { result, factor, score };
  }

  const chosen = best ?? {
    result: analyzeLandings(frames, { ...options, slowMotionFactor: 1 }),
    factor: 1,
    score: 0,
  };
  return {
    result: chosen.result,
    slowMotionFactor: chosen.factor,
    autoDetected: chosen.factor !== 1,
  };
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

function withoutGaitTiming(landing: Landing): Landing {
  if (!landing.gaitBased) return landing;
  const fallbackGrf = clamp(landing.peakGrfBw, 1.05, 3);
  const score = damageScore({
    peakGrfBw: fallbackGrf,
    loadingRateBwS: landing.loadingRateBwS,
    dutyFactor: Number.NaN,
    kneeFlexContact: landing.kneeFlexContact,
  });
  return {
    ...landing,
    peakGrfBw: fallbackGrf,
    peakForceN: (landing.peakForceN / landing.peakGrfBw) * fallbackGrf,
    contactMs: Number.NaN,
    flightMs: Number.NaN,
    dutyFactor: Number.NaN,
    gaitBased: false,
    damageScore: score,
    risk: riskFromScore(score),
  };
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
};

// Human running stance and step timings. Anything outside these came from a
// tracking dropout, not from the runner.
const MIN_CONTACT_S = 0.06;
const MAX_CONTACT_S = 0.4;
const MIN_STEP_S = 0.15;
const MAX_STEP_S = 0.7;

function detectLandings(series: SeriesPoint[], massKg: number): Landing[] {
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
    const contactS = Number.isFinite(raw.contactS)
      ? Number.isFinite(medianContactS)
        ? clamp(raw.contactS, medianContactS * 0.75, medianContactS * 1.35)
        : raw.contactS
      : medianContactS;
    const gaitBased =
      Number.isFinite(contactS) &&
      Number.isFinite(stepPeriodS) &&
      contactS <= stepPeriodS;
    const flightS = gaitBased ? Math.max(0, stepPeriodS - contactS) : Number.NaN;

    const vImp = Math.abs(raw.impactVel);
    const peakAcc = Math.max(0, acc[raw.peakIdx]);
    const measuredGrfBw = 1 + peakAcc / G;
    // One foot carries the whole body over a step period, so the mean force in
    // that stance is bodyweight scaled by stepPeriod/contactTime. A shorter
    // contact with more airtime is what makes a fast pace hit harder.
    const peakGrfBw = gaitBased
      ? clamp((PEAK_OVER_MEAN * stepPeriodS) / contactS, 1.05, 4.5)
      : clamp(measuredGrfBw, 1.05, 4);

    const absorptionMs = (series[raw.absorbIdx].t - series[raw.contactIdx].t) * 1000;
    const measuredRiseS = series[raw.peakIdx].t - series[raw.contactIdx].t;
    const riseS = gaitBased
      ? Math.max(0.4 * contactS, dt)
      : Math.max(measuredRiseS, dt);
    const loadingRateBwS = peakGrfBw / riseS;
    const dutyFactor = gaitBased ? contactS / (2 * stepPeriodS) : Number.NaN;

    const kneeFlexContact = finiteOr(series[raw.contactIdx].kneeFlex, 20);
    const kneeSlice = series
      .slice(raw.contactIdx, raw.absorbIdx + 1)
      .map((s) => s.kneeFlex)
      .filter(Number.isFinite);
    const kneeFlexPeak = Math.max(kneeFlexContact, ...kneeSlice);

    const score = damageScore({
      peakGrfBw,
      loadingRateBwS,
      dutyFactor,
      kneeFlexContact,
    });
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
      side: raw.side,
      gaitBased,
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
  // The hip drops through mid-stance, so this band has to be wide enough to
  // hold the whole stance. Foot stillness is what keeps it out of the swing.
  const tolerance = Math.max(0.02, swing * 0.35);
  const swingSpeed = percentile(speed.filter(Number.isFinite), 0.8);
  const stillSpeed =
    Number.isFinite(swingSpeed) && swingSpeed > 0
      ? Math.max(0.24, swingSpeed * 0.9)
      : Number.POSITIVE_INFINITY;
  const grounded = foot.map(
    (value, i) =>
      Number.isFinite(value) &&
      value >= ground[i] - tolerance &&
      (!Number.isFinite(speed[i]) || speed[i] <= stillSpeed),
  );

  const minFrames = Math.max(2, Math.round(MIN_CONTACT_S / dt));
  const maxFrames = Math.ceil(MAX_CONTACT_S / dt) + 1;
  const maxGapFrames = Math.max(1, Math.round(0.05 / dt));
  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= grounded.length; i++) {
    const on = i < grounded.length && grounded[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      spans.push([start, i - 1]);
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

export function compareHint(score: number): string {
  if (score < 25) return "평지 걷기·부드러운 조깅에 가깝습니다.";
  if (score < 45) return "일반적인 달리기의 착지 충격 범위입니다.";
  if (score < 65) return "빠른 달리기나 다소 딱딱한 착지일 수 있습니다.";
  if (score < 80) return "드롭 점프·급정지에 가까운 높은 충격입니다.";
  return "매우 짧은 시간에 큰 힘이 실리는 착지입니다. 영상을 여러 각도에서 다시 확인해 보세요.";
}
