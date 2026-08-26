import {
  footStrikeLabel,
  formatSeconds,
  type AnalysisResult,
  type FootSide,
  type Landing,
  type PoseFrame,
} from "@/lib/landing-analysis";
import { isVisible, LM, mid, type Landmark } from "@/lib/pose";

export type GaitPhase = "stance" | "flight" | "air" | "unknown";

export type PostureCue = {
  level: "ok" | "watch";
  title: string;
  detail: string;
};

export type LiveMoment = {
  t: number;
  phase: GaitPhase;
  phaseLabel: string;
  kneeFlex: number;
  grfBw: number;
  trunkLeanDeg: number;
  side: FootSide;
  sideLabel: string;
  landing: Landing | null;
  landingIndex: number;
  landingOrder: number;
  nextLandingIndex: number;
  nextLandingInS: number;
  strikeLabel: string;
  cues: PostureCue[];
  headline: string;
  trusted: boolean;
};

const PHASE_LABEL: Record<GaitPhase, string> = {
  stance: "접지 중",
  flight: "체공",
  air: "스윙",
  unknown: "구간 미확정",
};

const SIDE_LABEL: Record<FootSide, string> = {
  left: "왼발",
  right: "오른발",
  unknown: "발 미확정",
};

export function nearestIndexByTime(times: number[], t: number): number {
  if (!times.length) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo <= 0) return 0;
  return Math.abs(times[lo] - t) < Math.abs(times[lo - 1] - t) ? lo : lo - 1;
}

export function nearestPoseFrame(
  frames: PoseFrame[],
  videoTime: number,
): PoseFrame | null {
  const index = nearestIndexByTime(
    frames.map((frame) => frame.t),
    videoTime,
  );
  return index >= 0 ? frames[index] ?? null : null;
}

export function analysisTimeFromVideo(videoTime: number, clockFactor: number): number {
  const factor = clockFactor > 0 ? clockFactor : 1;
  return videoTime / factor;
}

export function videoTimeFromAnalysis(analysisTime: number, clockFactor: number): number {
  const factor = clockFactor > 0 ? clockFactor : 1;
  return analysisTime * factor;
}

function stanceEndS(landing: Landing): number {
  const contactS = Number.isFinite(landing.contactMs)
    ? landing.contactMs / 1000
    : 0.12;
  return landing.tContact + Math.max(0.06, contactS);
}

function flightEndS(landing: Landing): number {
  const flightS = Number.isFinite(landing.flightMs) ? landing.flightMs / 1000 : 0;
  return stanceEndS(landing) + flightS;
}

