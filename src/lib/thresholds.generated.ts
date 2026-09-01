// GENERATED FILE — do not edit.
//
// Source: shared/thresholds.yaml (version 4)
// Regenerate: npm run emit:thresholds
//
// `npm run test:analysis` re-renders this from the YAML and fails if the two
// disagree, so editing it by hand only produces a failing test.

import type { ThresholdRecord, ValidationStatus } from "@/lib/thresholds-source";

export type { ThresholdRecord, ValidationStatus };

export const THRESHOLDS_VERSION = 4;

export type ThresholdKey =
  | "foot_strike_rearfoot_max_deg"
  | "foot_strike_forefoot_min_deg"
  | "foot_strike_max_plausible_deg"
  | "overstride_ratio_notable"
  | "side_view_max_profile_ratio"
  | "frontal_knee_valgus_notable_deg"
  | "frontal_pelvic_drop_notable_deg"
  | "frontal_pelvis_min_width_px"
  | "min_subject_height_ratio"
  | "min_detected_ratio_fair"
  | "min_detected_ratio_publish"
  | "min_cadence_consistency_fair"
  | "min_cadence_consistency_publish"
  | "min_contact_s"
  | "max_contact_s"
  | "min_step_s"
  | "max_step_s"
  | "stance_edge_allowance_s"
  | "peak_grf_min_bw"
  | "peak_grf_max_bw"
  | "load_score_moderate_min"
  | "load_score_elevated_min"
  | "load_score_high_min"
  | "load_score_severe_min";

