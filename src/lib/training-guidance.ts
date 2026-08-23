import type { Landing } from "@/lib/landing-analysis";

export type GuidanceLevel = "monitor" | "attention" | "high";

export type LoadPattern = {
  area: string;
  title: string;
  level: GuidanceLevel;
  evidence: string;
  meaning: string;
};

export type TrainingAdvice = {
  title: string;
  detail: string;
};

export type LandingGuidance = {
  patterns: LoadPattern[];
  training: TrainingAdvice[];
  summary: string;
};

export function buildLandingGuidance(landing: Landing): LandingGuidance {
  const patterns: LoadPattern[] = [];
  const training: TrainingAdvice[] = [];
  const kneeExcursion = Math.max(
    0,
    landing.kneeFlexPeak - landing.kneeFlexContact,
  );
  const highImpact =
    landing.peakGrfBw >= 2.8 || landing.loadingRateBwS >= 24;
  const stiffLanding =
    landing.absorptionMs < 110 ||
    landing.kneeFlexContact < 20 ||
    kneeExcursion < 12;

  if (highImpact) {
    patterns.push({
      area: "정강이·발",
      title: "반복 충격 부담 가능성",
      level:
        landing.peakGrfBw >= 4 || landing.loadingRateBwS >= 38
          ? "high"
          : "attention",
      evidence: `${landing.peakGrfBw.toFixed(1)} BW · ${landing.loadingRateBwS.toFixed(0)} BW/s`,
      meaning:
        "짧은 시간에 큰 하중이 반복되면 정강이뼈와 발 주변 조직이 회복할 여유가 줄 수 있습니다. 이 영상만으로 피로골절이나 족저근막 손상을 예측할 수는 없습니다.",
    });
    training.push({
      title: "보폭을 조금 줄여 재촬영",
      detail:
        "속도는 유지한 채 케이던스를 약 3–5%만 높여 발이 몸보다 너무 앞에 닿지 않게 해보세요. 앞꿈치 착지를 억지로 만들지는 마세요.",
    });
  }

  if (stiffLanding) {
    patterns.push({
      area: "무릎 앞쪽·고관절",
      title: "충격 흡수 여유가 작은 패턴",
      level:
        landing.absorptionMs < 80 || landing.kneeFlexContact < 12
          ? "high"
          : "attention",
      evidence: `흡수 ${Math.round(landing.absorptionMs)} ms · 무릎 ${landing.kneeFlexContact.toFixed(0)}°→${landing.kneeFlexPeak.toFixed(0)}°`,
      meaning:
        "착지 뒤 무릎과 엉덩이가 충분히 굽혀지지 않으면 충격을 여러 관절에 나누는 시간이 짧아질 수 있습니다. 무릎 통증이나 인대 손상을 진단하는 지표는 아닙니다.",
    });
    training.push({
      title: "조용한 착지 연습",
      detail:
        "제자리에서 낮은 스텝다운 5회×2세트를 하며 무릎과 엉덩이를 함께 굽히고 소리를 작게 내보세요. 통증 없이 안정되면 높이나 속도를 조금씩 올립니다.",
    });
  }

  if (landing.impactVelocity >= 1.4) {
    patterns.push({
      area: "하체 전반",
      title: "큰 하강 속도",
      level: landing.impactVelocity >= 2.2 ? "high" : "attention",
      evidence: `${landing.impactVelocity.toFixed(1)} m/s · 등가 높이 ${landing.equivalentDropCm.toFixed(0)} cm`,
      meaning:
        "몸이 빠르게 내려오는 착지입니다. 내리막, 점프, 과한 상하 움직임처럼 동작 자체가 큰 경우인지 먼저 확인해야 합니다.",
    });
  }

  if (!patterns.length) {
    patterns.push({
      area: "특이 소견 없음",
      title: "이 착지에서 뚜렷한 고부하 신호는 적음",
      level: "monitor",
      evidence: `${landing.peakGrfBw.toFixed(1)} BW · 흡수 ${Math.round(landing.absorptionMs)} ms`,
      meaning:
        "영상 추정 범위에서는 큰 충격이나 매우 뻣뻣한 착지가 두드러지지 않았습니다. 통증이 없다는 뜻이나 부상 위험이 0이라는 뜻은 아닙니다.",
    });
  }

  training.push(
    {
      title: "주 2회 기초 근력",
      detail:
        "싱글 레그 카프레이즈, 스플릿 스쿼트, 낮은 스텝다운을 각각 2–3세트×8–12회 실시하세요. 마지막 몇 회가 힘들지만 자세가 유지되는 강도를 고릅니다.",
    },
    {
      title: "부하를 한 번에 하나만 변경",
      detail:
        "거리, 속도, 언덕, 신발을 동시에 크게 바꾸지 말고 한 요소씩 올리세요. 다음 날 국소 통증이나 절뚝거림이 생기면 이전 부하로 돌아갑니다.",
    },
  );

  return {
    patterns,
    training: uniqueAdvice(training),
    summary:
      patterns.some((p) => p.level === "high")
        ? "고부하 신호가 있어 자세와 훈련 부하를 함께 점검할 가치가 있습니다."
        : patterns.some((p) => p.level === "attention")
          ? "조절 가능한 착지 패턴이 보입니다. 한 가지 큐만 적용해 같은 조건에서 비교해 보세요."
          : "현재 영상에서는 뚜렷한 고부하 패턴이 적습니다. 통증과 주간 훈련량을 함께 관찰하세요.",
  };
}

function uniqueAdvice(items: TrainingAdvice[]): TrainingAdvice[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  });
}
