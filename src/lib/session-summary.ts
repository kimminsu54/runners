import {
  formatSeconds,
  riskLabel,
  type AnalysisResult,
  type Risk,
} from "@/lib/landing-analysis";
import {
  buildLandingGuidance,
  type GuidanceLevel,
  type LoadPattern,
  type TrainingAdvice,
} from "@/lib/training-guidance";

export type SessionMetric = {
  label: string;
  value: string;
  hint?: string;
};

export type PaceBand =
  | "walk"
  | "easy"
  | "steady"
  | "brisk"
  | "fast"
  | "sprint"
  | "unknown";

export const paceLabel: Record<PaceBand, string> = {
  walk: "걷기에 가까움",
  easy: "느린 조깅",
  steady: "편한 러닝",
  brisk: "빠른 러닝",
  fast: "고속 러닝",
  sprint: "스프린트",
  unknown: "페이스 판정 불가",
};

// Duty factor is contact time over stride time. It drops as pace rises and is
// far more stable than trying to read ground speed off a hand-held camera.
export function classifyPace(dutyFactor: number, contactMs: number): PaceBand {
  if (!Number.isFinite(dutyFactor)) return "unknown";
  if (dutyFactor >= 0.5) return "walk";
  if (dutyFactor >= 0.4 || contactMs >= 290) return "easy";
  if (dutyFactor >= 0.33) return "steady";
  if (dutyFactor >= 0.28) return "brisk";
  if (dutyFactor >= 0.23) return "fast";
  return "sprint";
}

export type SessionSummary = {
  headline: string;
  paragraphs: string[];
  metrics: SessionMetric[];
  riskCounts: Array<{ risk: Risk; label: string; count: number }>;
  patterns: LoadPattern[];
  training: TrainingAdvice[];
  peakLandingIndex: number;
  pace: PaceBand;
  meanContactMs: number;
  meanFlightMs: number;
  meanDutyFactor: number;
  meanPeakGrfBw: number;
};

function mean(values: number[]): number {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return Number.NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((100 * part) / whole);
}

function levelRank(level: GuidanceLevel): number {
  if (level === "high") return 2;
  if (level === "attention") return 1;
  return 0;
}