export const THRESHOLDS: Record<ThresholdKey, ThresholdRecord> = {
  foot_strike_rearfoot_max_deg: {
    key: "foot_strike_rearfoot_max_deg",
    label: "리어풋 경계",
    value: -8,
    unit: "deg",
    appliesTo: "running",
    source: "첫 접지 프레임에서 뒤꿈치가 발가락보다 이만큼 낮으면 뒤꿈치부터 닿은 것으로 봅니다. 발 경사각 ±8°를 주법 경계로 쓰는 현장 관행입니다.",
    validationStatus: "convention",
    note: "경계 포함. 정확히 -8° 는 리어풋. 공개 데이터셋과 대조한 적이 없어 literature 로 올리지 않았습니다.",
  },
  foot_strike_forefoot_min_deg: {
    key: "foot_strike_forefoot_min_deg",
    label: "포어풋 경계",
    value: 8,
    unit: "deg",
    appliesTo: "running",
    source: "같은 관행의 반대쪽 경계입니다. 발가락이 뒤꿈치보다 이만큼 낮으면 앞꿈치부터 닿은 것으로 봅니다.",
    validationStatus: "convention",
    note: "경계 포함. 정확히 +8° 는 포어풋. 두 경계 사이는 미드풋입니다.",
  },
  foot_strike_max_plausible_deg: {
    key: "foot_strike_max_plausible_deg",
    label: "발 각도 판정 한계",
    value: 40,
    unit: "deg_abs",
    appliesTo: "running",
    source: "달리기에서 발이 지면에 대해 이보다 크게 기울어 닿지는 않습니다. 넘으면 발이 아니라 뒤꿈치·발가락 랜드마크 중 하나가 틀린 경우이므로 판정을 포기합니다.",
    validationStatus: "internal",
    note: "판정을 포기할 뿐, 반력과 접지 시간은 그대로 계산합니다.",
  },
  overstride_ratio_notable: {
    key: "overstride_ratio_notable",
    label: "몸 앞 착지 · 판정 경계",
    value: 0.15,
    unit: "ratio",
    appliesTo: "running",
    source: "발이 몸보다 앞에서 닿은 거리를 신장으로 나눈 값입니다. 러닝에서 합의된 경계가 없어, 이 값으로 좋다·나쁘다를 가르지 않고 측정한 거리만 보여 줍니다.",
    validationStatus: "withheld",
    note: "판정을 내리지 않는 이유가 곧 이 항목이 withheld 인 이유입니다. 같은 사람의 회차 간 비교로 쓰세요. 값 자체는 판정에 쓰이지 않으므로 바꿔도 화면 숫자는 변하지 않습니다.",
  },
  side_view_max_profile_ratio: {
    key: "side_view_max_profile_ratio",
    label: "옆모습 인정 한계",
    value: 0.14,
    unit: "ratio",
    appliesTo: "camera",
    source: "어깨·엉덩이 폭을 신장으로 나눈 값입니다. 옆에서 찍으면 작고 정면으로 갈수록 커집니다. 이보다 크면 정면·사선으로 보고 발 각도 주법 판정을 하지 않습니다.",
    validationStatus: "internal",
    note: "정면으로 판정되면 대신 좌우 정렬(과내전·외전) 쪽을 봅니다.",
  },
  frontal_knee_valgus_notable_deg: {
    key: "frontal_knee_valgus_notable_deg",
    label: "무릎 안쪽 무너짐 · 판정 경계",
    value: 10,
    unit: "deg",
    appliesTo: "frontal",
    source: "정면에서 본 넙다리−정강이의 정렬 이탈 각도입니다. 느린 한다리 스쿼트 스크리닝에는 쓰이는 경계가 있지만 달리기 영상에 검증된 기준은 없어, 각도만 재고 좋다·나쁘다를 가르지 않습니다.",
    validationStatus: "withheld",
    note: "스탠스 구간의 최대값을 씁니다. 무릎이 가장 안으로 들어가는 순간은 접지 직후가 아니라 중간 지지 구간입니다.",
  },
  frontal_pelvic_drop_notable_deg: {
    key: "frontal_pelvic_drop_notable_deg",
    label: "골반 기울기 · 판정 경계",
    value: 5,
    unit: "deg",
    appliesTo: "frontal",
    source: "디딘 발 쪽을 기준으로 반대쪽 골반이 얼마나 내려갔는지입니다. 러닝에서 검증된 경계가 없어 각도만 재고 판정하지 않습니다.",
    validationStatus: "withheld",
    note: "스탠스 구간의 최대값. 양수는 반대쪽 골반이 내려간 것입니다.",
  },
  frontal_pelvis_min_width_px: {
    key: "frontal_pelvis_min_width_px",
    label: "정면 측정 최소 골반 폭",
    value: 24,
    unit: "px",
    appliesTo: "frontal",
    source: "두 엉덩이 랜드마크의 화면상 좌우 간격입니다. 옆에서 찍으면 거의 겹쳐서 이 간격이 잡음이 되고, 잡음으로 계산한 정렬 각도는 작은 오차가 아니라 난수입니다.",
    validationStatus: "internal",
    note: "미달이면 정면 지표를 아예 내지 않습니다. 화면 폭 1280 기준으로 잡은 값입니다.",
  },
  min_subject_height_ratio: {
    key: "min_subject_height_ratio",
    label: "사람 크기 최소",
    value: 0.2,
    unit: "ratio",
    appliesTo: "camera",
    source: "사람이 화면 높이에서 차지하는 비율입니다. 이보다 작으면 접지 프레임의 픽셀 오차가 접지 시간을 좌우해 버립니다.",
    validationStatus: "internal",
    note: "미달이면 접지·체공·페이스를 아예 표시하지 않고 재촬영을 권합니다.",
  },
  min_detected_ratio_fair: {
    key: "min_detected_ratio_fair",
    label: "자세 추적 · 경고선",
    value: 0.8,
    unit: "ratio",
    appliesTo: "tracking",
    source: "자세가 잡힌 프레임 비율입니다. 이보다 낮으면 놓친 착지가 생기므로 경고를 붙입니다.",
    validationStatus: "internal",
    note: "숫자는 계속 표시합니다.",
  },
  min_detected_ratio_publish: {
    key: "min_detected_ratio_publish",
    label: "자세 추적 · 표시 중단선",
    value: 0.75,
    unit: "ratio",
    appliesTo: "tracking",
    source: "경고선보다 더 낮은, 숫자를 아예 내지 않는 선입니다. 불확실한 영상에서 임의의 수치를 내는 것보다 재촬영이 안전합니다.",
    validationStatus: "internal",
    note: "미달이면 품질 poor.",
  },
  min_cadence_consistency_fair: {
    key: "min_cadence_consistency_fair",
    label: "착지 간격 고름 · 경고선",
    value: 0.55,
    unit: "ratio",
    appliesTo: "tracking",
    source: "전형 착지 간격의 ±30% 안에 들어온 간격의 비율입니다. 낮으면 일부 착지를 놓쳤다는 뜻입니다.",
    validationStatus: "internal",
    note: "숫자는 계속 표시합니다.",
  },
  min_cadence_consistency_publish: {
    key: "min_cadence_consistency_publish",
    label: "착지 간격 고름 · 표시 중단선",
    value: 0.45,
    unit: "ratio",
    appliesTo: "tracking",
    source: "경고선보다 더 낮은, 숫자를 아예 내지 않는 선입니다.",
    validationStatus: "internal",
    note: "미달이면 품질 poor.",
  },
  min_contact_s: {
    key: "min_contact_s",
    label: "접지 시간 하한",
    value: 0.06,
    unit: "s",
    appliesTo: "running",
    source: "보고된 러닝 접지 시간의 하한 근처입니다. 스프린트가 약 0.08 s 이고, 그보다 짧게 잡힌 구간은 접지가 아니라 추적 끊김입니다.",
    validationStatus: "literature",
    note: "여유를 두어 0.08 보다 낮게 잡았습니다.",
  },
  max_contact_s: {
    key: "max_contact_s",
    label: "접지 시간 상한",
    value: 0.4,
    unit: "s",
    appliesTo: "running",
    source: "보고된 러닝 접지 시간의 상한 근처입니다. 느린 조깅이 약 0.3 s 이고, 이보다 길면 달리기가 아니라 걷기이거나 추적이 멈춘 구간입니다.",
    validationStatus: "literature",
    note: "특정 논문 한 편을 인용하지는 않았습니다.",
  },
  min_step_s: {
    key: "min_step_s",
    label: "착지 간격 하한",
    value: 0.15,
    unit: "s",
    appliesTo: "running",
    source: "케이던스 400 spm 에 해당합니다. 사람이 낼 수 없는 간격을 걸러냅니다.",
    validationStatus: "derived",
    note: "60 / 0.15 = 400 spm.",
  },
  max_step_s: {
    key: "max_step_s",
    label: "착지 간격 상한",
    value: 0.7,
    unit: "s",
    appliesTo: "running",
    source: "케이던스 86 spm 에 해당합니다. 이보다 긴 간격은 중간에 착지를 놓친 것으로 봅니다.",
    validationStatus: "derived",
    note: "60 / 0.7 ≈ 86 spm.",
  },
  stance_edge_allowance_s: {
    key: "stance_edge_allowance_s",
    label: "접지 앞뒤 보정",
    value: 0.04,
    unit: "s",
    appliesTo: "running",
    source: "발 높이로 접지를 자르면 뒤꿈치가 굴러 들어오는 구간과 발가락이 떨어지는 구간이 잘려 나갑니다. 그만큼을 되돌려 더합니다.",
    validationStatus: "internal",
    note: "이 보정이 없으면 접지가 짧게 측정되어 반력이 과대평가됩니다. 자체 픽스처로만 확인했습니다.",
  },
  peak_grf_min_bw: {
    key: "peak_grf_min_bw",
    label: "추정 반력 하한",
    value: 1.05,
    unit: "BW",
    appliesTo: "running",
    source: "걷기의 최대 수직 지면반력이 체중의 약 1.05~1.2배입니다. 달리기 추정치가 그보다 낮게 나올 수는 없습니다.",
    validationStatus: "literature",
    note: "곡선이 아래로 벗어나는 것을 막습니다.",
  },
  peak_grf_max_bw: {
    key: "peak_grf_max_bw",
    label: "추정 반력 상한",
    value: 4.5,
    unit: "BW",
    appliesTo: "running",
    source: "보고된 스프린트 최대 수직 지면반력(약 3.7 BW)에 여유를 둔 값입니다.",
    validationStatus: "literature",
    note: "접지 시간이 0 에 가까워질 때 곡선이 발산하는 것을 막습니다.",
  },
  load_score_moderate_min: {
    key: "load_score_moderate_min",
    label: "충격 점수 · 보통 시작",
    value: 25,
    unit: "score",
    appliesTo: "scoring",
    source: "반력·부하율·무릎 굽힘을 합친 0~100 점의 구간 경계입니다. 이 앱의 휴리스틱입니다.",
    validationStatus: "internal",
    note: "부상률 같은 외부 결과와 대조한 적이 없습니다. 같은 사람의 회차 간 비교용입니다.",
  },
  load_score_elevated_min: {
    key: "load_score_elevated_min",
    label: "충격 점수 · 주의 시작",
    value: 45,
    unit: "score",
    appliesTo: "scoring",
    source: "같은 휴리스틱의 다음 구간 경계입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  load_score_high_min: {
    key: "load_score_high_min",
    label: "충격 점수 · 높음 시작",
    value: 65,
    unit: "score",
    appliesTo: "scoring",
    source: "같은 휴리스틱의 다음 구간 경계입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  load_score_severe_min: {
    key: "load_score_severe_min",
    label: "충격 점수 · 매우 높음 시작",
    value: 80,
    unit: "score",
    appliesTo: "scoring",
    source: "같은 휴리스틱의 마지막 구간 경계입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
};