export function trunkLeanDeg(landmarks: Landmark[] | null | undefined): number {
  if (!landmarks?.length) return Number.NaN;
  const shoulder = mid(landmarks[LM.leftShoulder], landmarks[LM.rightShoulder]);
  const hip = mid(landmarks[LM.leftHip], landmarks[LM.rightHip]);
  if (
    !shoulder ||
    !hip ||
    !isVisible(landmarks[LM.leftShoulder], 0.3) ||
    !isVisible(landmarks[LM.rightShoulder], 0.3)
  ) {
    return Number.NaN;
  }
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y;
  if (Math.abs(dy) < 1e-4) return Number.NaN;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export function liveMomentAt(
  result: AnalysisResult,
  t: number,
  landmarks?: Landmark[] | null,
): LiveMoment {
  const trusted = result.quality.level !== "poor";
  const times = result.series.map((sample) => sample.t);
  const sample =
    nearestIndexByTime(times, t) >= 0
      ? result.series[nearestIndexByTime(times, t)]
      : undefined;

  let landingIndex = -1;
  let phase: GaitPhase = result.landings.length ? "air" : "unknown";

  for (let i = 0; i < result.landings.length; i++) {
    const landing = result.landings[i];
    const stanceEnd = stanceEndS(landing);
    const flightEnd = flightEndS(landing);
    if (t >= landing.tContact - 0.02 && t <= stanceEnd) {
      landingIndex = i;
      phase = "stance";
      break;
    }
    if (t > stanceEnd && t <= flightEnd + 0.01) {
      landingIndex = i;
      phase = "flight";
      break;
    }
  }

  if (landingIndex < 0 && result.landings.length) {
    for (let i = result.landings.length - 1; i >= 0; i--) {
      if (result.landings[i].tContact <= t) {
        landingIndex = i;
        break;
      }
    }
  }

  const landing = landingIndex >= 0 ? result.landings[landingIndex] : null;
  let side: FootSide = landing?.side ?? "unknown";
  if (sample && side === "unknown") {
    const gap = sample.leftFootM - sample.rightFootM;
    if (Number.isFinite(gap) && Math.abs(gap) >= 0.012) {
      side = gap > 0 ? "left" : "right";
    }
  }

  const nextLandingIndex = result.landings.findIndex((row) => row.tContact > t + 0.01);
  const nextLandingInS =
    nextLandingIndex >= 0
      ? result.landings[nextLandingIndex].tContact - t
      : Number.NaN;

  const kneeFlex = Number.isFinite(sample?.kneeFlex)
    ? sample!.kneeFlex
    : landing?.kneeFlexContact ?? Number.NaN;
  const lean = trunkLeanDeg(landmarks);
  const grfBw = trusted && Number.isFinite(sample?.grfBw) ? sample!.grfBw : Number.NaN;
  const strikeLabel =
    trusted && landing && landing.footStrike !== "unknown"
      ? footStrikeLabel[landing.footStrike]
      : "판정 불가";

  const cues = postureCues({
    phase,
    trusted,
    kneeFlex,
    landing,
    lean,
  });

  const headline = liveHeadline({
    phase,
    side,
    kneeFlex,
    landing,
    trusted,
    nextLandingInS,
  });

  return {
    t,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    kneeFlex,
    grfBw,
    trunkLeanDeg: lean,
    side,
    sideLabel: SIDE_LABEL[side],
    landing,
    landingIndex,
    landingOrder: landingIndex >= 0 ? landingIndex + 1 : 0,
    nextLandingIndex,
    nextLandingInS,
    strikeLabel,
    cues,
    headline,
    trusted,
  };
}

function postureCues(input: {
  phase: GaitPhase;
  trusted: boolean;
  kneeFlex: number;
  landing: Landing | null;
  lean: number;
}): PostureCue[] {
  const cues: PostureCue[] = [];
  const { phase, kneeFlex, landing, lean } = input;

  if (phase === "stance" && Number.isFinite(kneeFlex) && kneeFlex < 16) {
    cues.push({
      level: "watch",
      title: "무릎이 거의 펴진 채입니다",
      detail:
        "접지 순간에 다리가 곧게 서 있으면 충격을 나눠 받을 시간이 짧아 보입니다. 부상 단정은 아닙니다.",
    });
  } else if (phase === "stance" && Number.isFinite(kneeFlex) && kneeFlex >= 42) {
    cues.push({
      level: "watch",
      title: "무릎이 깊게 굽고 있습니다",
      detail:
        "착지 뒤 자세가 낮아진 구간입니다. 흡수일 수도, 힘이 빠진 패턴일 수도 있어 같은 코스에서 비교해 보세요.",
    });
  } else if (
    landing &&
    landing.kneeFlexContact < 18 &&
    landing.kneeFlexPeak - landing.kneeFlexContact < 10
  ) {
    cues.push({
      level: "watch",
      title: "이 착지는 굽힘이 작은 편이었습니다",
      detail: "직전 접지에서 무릎이 거의 그대로였습니다. 소리를 작게 받는 착지를 한 번만 바꿔 비교해 보세요.",
    });
  }

  if (Number.isFinite(lean) && Math.abs(lean) >= 22) {
    cues.push({
      level: "watch",
      title: "상체가 많이 숙여져 있습니다",
      detail:
        "어깨가 골반보다 앞으로 많이 나가 있습니다. 내리막이거나 가속이 아닌지 먼저 보세요.",
    });
  }

  if (phase === "flight") {
    cues.push({
      level: "ok",
      title: "두 발이 떨어져 있습니다",
      detail: "체공 구간입니다. 다음 발이 닿기 전 무릎이 얼마나 준비되는지를 보면 됩니다.",
    });
  }

  if (!cues.length) {
    cues.push({
      level: "ok",
      title: "이 순간은 눈에 띄는 무너짐이 적습니다",
      detail:
        "무릎과 상체가 일반적인 달리기 범위로 보입니다. 통증 여부는 이 화면만으로 알 수 없습니다.",
    });
  }

  return cues.slice(0, 2);
}

function liveHeadline(input: {
  phase: GaitPhase;
  side: FootSide;
  kneeFlex: number;
  landing: Landing | null;
  trusted: boolean;
  nextLandingInS: number;
}): string {
  const foot =
    input.side === "unknown" ? "발" : input.side === "left" ? "왼발" : "오른발";
  const knee = Number.isFinite(input.kneeFlex)
    ? ` 무릎 약 ${Math.round(input.kneeFlex)}°.`
    : "";

  if (input.phase === "stance") {
    if (Number.isFinite(input.kneeFlex) && input.kneeFlex < 16) {
      return `${foot}로 접지 중입니다. 무릎이 거의 펴져 있습니다.`;
    }
    if (Number.isFinite(input.kneeFlex) && input.kneeFlex >= 42) {
      return `${foot}로 접지 중이고, 자세가 낮게 굽고 있습니다.`;
    }
    return `${foot}이 땅에 붙어 있는 접지 구간입니다.${knee}`;
  }
  if (input.phase === "flight") {
    const next = Number.isFinite(input.nextLandingInS)
      ? ` 다음 착지까지 약 ${Math.max(0.03, input.nextLandingInS).toFixed(2)}초.`
      : "";
    return `체공입니다. 두 발이 지면에서 떨어져 있습니다.${next}`;
  }
  if (input.phase === "air") {
    const next = Number.isFinite(input.nextLandingInS)
      ? ` 다음 착지까지 약 ${Math.max(0.03, input.nextLandingInS).toFixed(2)}초.`
      : " 이 구간에서는 다음 접지를 아직 특정하지 못했습니다.";
    return `스윙 구간입니다.${next}`;
  }
  return "이 프레임에서는 반복 착지를 아직 모으지 못했습니다.";
}

export function formatLiveClock(t: number): string {
  return formatSeconds(Math.max(0, t));
}