export function buildSessionSummary(result: AnalysisResult): SessionSummary {
  const { landings, series, detectedRatio } = result;
  const durationS = series.length ? series[series.length - 1].t - series[0].t : 0;
  const frameCount = series.length;

  if (!landings.length) {
    return {
      headline: "프레임은 읽었지만 반복 착지를 모으지 못했습니다.",
      paragraphs: [
        `${frameCount}프레임, ${durationS.toFixed(1)}초를 훑었습니다. 자세 추정은 ${pct(detectedRatio, 1)}% 구간에서 잡혔습니다.`,
        "발이 화면 밖으로 나가거나 정면·줌인 영상이면 좌우 발이 겹쳐 착지 순간이 흐려질 수 있습니다. 전신이 나오는 옆모습으로 다시 찍어 보세요.",
      ],
      metrics: [
        { label: "분석 시간", value: `${durationS.toFixed(1)}s` },
        { label: "프레임", value: String(frameCount) },
        { label: "자세 포착", value: `${pct(detectedRatio, 1)}%` },
        { label: "착지", value: "0회" },
      ],
      riskCounts: [],
      patterns: [],
      training: [
        {
          title: "촬영만 바꿔도 요약이 생깁니다",
          detail:
            "허리부터 발까지 보이게, 카메라 고정, 3–8초의 편한 달리기를 옆에서 찍어 주세요. 같은 구간을 두 번 비교하면 훈련 효과가 더 잘 드러납니다.",
        },
      ],
      peakLandingIndex: -1,
      pace: "unknown",
      meanContactMs: Number.NaN,
      meanFlightMs: Number.NaN,
      meanDutyFactor: Number.NaN,
      meanPeakGrfBw: Number.NaN,
    };
  }

  const scores = landings.map((l) => l.damageScore);
  const grfs = landings.map((l) => l.peakGrfBw);
  const absorbs = landings.map((l) => l.absorptionMs);
  const knees = landings.map((l) => l.kneeFlexContact);
  const rates = landings.map((l) => l.loadingRateBwS);
  const avgScore = mean(scores);
  const avgGrf = mean(grfs);
  const avgAbsorb = mean(absorbs);
  const avgKnee = mean(knees);
  const avgRate = mean(rates);
  const peak = landings.reduce((a, b) => (a.damageScore >= b.damageScore ? a : b));
  const peakLandingIndex = landings.indexOf(peak);

  const stiffCount = landings.filter(
    (l) =>
      l.absorptionMs < 110 ||
      l.kneeFlexContact < 20 ||
      l.kneeFlexPeak - l.kneeFlexContact < 12,
  ).length;
  const highImpactCount = landings.filter(
    (l) => l.peakGrfBw >= 2.8 || l.loadingRateBwS >= 24,
  ).length;
  const cautionCount = landings.filter(
    (l) => l.risk === "elevated" || l.risk === "high" || l.risk === "severe",
  ).length;

  const first = landings[0].tContact;
  const last = landings[landings.length - 1].tContact;
  const cadence =
    landings.length >= 2 && last > first
      ? ((landings.length - 1) / (last - first)) * 60
      : Number.NaN;

  const meanContactMs = mean(landings.map((l) => l.contactMs));
  const meanFlightMs = mean(landings.map((l) => l.flightMs));
  const meanDutyFactor = mean(landings.map((l) => l.dutyFactor));
  const pace = classifyPace(meanDutyFactor, meanContactMs);
  const gaitCount = landings.filter((l) => l.gaitBased).length;

  const left = landings.filter((l) => l.side === "left");
  const right = landings.filter((l) => l.side === "right");
  const leftGrf = mean(left.map((l) => l.peakGrfBw));
  const rightGrf = mean(right.map((l) => l.peakGrfBw));
  const bothSides = left.length >= 2 && right.length >= 2;
  const pairMean = (leftGrf + rightGrf) / 2;
  const asymmetryPct =
    bothSides && pairMean > 0
      ? (Math.abs(leftGrf - rightGrf) / pairMean) * 100
      : Number.NaN;

  const riskOrder: Risk[] = ["low", "moderate", "elevated", "high", "severe"];
  const riskCounts = riskOrder
    .map((risk) => ({
      risk,
      label: riskLabel(risk),
      count: landings.filter((l) => l.risk === risk).length,
    }))
    .filter((row) => row.count > 0);

  const patternVotes = new Map<string, { pattern: LoadPattern; count: number }>();
  const trainingVotes = new Map<string, TrainingAdvice>();
  let highVotes = 0;
  let attentionVotes = 0;

  for (const landing of landings) {
    const guidance = buildLandingGuidance(landing);
    if (guidance.patterns.some((p) => p.level === "high")) highVotes += 1;
    else if (guidance.patterns.some((p) => p.level === "attention")) attentionVotes += 1;

    for (const pattern of guidance.patterns) {
      if (pattern.area === "특이 소견 없음") continue;
      const key = `${pattern.area}:${pattern.title}`;
      const prev = patternVotes.get(key);
      const count = (prev?.count ?? 0) + 1;
      const stronger =
        !prev || levelRank(pattern.level) > levelRank(prev.pattern.level);
      patternVotes.set(key, {
        count,
        pattern: {
          ...(stronger ? pattern : prev.pattern),
          evidence: `${count}회 · ${stronger ? pattern.evidence : prev.pattern.evidence.replace(/^\d+회 · /, "")}`,
        },
      });
    }
    for (const item of guidance.training) {
      trainingVotes.set(item.title, item);
    }
  }

  const patterns = [...patternVotes.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        levelRank(b.pattern.level) - levelRank(a.pattern.level),
    )
    .slice(0, 3)
    .map((row) => row.pattern);

  const cadenceText = Number.isFinite(cadence)
    ? `분당 약 ${Math.round(cadence)}보`
    : "케이던스는 착지가 더 있어야 계산됩니다";

  const trendBits = [
    stiffCount
      ? `착지의 ${pct(stiffCount, landings.length)}%는 흡수 시간이 짧거나 무릎이 덜 굽혀진 뻣뻣한 패턴입니다.`
      : "",
    highImpactCount
      ? `착지의 ${pct(highImpactCount, landings.length)}%는 비교적 큰 충격·부하율입니다.`
      : "",
    Number.isFinite(asymmetryPct) && asymmetryPct >= 12
      ? `왼발 ${left.length}회 ${leftGrf.toFixed(1)} BW, 오른발 ${right.length}회 ${rightGrf.toFixed(1)} BW로 좌우 차이가 약 ${Math.round(asymmetryPct)}%입니다.`
      : bothSides
        ? `왼발 ${left.length}회, 오른발 ${right.length}회이며 좌우 충격 차이는 ${Math.round(asymmetryPct)}%로 크지 않습니다.`
        : "",
  ].filter(Boolean);

  const paceText = Number.isFinite(meanContactMs)
    ? `접지 ${Math.round(meanContactMs)} ms · 체공 ${Math.round(meanFlightMs)} ms · 듀티 ${meanDutyFactor.toFixed(2)}로 보아 ${paceLabel[pace]}입니다.`
    : `${paceLabel[pace]} — 발 접지를 충분히 못 봐서 페이스는 판정하지 않았습니다.`;

  const paragraphs = [
    `${durationS.toFixed(1)}초 · ${frameCount}프레임을 추적해 착지 ${landings.length}회를 모았습니다. 자세는 구간의 ${pct(detectedRatio, 1)}%에서 잡혔고, ${cadenceText}입니다.`,
    paceText,
    `평균 추정 지면반력은 ${avgGrf.toFixed(1)} BW, 흡수 시간은 ${Math.round(avgAbsorb)} ms, 착지 순간 무릎은 ${avgKnee.toFixed(0)}°입니다. 가장 센 착지는 ${formatSeconds(peak.tContact)}의 ${peak.peakGrfBw.toFixed(1)} BW(점수 ${peak.damageScore})입니다.`,
    trendBits.length
      ? trendBits.join(" ")
      : "반복 착지 평균은 일반적인 달리기 범위에 가깝습니다. 개별 착지를 눌러 순간 값을 비교해 보세요.",
    highVotes >= Math.max(2, Math.ceil(landings.length * 0.3))
      ? "여러 착지에서 고부하 신호가 겹칩니다. 한 가지 자세 큐와 주간 거리만 먼저 손보세요."
      : attentionVotes >= Math.max(2, Math.ceil(landings.length * 0.3))
        ? "조절 가능한 착지 패턴이 반복됩니다. 같은 코스에서 케이던스나 착지 소리만 바꿔 비교해 보세요."
        : "영상 전체로 보면 뚜렷한 고부하 패턴은 적습니다. 통증과 주간 훈련량을 함께 관찰하세요.",
  ];

  const paceHeadline =
    pace === "unknown" ? "" : `${paceLabel[pace]} · 평균 ${avgGrf.toFixed(1)} BW — `;
  const headline =
    paceHeadline +
    (cautionCount >= Math.max(2, Math.ceil(landings.length * 0.4))
      ? "반복 착지에서 충격이 몰리는 패턴이 보입니다."
      : stiffCount >= Math.max(2, Math.ceil(landings.length * 0.4))
        ? "착지를 여러 번 모아 보니 흡수가 짧은 편이 반복됩니다."
        : landings.length >= 4
          ? "여러 착지를 모아 본 전체 부하는 비교적 고른 편입니다."
          : "잡은 착지가 적어 전체 경향은 참고 수준입니다.");

  const metrics: SessionMetric[] = [
    {
      label: "페이스",
      value: paceLabel[pace],
      hint: Number.isFinite(meanDutyFactor)
        ? `듀티 ${meanDutyFactor.toFixed(2)}`
        : `착지 ${gaitCount}/${landings.length}회 측정`,
    },
    { label: "착지", value: `${landings.length}회`, hint: cadenceText },
    {
      label: "접지 / 체공",
      value: Number.isFinite(meanContactMs)
        ? `${Math.round(meanContactMs)} / ${Math.round(meanFlightMs)} ms`
        : "측정 불가",
      hint: "짧은 접지·긴 체공일수록 큰 충격",
    },
    {
      label: "평균 반력",
      value: `${avgGrf.toFixed(1)} BW`,
      hint: `최대 ${Math.max(...grfs).toFixed(1)} BW`,
    },
    {
      label: "평균 점수",
      value: String(Math.round(avgScore)),
      hint: `부하율 ${avgRate.toFixed(0)} BW/s`,
    },
  ];

  if (bothSides) {
    metrics.push({
      label: "좌우",
      value: `L ${leftGrf.toFixed(1)} / R ${rightGrf.toFixed(1)}`,
      hint: Number.isFinite(asymmetryPct)
        ? `차이 ${Math.round(asymmetryPct)}%`
        : undefined,
    });
  }

  return {
    headline,
    paragraphs,
    metrics,
    riskCounts,
    patterns,
    training: [...trainingVotes.values()].slice(0, 4),
    peakLandingIndex,
    pace,
    meanContactMs,
    meanFlightMs,
    meanDutyFactor,
    meanPeakGrfBw: avgGrf,
  };
}
