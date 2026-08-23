import {
  distPx,
  isVisible,
  kneeFlexionDeg,
  LM,
  mid,
  type Landmark,
} from "@/lib/pose";
import { argMax, argMin, clamp, derivative, median, movingAverage } from "@/lib/signal";

export const G = 9.80665;

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
};

export type Risk = "low" | "moderate" | "elevated" | "high" | "severe";

export type Landing = {
  index: number;
  tContact: number;
  tPeakForce: number;
  impactVelocity: number;
  peakGrfBw: number;
  peakForceN: number;
  absorptionMs: number;
  equivalentDropCm: number;
  loadingRateBwS: number;
  kneeFlexContact: number;
  kneeFlexPeak: number;
  damageScore: number;
  risk: Risk;
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
  absorptionMs: number;
  kneeFlexContact: number;
}): number {
  const bwTerm = clamp(((input.peakGrfBw - 1.15) / 6.5) * 52, 0, 52);
  const rateTerm = clamp((input.loadingRateBwS / 90) * 24, 0, 24);
  const stiffKnee = clamp((70 - input.kneeFlexContact) / 70, 0, 1) * 14;
  const snap = input.absorptionMs < 70 ? 10 : input.absorptionMs < 110 ? 5 : 0;
  return clamp(Math.round(bwTerm + rateTerm + stiffKnee + snap), 0, 100);
}

function landingNote(l: Omit<Landing, "note" | "index">): string {
  const bits: string[] = [];
  if (l.absorptionMs < 90 && l.kneeFlexContact < 25) {
    bits.push("무릎을 거의 펴고 짧게 받아 뻣뻣한 착지로 보입니다.");
  } else if (l.kneeFlexPeak - l.kneeFlexContact > 25 && l.absorptionMs >= 120) {
    bits.push("착지 후 무릎을 굽혀 충격을 나눠 받은 편입니다.");
  }
  if (l.peakGrfBw >= 3.5) {
    bits.push("추정 최대 지면반력이 체중의 3.5배를 넘습니다.");
  } else if (l.peakGrfBw < 1.8) {
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
  const t: number[] = [];

  for (const frame of frames) {
    t.push(frame.t);
    const lm = frame.landmarks;
    if (!lm) {
      comRaw.push(Number.NaN);
      kneeRaw.push(Number.NaN);
      continue;
    }
    const hip = mid(lm[LM.leftHip], lm[LM.rightHip]);
    if (!hip) {
      comRaw.push(Number.NaN);
      kneeRaw.push(Number.NaN);
      continue;
    }
    comRaw.push(-hip.y * options.height * mpp);
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

function fillGaps(values: number[]): number[] {
  const out = values.slice();
  let last = out.find((v) => Number.isFinite(v)) ?? 0;
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i])) last = out[i];
    else out[i] = last;
  }
  return out;
}

function detectLandings(series: SeriesPoint[], massKg: number): Landing[] {
  if (series.length < 8) return [];
  const acc = series.map((s) => s.acc);
  const vel = series.map((s) => s.vel);
  const dtMedian = median(
    series.slice(1).map((s, i) => s.t - series[i].t),
  );
  const dt = Number.isFinite(dtMedian) && dtMedian > 0 ? dtMedian : 1 / 30;
  const minSep = Math.max(4, Math.round(0.28 / dt));
  const landings: Landing[] = [];

  const accPeakMin = 9;
  for (let i = 3; i < series.length - 3; i++) {
    const a = acc[i];
    if (!Number.isFinite(a) || a < accPeakMin) continue;
    const isPeak = a >= acc[i - 1] && a >= acc[i + 1] && a >= acc[i - 2] && a >= acc[i + 2];
    if (!isPeak) continue;

    const from = Math.max(0, i - Math.round(0.16 / dt));
    const minVelIdx = argMin(vel, from, i);
    const impactVel = vel[minVelIdx];
    if (!(impactVel < -0.55)) continue;

    const last = landings.at(-1);
    if (last && i - last.index < minSep) {
      if (a > series[last.index].acc) landings.pop();
      else continue;
    }

    const contactFrom = Math.max(0, minVelIdx);
    let contactIdx = contactFrom;
    for (let k = minVelIdx; k <= i; k++) {
      if (acc[k] > 8) {
        contactIdx = k;
        break;
      }
    }

    const after = Math.min(series.length - 1, i + Math.round(0.22 / dt));
    let absorbIdx = i;
    for (let k = i; k <= after; k++) {
      absorbIdx = k;
      if (vel[k] >= -0.15) break;
    }
    const peakIdx = argMax(acc, contactIdx, absorbIdx);
    const absorptionMs = Math.max(20, (series[absorbIdx].t - series[contactIdx].t) * 1000);
    const peakAcc = acc[peakIdx];
    const peakGrfBw = clamp(1 + peakAcc / G, 1.05, 12);
    const vImp = Math.abs(vel[contactIdx] < impactVel ? vel[contactIdx] : impactVel);
    const equivalentDropCm = ((vImp * vImp) / (2 * G)) * 100;
    const loadingRateBwS = peakGrfBw / (absorptionMs / 1000);
    const kneeFlexContact = finiteOr(series[contactIdx].kneeFlex, 20);
    const kneeSlice = series.slice(contactIdx, absorbIdx + 1).map((s) => s.kneeFlex);
    const kneeFlexPeak = Math.max(kneeFlexContact, ...kneeSlice.filter(Number.isFinite));

    const base = {
      tContact: series[contactIdx].t,
      tPeakForce: series[peakIdx].t,
      impactVelocity: vImp,
      peakGrfBw,
      peakForceN: peakGrfBw * massKg * G,
      absorptionMs,
      equivalentDropCm,
      loadingRateBwS,
      kneeFlexContact,
      kneeFlexPeak,
      damageScore: 0,
      risk: "low" as Risk,
    };
    const score = damageScore({
      peakGrfBw,
      loadingRateBwS,
      absorptionMs,
      kneeFlexContact,
    });
    const landing: Landing = {
      ...base,
      index: peakIdx,
      damageScore: score,
      risk: riskFromScore(score),
      note: "",
    };
    landing.note = landingNote(landing);
    landings.push(landing);
  }

  return landings;
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
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
