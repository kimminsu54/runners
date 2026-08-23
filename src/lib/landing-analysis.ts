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
const PEAK_OVER_MEAN = Math.PI / 2;

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

export type AnalysisResult = {
  series: SeriesPoint[];
  landings: Landing[];
  detectedRatio: number;
  metersPerPixel: number;
  warnings: string[];
};

export type AnalyzeOptions = {
  statureM: number;
  massKg: number;
  width: number;
  height: number;
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

function estimateMetersPerPixel(
  frames: PoseFrame[],
  statureM: number,
  width: number,
  height: number,
): number {
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
    return statureM / (height * 0.55);
  }
  return statureM / staturePx;
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

  const mpp = estimateMetersPerPixel(frames, options.statureM, options.width, options.height);
  const comRaw: number[] = [];
  const kneeRaw: number[] = [];
  const leftFootRaw: number[] = [];
  const rightFootRaw: number[] = [];
  const t: number[] = [];

  for (const frame of frames) {
    t.push(frame.t);
    const lm = frame.landmarks;
    if (!lm) {
      comRaw.push(Number.NaN);
      kneeRaw.push(Number.NaN);
      leftFootRaw.push(Number.NaN);
      rightFootRaw.push(Number.NaN);
      continue;
    }
    const hip = mid(lm[LM.leftHip], lm[LM.rightHip]);
    if (!hip) {
      comRaw.push(Number.NaN);
      kneeRaw.push(Number.NaN);
      leftFootRaw.push(Number.NaN);
      rightFootRaw.push(Number.NaN);
      continue;
    }
    comRaw.push(-hip.y * options.height * mpp);
    leftFootRaw.push(
      footHeight(lm[LM.leftHeel], lm[LM.leftAnkle], options.height, mpp),
    );
    rightFootRaw.push(
      footHeight(lm[LM.rightHeel], lm[LM.rightAnkle], options.height, mpp),
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

  const filled = fillGaps(comRaw);
  const com = movingAverage(filled, 5);
  const vel = movingAverage(derivative(com, t), 5);
  const acc = movingAverage(derivative(vel, t), 5);
  const knee = fillGaps(kneeRaw);
  const leftFoot = movingAverage(fillGaps(leftFootRaw), 3);
  const rightFoot = movingAverage(fillGaps(rightFootRaw), 3);
  const leftFootVel = movingAverage(derivative(leftFoot, t), 3);
  const rightFootVel = movingAverage(derivative(rightFoot, t), 3);

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
    };
  });

  const landings = detectLandings(series, options.massKg);
  if (!landings.length) {
    warnings.push("뚜렷한 착지 충격을 찾지 못했습니다. 점프·달리기처럼 발이 떨어졌다 닿는 구간이 보이게 찍어 보세요.");
  }

  return {
    series,
    landings,
    detectedRatio,
    metersPerPixel: mpp,
    warnings,
  };
}

function footHeight(
  heel: Landmark | undefined,
  ankle: Landmark | undefined,
  height: number,
  metersPerPixel: number,
): number {
  const candidates = [heel, ankle].filter(
    (p): p is Landmark => Boolean(p) && isVisible(p, 0.25),
  );
  if (!candidates.length) return Number.NaN;
  // Image y grows downwards. The lowest visible foot point is the best contact
  // proxy and also works when the heel is briefly hidden by the other leg.
  return Math.max(...candidates.map((p) => p.y)) * height * metersPerPixel;
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
  interval: ContactInterval | null;
  flightS: number;
};

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

    const last = raws.at(-1);
    if (last && contactIdx - last.contactIdx < minSep) continue;

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
    raws.push({
      contactIdx,
      peakIdx: argMax(acc, contactIdx, peakWindowEnd),
      absorbIdx,
      impactVel,
      interval,
      flightS: interval ? flightBefore(intervals, interval) : Number.NaN,
    });
  }

  const medianContactS = median(
    raws.map((r) => (r.interval ? r.interval.end - r.interval.start : Number.NaN)),
  );
  const medianFlightS = median(raws.map((r) => r.flightS));

  return raws.map((raw) => {
    const contactS = raw.interval
      ? raw.interval.end - raw.interval.start
      : medianContactS;
    const flightS = Number.isFinite(raw.flightS) ? raw.flightS : medianFlightS;
    const gaitBased =
      Number.isFinite(contactS) && contactS > 0.05 && Number.isFinite(flightS);

    const vImp = Math.abs(raw.impactVel);
    const peakAcc = Math.max(0, acc[raw.peakIdx]);
    const measuredGrfBw = 1 + peakAcc / G;
    // One foot carries the whole body over a step period, so the mean force in
    // that stance is bodyweight scaled by stepPeriod/contactTime. A shorter
    // contact with more airtime is what makes a fast pace hit harder.
    const peakGrfBw = gaitBased
      ? clamp((PEAK_OVER_MEAN * (contactS + flightS)) / contactS, 1.05, 6)
      : clamp(measuredGrfBw, 1.05, 4);

    const absorptionMs = (series[raw.absorbIdx].t - series[raw.contactIdx].t) * 1000;
    const measuredRiseS = series[raw.peakIdx].t - series[raw.contactIdx].t;
    const riseS = gaitBased
      ? Math.max(0.4 * contactS, dt)
      : Math.max(measuredRiseS, dt);
    const loadingRateBwS = peakGrfBw / riseS;
    const dutyFactor = gaitBased
      ? contactS / (2 * (contactS + flightS))
      : Number.NaN;

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
      side: raw.interval?.side ?? inferFootSide(series[raw.contactIdx]),
      gaitBased,
      note: "",
    };
    landing.note = landingNote(landing);
    return landing;
  });
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

function flightBefore(
  intervals: ContactInterval[],
  current: ContactInterval,
): number {
  let previousEnd = Number.NaN;
  for (const interval of intervals) {
    if (interval === current) continue;
    if (interval.start >= current.start) continue;
    if (!Number.isFinite(previousEnd) || interval.end > previousEnd) {
      previousEnd = interval.end;
    }
  }
  if (!Number.isFinite(previousEnd)) return Number.NaN;
  return Math.max(0, current.start - previousEnd);
}

function groundContactIntervals(
  series: SeriesPoint[],
  dt: number,
): ContactInterval[] {
  return [
    ...footIntervals(series.map((s) => s.leftFootM), series, dt, "left"),
    ...footIntervals(series.map((s) => s.rightFootM), series, dt, "right"),
  ].sort((a, b) => a.start - b.start);
}

function footIntervals(
  foot: number[],
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
  // Keep this band tight. A loose band counts the early swing as stance, which
  // stretches contact time and erases the difference between paces.
  const tolerance = Math.max(0.015, swing * 0.12);
  const grounded = foot.map(
    (value, i) => Number.isFinite(value) && value >= ground[i] - tolerance,
  );

  const minFrames = Math.max(2, Math.round(0.05 / dt));
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
    .filter(([from, to]) => to - from + 1 >= minFrames)
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
