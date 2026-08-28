import { summarizeFootStrikes } from "@/lib/Footstrike";
import {
  cadenceSpm,
  footStrikeLabel,
  formatSeconds,
  formatTimingMs,
  formatTimingPair,
  riskLabel,
  type AnalysisResult,
  type FootStrike,
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
  if (dutyFactor >= 0.23) return "brisk";
  if (dutyFactor >= 0.18) return "fast";
  return "sprint";
}

export function classifyReportedPace(minPerKm: number): PaceBand {
  if (!Number.isFinite(minPerKm)) return "unknown";
  if (minPerKm >= 8) return "walk";
  if (minPerKm >= 6) return "easy";
  if (minPerKm >= 5) return "steady";
  if (minPerKm >= 4.25) return "brisk";
  if (minPerKm >= 3.5) return "fast";
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
  meanLoadingRateBwS: number;
  meanKneeFlexContact: number;
  meanScore: number;
  /** Left/right gap in percent, from the one-decimal values shown on screen. */
  asymmetryPct: number;
  paceSource: "reported" | "gait" | "unknown";
  strikeCounts: Array<{ type: FootStrike; label: string; count: number; percent: number }>;
  dominantStrike: FootStrike | "mixed";
};

/** The precision BW values are printed at. */
function roundToTenth(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : value;
}

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
  const forceTrusted = result.quality.level !== "poor";
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
      meanLoadingRateBwS: Number.NaN,
      meanKneeFlexContact: Number.NaN,
      meanScore: Number.NaN,
      asymmetryPct: Number.NaN,
      paceSource: "unknown",
      strikeCounts: [],
      dominantStrike: "unknown",
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
      l.kneeFlexContact < 18 ||
      l.kneeFlexPeak - l.kneeFlexContact < 10,
  ).length;
  const highImpactCount = landings.filter(
    (l) => l.peakGrfBw >= 3 || l.loadingRateBwS >= 55,
  ).length;
  const cautionCount = landings.filter(
    (l) => l.risk === "elevated" || l.risk === "high" || l.risk === "severe",
  ).length;

  const meanContactMs = mean(landings.map((l) => l.contactMs));
  const meanFlightMs = mean(landings.map((l) => l.flightMs));
  const meanDutyFactor = mean(landings.map((l) => l.dutyFactor));
  const cadence = cadenceSpm(landings);
  const timingCadence =
    Number.isFinite(meanContactMs) && Number.isFinite(meanFlightMs)
      ? 60_000 / (meanContactMs + meanFlightMs)
      : Number.NaN;
  const cadenceAgrees =
    !Number.isFinite(timingCadence) ||
    !Number.isFinite(cadence) ||
    Math.abs(cadence - timingCadence) <= 15;
  const hasReportedPace =
    Number.isFinite(result.reportedPaceMinPerKm) &&
    (result.reportedPaceMinPerKm ?? 0) > 0;
  const pace = hasReportedPace
    ? classifyReportedPace(result.reportedPaceMinPerKm!)
    : result.quality.level === "poor"
      ? "unknown"
      : classifyPace(meanDutyFactor, meanContactMs);
  const paceSource: SessionSummary["paceSource"] = hasReportedPace
    ? "reported"
    : pace === "unknown"
      ? "unknown"
      : "gait";
  const gaitCount = landings.filter((l) => l.gaitBased).length;
  // Running always has a flight phase, so a sub-120 cadence means the clip is
  // played slower than it was run.
  const looksSlowMotion =
    Number.isFinite(cadence) &&
    cadence < 120 &&
    Number.isFinite(meanDutyFactor) &&
    meanDutyFactor < 0.5;

  const left = landings.filter((l) => l.side === "left");
  const right = landings.filter((l) => l.side === "right");
  const leftGrf = mean(left.map((l) => l.peakGrfBw));
  const rightGrf = mean(right.map((l) => l.peakGrfBw));
  const bothSides = left.length >= 2 && right.length >= 2;
  // L/R print to one decimal, so derive the gap from those same printed values.
  // Off the raw means, "L 2.0 / R 2.1" comes with "차이 8%" and a reader who
  // does the division gets 5% — the number looks miscalculated.
  const leftShown = roundToTenth(leftGrf);
  const rightShown = roundToTenth(rightGrf);
  const pairMean = (leftShown + rightShown) / 2;
  const asymmetryPct =
    bothSides && pairMean > 0
      ? (Math.abs(leftShown - rightShown) / pairMean) * 100
      : Number.NaN;

  const strikeOrder: FootStrike[] = ["rearfoot", "midfoot", "forefoot"];
  const knownStrikes = forceTrusted
    ? landings.filter(
        (landing) =>
          landing.footStrike !== "unknown" &&
          landing.footStrikeConfidence !== "low",
      )
    : [];
  const strikeSummary = summarizeFootStrikes(
    knownStrikes.map((landing) => ({ type: landing.footStrike })),
  );
  const strikeCounts = strikeOrder
    .map((type) => {
      if (type === "unknown") return null;
      const count = strikeSummary.counts[type];
      return {
        type,
        label: footStrikeLabel[type],
        count,
        percent: strikeSummary.percents[type],
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row && row.count > 0));
  const topStrike = strikeCounts.reduce<(typeof strikeCounts)[number] | null>(
    (best, row) => (!best || row.count > best.count ? row : best),
    null,
  );
  const enoughStrikeSamples =
    knownStrikes.length >= Math.max(3, Math.ceil(landings.length * 0.5));
  const dominantStrike: SessionSummary["dominantStrike"] =
    !topStrike || !enoughStrikeSamples
      ? "unknown"
      : topStrike.percent >= 60
        ? topStrike.type
        : "mixed";

  const riskOrder: Risk[] = ["low", "moderate", "elevated", "high", "severe"];
  const riskCounts = (forceTrusted ? riskOrder : [])
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

  const patterns = (forceTrusted ? [...patternVotes.values()] : [])
    .sort(
      (a, b) =>
        b.count - a.count ||
        levelRank(b.pattern.level) - levelRank(a.pattern.level),
    )
    .slice(0, 3)
    .map((row) => row.pattern);

  const cadenceText = Number.isFinite(cadence)
    ? cadenceAgrees
      ? `분당 약 ${Math.round(cadence)}보`
      : `분당 약 ${Math.round(cadence)}보(착지 간격이 고르지 않아 참고값)`
    : "케이던스는 착지가 더 있어야 계산됩니다";

  const trendBits = [
    stiffCount
      ? `착지의 ${pct(stiffCount, landings.length)}%는 착지 뒤 무릎 굽힘이 작은 패턴입니다.`
      : "",
    highImpactCount
      ? `착지의 ${pct(highImpactCount, landings.length)}%는 비교적 큰 충격·부하율입니다.`
      : "",
    Number.isFinite(asymmetryPct) && asymmetryPct >= 12
      ? `왼발 ${left.length}회 ${leftShown.toFixed(1)} BW, 오른발 ${right.length}회 ${rightShown.toFixed(1)} BW로 좌우 차이가 약 ${Math.round(asymmetryPct)}%입니다.`
      : bothSides
        ? `왼발 ${left.length}회, 오른발 ${right.length}회이며 좌우 충격 차이는 ${Math.round(asymmetryPct)}%로 크지 않습니다.`
        : "",
  ].filter(Boolean);

  const reportedText = hasReportedPace
    ? `입력 페이스 ${formatPace(result.reportedPaceMinPerKm!)}를 기준으로 ${paceLabel[pace]}입니다. `
    : "";
  const paceText = Number.isFinite(meanContactMs)
    ? reportedText +
      `접지 ${formatTimingMs(meanContactMs)} · 체공 ${formatTimingMs(meanFlightMs)} · 듀티 ${meanDutyFactor.toFixed(2)}입니다.` +
      (looksSlowMotion
        ? " 케이던스가 사람이 낼 수 없을 만큼 낮습니다. 슬로우 모션 영상이라면 위에서 촬영 배속을 지정해 주세요."
        : "")
    : hasReportedPace
      ? `${reportedText}촬영 조건 때문에 접지 시간 기반 교차 검증은 하지 못했습니다.`
      : `${paceLabel[pace]} — 접지 순간을 신뢰할 만큼 재지 못해 페이스는 판정하지 않았습니다.`;

  const strikeDistribution = strikeCounts
    .map((row) => `${row.label} ${row.percent}%`)
    .join(" · ");
  const strikeText =
    dominantStrike === "unknown"
      ? "발뒤꿈치와 발가락이 접지 순간에 충분히 보이지 않아 착지 주법은 판정하지 않았습니다."
      : dominantStrike === "mixed"
        ? `착지 주법은 혼합형입니다(${strikeDistribution}). 어느 한 주법이 보편적으로 더 안전한 것은 아닙니다.`
        : `착지 주법은 주로 ${footStrikeLabel[dominantStrike]}입니다(${strikeDistribution}). 어느 한 주법이 보편적으로 더 안전한 것은 아닙니다.`;

  const paragraphs = [
    `${durationS.toFixed(1)}초 · ${frameCount}프레임을 추적해 착지 ${landings.length}회를 모았습니다. 자세는 구간의 ${pct(detectedRatio, 1)}%에서 잡혔고, ${cadenceText}입니다.`,
    paceText,
    strikeText,
    forceTrusted
      ? `평균 추정 지면반력은 ${avgGrf.toFixed(1)} BW, 흡수 시간은 ${formatTimingMs(avgAbsorb)}, 착지 순간 무릎은 ${avgKnee.toFixed(0)}°입니다. 가장 센 착지는 ${formatSeconds(peak.tContact)}의 ${peak.peakGrfBw.toFixed(1)} BW(점수 ${peak.damageScore})입니다.`
      : "사람이 작거나 자세 추적이 끊겨 충격량은 숫자로 평가하지 않았습니다. 더 가까이서 다시 촬영해야 합니다.",
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
    pace === "unknown"
      ? ""
      : forceTrusted
        ? `${paceLabel[pace]} · 평균 ${avgGrf.toFixed(1)} BW — `
        : `${paceLabel[pace]} · 충격량 측정 불가 — `;
  const headline =
    !forceTrusted
      ? paceHeadline + "촬영 조건을 먼저 개선해 주세요."
      : paceHeadline +
    (cautionCount >= Math.max(2, Math.ceil(landings.length * 0.4))
      ? "반복 착지에서 충격이 몰리는 패턴이 보입니다."
      : stiffCount >= Math.max(2, Math.ceil(landings.length * 0.4))
        ? "착지를 여러 번 모아 보니 무릎 굽힘이 작은 편이 반복됩니다."
        : landings.length >= 4
          ? "여러 착지를 모아 본 전체 부하는 비교적 고른 편입니다."
          : "잡은 착지가 적어 전체 경향은 참고 수준입니다.");

  const metrics: SessionMetric[] = [
    {
      label: "페이스",
      value: paceLabel[pace],
      hint: hasReportedPace
        ? `${formatPace(result.reportedPaceMinPerKm!)} · 직접 입력`
        : Number.isFinite(meanDutyFactor)
          ? `듀티 ${meanDutyFactor.toFixed(2)} · 영상 추정`
        : `착지 ${gaitCount}/${landings.length}회 측정`,
    },
    {
      label: "착지 주법",
      value:
        dominantStrike === "mixed"
          ? "혼합형"
          : footStrikeLabel[dominantStrike],
      hint: strikeDistribution || "옆모습에서 발 전체 필요",
    },
    {
      label: forceTrusted ? "착지" : "착지 후보",
      value: `${landings.length}회`,
      hint: forceTrusted ? cadenceText : "품질 개선 후 확정",
    },
    {
      label: "접지 / 체공",
      value: formatTimingPair(meanContactMs, meanFlightMs),
      hint: "접지 시간은 페이스와 함께 움직입니다. 충격량은 반력으로 봅니다.",
    },
    {
      label: "평균 반력",
      value: forceTrusted ? `${avgGrf.toFixed(1)} BW` : "측정 불가",
      // The half-sine stance model is good to roughly a sixth either way.
      hint: forceTrusted
        ? `추정 범위 ${(avgGrf * 0.85).toFixed(1)}–${(avgGrf * 1.15).toFixed(1)} BW`
        : "사람을 화면 높이 25% 이상으로 촬영",
    },
    {
      label: "평균 점수",
      value: forceTrusted ? String(Math.round(avgScore)) : "측정 불가",
      hint: forceTrusted ? `부하율 ${avgRate.toFixed(0)} BW/s` : undefined,
    },
  ];

  if (bothSides && forceTrusted) {
    metrics.push({
      label: "좌우",
      value: `L ${leftShown.toFixed(1)} / R ${rightShown.toFixed(1)}`,
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
    training: forceTrusted
      ? [...trainingVotes.values()].slice(0, 4)
      : [
          {
            title: "먼저 촬영 조건 개선",
            detail:
              "전신이 화면 높이의 25% 이상이 되게 가까이서, 카메라를 고정하고 일정한 속도 구간 5–8초를 옆에서 찍어 주세요.",
          },
        ],
    peakLandingIndex,
    pace,
    meanContactMs,
    meanFlightMs,
    meanDutyFactor,
    meanPeakGrfBw: forceTrusted ? avgGrf : Number.NaN,
    // Session comparison reads these. They stay NaN when the clip is not
    // trusted so a saved session cannot smuggle numbers past the quality gate.
    meanLoadingRateBwS: forceTrusted ? avgRate : Number.NaN,
    meanKneeFlexContact: forceTrusted ? avgKnee : Number.NaN,
    meanScore: forceTrusted ? avgScore : Number.NaN,
    asymmetryPct: forceTrusted ? asymmetryPct : Number.NaN,
    paceSource,
    strikeCounts,
    dominantStrike,
  };
}

function formatPace(minPerKm: number): string {
  const minutes = Math.floor(minPerKm);
  const seconds = Math.round((minPerKm - minutes) * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}
