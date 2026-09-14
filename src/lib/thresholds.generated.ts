// GENERATED FILE — do not edit.
//
// Source: shared/thresholds.yaml (version 15)
// Regenerate: npm run emit:thresholds
//
// `npm run test:analysis` re-renders this from the YAML and fails if the two
// disagree, so editing it by hand only produces a failing test.

import type { ThresholdRecord, ValidationStatus } from "@/lib/thresholds-source";

export type { ThresholdRecord, ValidationStatus };

export const THRESHOLDS_VERSION = 15;

export type ThresholdKey =
  | "foot_strike_rearfoot_max_deg"
  | "foot_strike_forefoot_min_deg"
  | "min_foot_channel_share"
  | "foot_strike_max_plausible_deg"
  | "overstride_ratio_notable"
  | "side_view_max_profile_ratio"
  | "frontal_knee_valgus_notable_deg"
  | "frontal_pelvic_drop_notable_deg"
  | "frontal_pelvis_min_width_px"
  | "scale_min_visible_share"
  | "stature_from_nose_heel"
  | "min_subject_height_ratio"
  | "min_detected_ratio_fair"
  | "min_detected_ratio_publish"
  | "min_cadence_consistency_fair"
  | "min_cadence_consistency_publish"
  | "min_contact_s"
  | "max_contact_s"
  | "max_cadence_spm"
  | "min_step_s"
  | "max_step_s"
  | "cadence_step_agreement"
  | "cadence_max_contact_per_step"
  | "stance_edge_allowance_s"
  | "peak_grf_min_bw"
  | "peak_grf_max_bw"
  | "load_score_moderate_min"
  | "load_score_elevated_min"
  | "load_score_high_min"
  | "load_score_severe_min"
  | "guidance_high_impact_bw"
  | "guidance_high_impact_rate_bw_s"
  | "guidance_severe_impact_bw"
  | "guidance_severe_impact_rate_bw_s"
  | "guidance_stiff_knee_contact_deg"
  | "guidance_stiff_knee_excursion_deg"
  | "guidance_severe_knee_contact_deg"
  | "guidance_fast_descent_m_s"
  | "guidance_severe_descent_m_s"
  | "pace_walk_duty_min"
  | "pace_easy_duty_min"
  | "pace_easy_contact_min_ms"
  | "pace_steady_duty_min"
  | "pace_brisk_duty_min"
  | "pace_fast_duty_min"
  | "pace_walk_min_per_km"
  | "pace_easy_min_per_km"
  | "pace_steady_min_per_km"
  | "pace_brisk_min_per_km"
  | "pace_fast_min_per_km"
  | "narration_knee_absorbing_deg"
  | "narration_loading_rate_slow_bw_s"
  | "narration_live_deep_knee_deg"
  | "narration_asymmetry_notable_pct"
  | "narration_dominant_strike_pct"
  | "slow_motion_min_cadence_spm"
  | "narration_cadence_agreement_spm"
  | "shoe_stability_impact_bw"
  | "visibility_min_strike_angle"
  | "visibility_min_frontal_angle"
  | "visibility_min_foot_distance"
  | "visibility_min_anchor"
  | "visibility_min_foot_height"
  | "min_measurable_segment_px";

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
  min_foot_channel_share: {
    key: "min_foot_channel_share",
    label: "한쪽 발만 잡힌 클립 하한",
    value: 0.1,
    unit: "ratio",
    appliesTo: "running",
    source: "실측으로 갈랐습니다. 한 발이 아예 땅에 닿지 않는 합성 클립은 적은 쪽 채널이 0.00이고, 좌우 라벨이 흔들리는 실제 측면 영상은 0.31~0.35입니다. 두 값 사이에 넉넉히 들어가는 자리입니다.",
    validationStatus: "derived",
    note: "좌우 라벨이 아니라 발 신호 채널로 셉니다 — 측면 영상에서 앱은 좌우를 주장하지 않습니다. 이전 값 0.3은 실제 영상을 0.013 차이로 통과시켰고, 재던 것은 러너의 비대칭이 아니라 자세 추정기의 좌우 혼동이었습니다. 착지 6회 이상에서만 판단합니다.",
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
  scale_min_visible_share: {
    key: "scale_min_visible_share",
    label: "미터 배율을 인정할 최소 실측 비율",
    value: 0.9,
    unit: "ratio",
    appliesTo: "camera",
    source: "배율을 만든 프레임 중 코와 발꿈치가 실제로 화면 안에 있던 비율입니다. 자세 추정기는 화면 밖 관절도 추정해 돌려주므로 값이 계산된다고 본 것은 아니고, 다리만 나오게 찍은 영상에서는 배율이 러너가 아니라 구도를 재게 됩니다.",
    validationStatus: "internal",
    note: "미달이면 배율에 걸린 판정을 내지 않습니다. 거리와 속도 자체는 계속 표시합니다. 표본에서 이 비율은 전신 클립 100%, 다리 클로즈업 73% 였습니다.",
  },
  stature_from_nose_heel: {
    key: "stature_from_nose_heel",
    label: "코→발꿈치가 신장에서 차지하는 비율",
    value: 0.92,
    unit: "ratio",
    appliesTo: "camera",
    source: "코의 높이가 신장의 약 92%라는 인체 계측 관행입니다. 화면의 픽셀을 실제 거리로 바꾸는 배율이 전부 이 값에서 나오므로, 몸 앞 착지 거리·충격 속도·등가 낙하 높이가 모두 여기에 걸려 있습니다.",
    validationStatus: "convention",
    note: "달리는 자세에서는 이 비율이 일정하지 않습니다. Sports2D의 독립 재구성과 대조하면 같은 구간을 여섯 클립에서 신장의 71%~98%로 보고, 그만큼 배율이 9~36% 어긋납니다(docs/2단계-비교결과.md). 화면 안에 길이가 알려진 것이 없으면 어느 쪽이 맞는지 가릴 수 없어 관행값을 유지합니다. 주법 각도는 두 픽셀 오프셋의 비율이라 이 오차에 면역입니다.",
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
  max_cadence_spm: {
    key: "max_cadence_spm",
    label: "케이던스 상한",
    value: 270,
    unit: "score",
    appliesTo: "running",
    source: "엘리트 단거리 주행의 최고 케이던스가 분당 260보 안팎입니다. 이보다 높은 값은 사람의 걸음이 아니라 촬영 배속을 잘못 잡은 것입니다.",
    validationStatus: "convention",
    note: "촬영 배속 후보를 걸러내는 관문으로만 쓰고, 사용자에게 케이던스를 판정하는 데는 쓰지 않습니다. min_step_s(400 spm)는 케이던스 계산에서 간격을 거르는 값이라 이보다 관대합니다.",
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
  cadence_step_agreement: {
    key: "cadence_step_agreement",
    label: "케이던스 · 같은 걸음으로 볼 오차",
    value: 0.25,
    unit: "ratio",
    appliesTo: "running",
    source: "착지 간격이 후보 주기와 이 비율 안에 들면 같은 걸음 간격으로 셉니다. 케이던스는 그렇게 모인 간격의 평균입니다.",
    validationStatus: "internal",
    note: "너무 좁으면 정상적인 걸음 편차까지 버리고, 너무 넓으면 절반 간격과 정상 간격이 한 덩어리가 됩니다.",
  },
  cadence_max_contact_per_step: {
    key: "cadence_max_contact_per_step",
    label: "케이던스 · 접지/걸음 상한",
    value: 1.3,
    unit: "ratio",
    appliesTo: "running",
    source: "한 발이 땅에 붙어 있는 시간은 한 걸음 간격의 이 배수를 넘을 수 없습니다. 넘으면 재고 있는 간격이 실제 걸음의 절반이라는 뜻이라 두 배로 잡습니다.",
    validationStatus: "derived",
    note: "듀티 팩터 = 접지/(2×걸음). 달리기는 0.18~0.48 이라 접지 ≤ 걸음, 걷기는 0.5 를 넘어 약 0.65 까지 가므로 접지 ≤ 1.3×걸음입니다.",
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
  guidance_high_impact_bw: {
    key: "guidance_high_impact_bw",
    label: "반복 충격 부담 · 판정 경계",
    value: 3,
    unit: "BW",
    appliesTo: "guidance",
    source: "추정 반력이 이 값을 넘으면 부담 가능성을 안내합니다. 이 프로젝트의 안내 모듈이 정한 값이고 러닝 데이터셋과 대조한 적은 없습니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 8회가 넘었고 중앙값은 2.13 BW 입니다. 반력은 측정이 아니라 듀티 팩터에서 유도되며 1.05~4.5 로 잘립니다.",
  },
  guidance_high_impact_rate_bw_s: {
    key: "guidance_high_impact_rate_bw_s",
    label: "반복 충격 부담 · 부하율 경계",
    value: 55,
    unit: "BW/s",
    appliesTo: "guidance",
    source: "부하율이 이 값을 넘어도 같은 안내를 냅니다. 위와 같은 출처이고 같은 정도로 검증되지 않았습니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 14회. 중앙값 21.1 BW/s.",
  },
  guidance_severe_impact_bw: {
    key: "guidance_severe_impact_bw",
    label: "반복 충격 부담 · high 승격 경계",
    value: 3.8,
    unit: "BW",
    appliesTo: "guidance",
    source: "안내의 심각도를 attention 에서 high 로 올리는 값입니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 한 번도 넘지 않았습니다. 반력 상한 4.5 아래이므로 도달할 수 없는 값은 아니고, 이 표본이 전부 일반 주행이라 닿지 않은 것입니다.",
  },
  guidance_severe_impact_rate_bw_s: {
    key: "guidance_severe_impact_rate_bw_s",
    label: "반복 충격 부담 · high 부하율 경계",
    value: 85,
    unit: "BW/s",
    appliesTo: "guidance",
    source: "같은 승격을 부하율로 판단하는 값입니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 1회. 부하율은 반력 ÷ 상승시간이고 상승시간은 접지의 40% 라, 이 값에 닿으려면 접지가 0.13초 안쪽이어야 합니다 — 질주 구간입니다.",
  },
  guidance_stiff_knee_contact_deg: {
    key: "guidance_stiff_knee_contact_deg",
    label: "충격 흡수 여유 · 접지 무릎 굽힘 경계",
    value: 18,
    unit: "deg",
    appliesTo: "guidance",
    source: "접지 순간 무릎이 이보다 덜 굽어 있으면 흡수 여유가 작다고 안내합니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 7회. 중앙값 54.7°. 정면 클립에서는 무릎 굽힘이 측정되지 않아 이 경계가 적용되지 않습니다.",
  },
  guidance_stiff_knee_excursion_deg: {
    key: "guidance_stiff_knee_excursion_deg",
    label: "충격 흡수 여유 · 무릎 가동 폭 경계",
    value: 10,
    unit: "deg",
    appliesTo: "guidance",
    source: "접지에서 최대까지 무릎이 이보다 적게 더 굽으면 같은 안내를 냅니다. 짧은 접지는 속도의 결과이지 나쁜 착지가 아니므로, 접지 시간이 아니라 무릎이 실제로 내준 각도로 판단합니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개에서 56회로, 이 안내를 만드는 조건 중 사실상 전부입니다(접지 굽힘 쪽은 7회). 그런데 같은 표본의 가동 폭 중앙값이 10.2° 라 경계가 중앙값 위에 얹혀 있고, 그러면 이 안내는 러너의 특징이 아니라 표본의 절반을 가리키게 됩니다. 이 표본은 러너가 몇 명뿐이라 모집단 중앙값이라고 할 수는 없지만, 다음에 손봐야 할 값이 이것이라는 뜻입니다. 지금 보류로 돌리지 않은 것은 그러면 이 안내가 138회 중 7회로 줄어드는 실제 변경인데, 그 근거로는 이 표본이 얇기 때문입니다 — 하강 속도를 보류한 것은 그쪽이 138회 중 0회라 눈에 보이는 변화가 없었기 때문입니다.",
  },
  guidance_severe_knee_contact_deg: {
    key: "guidance_severe_knee_contact_deg",
    label: "충격 흡수 여유 · high 승격 경계",
    value: 12,
    unit: "deg",
    appliesTo: "guidance",
    source: "그 안내를 high 로 올리는 값입니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 2회.",
  },
  guidance_fast_descent_m_s: {
    key: "guidance_fast_descent_m_s",
    label: "큰 하강 속도 · 판정 경계",
    value: 1.8,
    unit: "m_s",
    appliesTo: "guidance",
    source: "몸이 내려오는 속도가 이 값을 넘으면 내리막이나 점프처럼 동작 자체가 큰 경우인지 확인하라고 안내합니다. 경계 자체는 일반 주행 위에 일부러 둔 값으로 보이지만, 30 fps 에서 이 앱이 재는 속도가 참값의 6할 남짓이라 이 경계는 의도한 것보다 훨씬 큰 동작을 가리킵니다.",
    validationStatus: "withheld",
    note: "표본 여섯 클립 · 착지 138개 기준에서 한 번도 넘지 않았고 중앙값은 0.33 m/s 입니다. 높이를 아는 자유낙하로 대조했습니다(`syntheticDropFrames`). 30 fps 에서 20 cm 낙하는 참값 1.98 m/s 를 1.17 로(59%), 40 cm 는 2.80 을 1.88 로(67%) 보고하고 5~10 cm 낙하는 착지로 검출되지도 않습니다. 60 fps 에서 70~83%, 120 fps 에서 86~92% 로 결손이 줄어드니 원인은 배율이 아니라 표본화입니다. 따라서 1.8 m/s 를 보고하려면 참값이 약 2.9 m/s, 40 cm 넘는 낙하여야 합니다 — 내리막 주행이 아니라 뛰어내리기입니다. 프레임률을 올리면 풀리지만 30 fps 는 이 제품이 바꿀 수 없는 조건이므로, 경계를 이 측정에 맞춰 다시 유도하기 전에는 보류합니다.",
  },
  guidance_severe_descent_m_s: {
    key: "guidance_severe_descent_m_s",
    label: "큰 하강 속도 · high 승격 경계",
    value: 2.6,
    unit: "m_s",
    appliesTo: "guidance",
    source: "같은 안내를 high 로 올리는 값입니다. 위와 같은 이유로 보류합니다.",
    validationStatus: "withheld",
    note: "표본 여섯 클립 · 착지 138개 기준에서 한 번도 넘지 않았습니다. 위의 읽기 손실을 적용하면 이 값을 보고하려면 참값 약 3.9 m/s, 75 cm 안팎의 낙하가 필요합니다.",
  },
  pace_walk_duty_min: {
    key: "pace_walk_duty_min",
    label: "걷기 · 듀티 경계",
    value: 0.5,
    unit: "ratio",
    appliesTo: "pace",
    source: "한 발의 접지가 한 걸음의 절반을 넘으면 양발이 동시에 땅에 있는 구간이 생깁니다. 그게 걷기의 정의이므로 이 경계만은 고른 값이 아니라 유도된 값입니다.",
    validationStatus: "derived",
    note: "표본 여섯 클립 · 착지 138개 기준의 듀티 중앙값은 0.365 입니다.",
  },
  pace_easy_duty_min: {
    key: "pace_easy_duty_min",
    label: "가벼운 조깅 · 듀티 경계",
    value: 0.4,
    unit: "ratio",
    appliesTo: "pace",
    source: "듀티는 속도가 오르면 내려갑니다. 아래 네 경계는 그 사다리를 이 프로젝트가 나눈 것이고, 러닝 문헌의 구간을 옮긴 것이 아닙니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 클립별 듀티 중앙값은 0.236~0.417 이고, 이 사다리는 그 범위를 brisk·steady·easy 로 갈랐습니다.",
  },
  pace_easy_contact_min_ms: {
    key: "pace_easy_contact_min_ms",
    label: "가벼운 조깅 · 접지 시간 경계",
    value: 290,
    unit: "ms",
    appliesTo: "pace",
    source: "듀티가 아직 0.4 아래여도 접지가 이만큼 길면 가벼운 조깅으로 봅니다. 듀티 하나로는 접지와 체공이 함께 길어지는 느린 주행을 놓칩니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  pace_steady_duty_min: {
    key: "pace_steady_duty_min",
    label: "편한 러닝 · 듀티 경계",
    value: 0.33,
    unit: "ratio",
    appliesTo: "pace",
    source: "같은 사다리의 다음 칸입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  pace_brisk_duty_min: {
    key: "pace_brisk_duty_min",
    label: "빠른 러닝 · 듀티 경계",
    value: 0.23,
    unit: "ratio",
    appliesTo: "pace",
    source: "같은 사다리의 다음 칸입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  pace_fast_duty_min: {
    key: "pace_fast_duty_min",
    label: "고속 러닝 · 듀티 경계",
    value: 0.18,
    unit: "ratio",
    appliesTo: "pace",
    source: "같은 사다리의 마지막 칸이고, 아래는 스프린트입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  pace_walk_min_per_km: {
    key: "pace_walk_min_per_km",
    label: "걷기 · 사용자가 적은 페이스 경계",
    value: 8,
    unit: "min_km",
    appliesTo: "pace",
    source: "러너가 직접 적어 준 페이스를 같은 이름으로 옮기는 사다리입니다. 영상에서 잰 듀티 쪽과 이름이 같아야 두 값을 나란히 보여줄 수 있습니다.",
    validationStatus: "internal",
    note: "달리기에서 흔히 쓰는 구간에 가깝게 잡았지만 표준이 있는 것은 아닙니다.",
  },
  pace_easy_min_per_km: {
    key: "pace_easy_min_per_km",
    label: "가벼운 조깅 · 사용자가 적은 페이스 경계",
    value: 6,
    unit: "min_km",
    appliesTo: "pace",
    source: "같은 사다리의 다음 칸입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  pace_steady_min_per_km: {
    key: "pace_steady_min_per_km",
    label: "편한 러닝 · 사용자가 적은 페이스 경계",
    value: 5,
    unit: "min_km",
    appliesTo: "pace",
    source: "같은 사다리의 다음 칸입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  pace_brisk_min_per_km: {
    key: "pace_brisk_min_per_km",
    label: "빠른 러닝 · 사용자가 적은 페이스 경계",
    value: 4.25,
    unit: "min_km",
    appliesTo: "pace",
    source: "같은 사다리의 다음 칸입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  pace_fast_min_per_km: {
    key: "pace_fast_min_per_km",
    label: "고속 러닝 · 사용자가 적은 페이스 경계",
    value: 3.5,
    unit: "min_km",
    appliesTo: "pace",
    source: "같은 사다리의 마지막 칸이고, 아래는 스프린트입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  narration_knee_absorbing_deg: {
    key: "narration_knee_absorbing_deg",
    label: "무릎으로 나눠 받은 착지 · 문구 경계",
    value: 25,
    unit: "deg",
    appliesTo: "narration",
    source: "접지에서 최대까지 무릎이 이보다 더 굽으면 착지 카드가 충격을 나눠 받았다고 씁니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 22회. 가동 폭 중앙값은 10.2° 입니다.",
  },
  narration_loading_rate_slow_bw_s: {
    key: "narration_loading_rate_slow_bw_s",
    label: "힘이 천천히 실린 착지 · 문구 경계",
    value: 20,
    unit: "BW/s",
    appliesTo: "narration",
    source: "부하율이 이보다 낮으면 착지 카드가 힘이 천천히 실렸다고 씁니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 58회인데, 같은 표본의 부하율 중앙값이 21.1 BW/s 라 이 경계가 중앙값 위에 얹혀 있습니다. 무릎 가동 폭 경계와 같은 문제이고, 그러면 이 문장은 러너의 특징이 아니라 표본의 절반을 가리킵니다.",
  },
  narration_live_deep_knee_deg: {
    key: "narration_live_deep_knee_deg",
    label: "라이브 큐 · 깊은 무릎 굽힘 경계",
    value: 42,
    unit: "deg",
    appliesTo: "narration",
    source: "실시간 화면에서 지지 구간 무릎이 이보다 깊게 굽으면 큐를 띄웁니다.",
    validationStatus: "internal",
    note: "라이브 경로라 오프라인 표본으로 세지 못했습니다.",
  },
  narration_asymmetry_notable_pct: {
    key: "narration_asymmetry_notable_pct",
    label: "좌우 충격 차이 · 문구 경계",
    value: 12,
    unit: "pct",
    appliesTo: "narration",
    source: "좌우 평균 반력 차이가 이보다 크면 요약이 차이를 지적하고, 아니면 크지 않다고 씁니다. 어느 쪽이든 숫자는 함께 보여 줍니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준의 여섯 클립 모두 이 값을 넘지 않았습니다. 넘는 쪽 문장은 이 표본으로 확인되지 않았습니다.",
  },
  narration_dominant_strike_pct: {
    key: "narration_dominant_strike_pct",
    label: "주된 주법 · 판정 경계",
    value: 60,
    unit: "pct",
    appliesTo: "narration",
    source: "가장 많은 주법이 착지의 이만큼을 넘으면 그것을 주된 주법으로 부르고, 아니면 섞였다고 합니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 주법이 나온 세 클립 중 하나가 이 경계를 넘었고 둘은 섞임으로 갔습니다.",
  },
  slow_motion_min_cadence_spm: {
    key: "slow_motion_min_cadence_spm",
    label: "슬로모션 의심 · 케이던스 하한",
    value: 120,
    unit: "score",
    appliesTo: "camera",
    source: "달리기에는 항상 체공 구간이 있으므로, 체공이 있는데도 케이던스가 이보다 낮으면 영상이 실제보다 느리게 재생되고 있다고 봅니다. 체공 여부는 듀티가 걷기 경계 아래인지로 판단하며, 그 경계는 pace_walk_duty_min 하나를 함께 씁니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 · 착지 138개 기준에서 이 조건에 걸린 클립은 없습니다. 슬로모션 클립은 표본에 없습니다.",
  },
  narration_cadence_agreement_spm: {
    key: "narration_cadence_agreement_spm",
    label: "케이던스 일치 · 문구 경계",
    value: 15,
    unit: "score",
    appliesTo: "narration",
    source: "착지 간격에서 구한 케이던스와 접지+체공에서 구한 케이던스가 이보다 더 벌어지면 요약이 그 값을 참고값이라고 밝힙니다. 두 경로가 갈리는 것은 착지를 놓쳤거나 접지가 쪼개졌다는 뜻입니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  shoe_stability_impact_bw: {
    key: "shoe_stability_impact_bw",
    label: "충격을 이유로 한 안정화 추천 · 경계",
    value: 2.8,
    unit: "BW",
    appliesTo: "running",
    source: "세션 평균 추정 반력이 이보다 크면 신발 카드가 안정화를 권하면서 그 이유를 착지 패턴이 아니라 충격 크기라고 말합니다. 두 이유를 구분하는 것은 2.0 BW 세션이 패턴만으로 걸렸을 때 충격이 컸다고 듣지 않게 하기 위해서입니다.",
    validationStatus: "internal",
    note: "표본 여섯 클립 중 넘는 것은 clip 06(2.99 BW) 하나뿐인데, 그 클립이 바로 접지를 절반으로 재어 힘을 48% 크게 내는 클립입니다. Sports2D 기준값 1.88 BW 로 고쳐지면 이 경계 아래로 내려갑니다. 즉 이 표본에서 충격을 이유로 한 추천을 켠 것은 러너가 아니라 알려진 측정 오차입니다. 값을 바꾸지 않은 것은 그 오차가 고쳐지면 저절로 풀리는 문제이기 때문입니다.",
  },
  visibility_min_strike_angle: {
    key: "visibility_min_strike_angle",
    label: "주법 각도를 잴 최소 신뢰도",
    value: 0.45,
    unit: "ratio",
    appliesTo: "tracking",
    source: "발꿈치와 발가락으로 각도를 낼 때 요구하는 값이고, 이 파일에서 가장 높습니다. 주법은 ±8° 로 갈리므로 랜드마크가 몇 픽셀만 흔들려도 범주가 바뀝니다.",
    validationStatus: "internal",
    note: "`isVisible` 의 기본값이기도 합니다.",
  },
  visibility_min_frontal_angle: {
    key: "visibility_min_frontal_angle",
    label: "정면 무릎·골반 각도를 잴 최소 신뢰도",
    value: 0.4,
    unit: "ratio",
    appliesTo: "tracking",
    source: "정면 지표도 각도라 비슷하게 요구합니다. 엉덩이·무릎·발목 셋이 모두 이 값을 넘어야 계산합니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  visibility_min_foot_distance: {
    key: "visibility_min_foot_distance",
    label: "발 앞뒤 거리를 잴 최소 신뢰도",
    value: 0.35,
    unit: "ratio",
    appliesTo: "tracking",
    source: "몸 앞 착지 거리는 각도가 아니라 길이라서 같은 흔들림이 결과를 덜 움직입니다. 그래서 각도보다 너그럽습니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  visibility_min_anchor: {
    key: "visibility_min_anchor",
    label: "기준점으로 쓸 최소 신뢰도",
    value: 0.3,
    unit: "ratio",
    appliesTo: "tracking",
    source: "코와 어깨처럼 위치만 쓰고 각도를 내지 않는 랜드마크입니다. 배율을 만들 때와 얼굴 가리기 자리를 잡을 때 씁니다.",
    validationStatus: "internal",
    note: "외부 검증 없음.",
  },
  visibility_min_foot_height: {
    key: "visibility_min_foot_height",
    label: "발 높이 신호에 쓸 최소 신뢰도",
    value: 0.25,
    unit: "ratio",
    appliesTo: "tracking",
    source: "접지를 찾는 신호는 발이 얼마나 낮은지만 보므로 대략적인 위치로 충분하고, 이 파일에서 가장 낮습니다. 여기서 엄격하게 굴면 프레임을 버리게 되는데 버려진 프레임은 놓친 접지입니다.",
    validationStatus: "internal",
    note: "발꿈치와 발목 중 이 값을 넘는 것들의 가장 낮은 점을 씁니다.",
  },
  min_measurable_segment_px: {
    key: "min_measurable_segment_px",
    label: "각도를 낼 최소 신체 분절 길이",
    value: 4,
    unit: "px",
    appliesTo: "tracking",
    source: "화면에서 이보다 짧은 분절로는 각도를 내지 않습니다. 발이 카메라를 정면으로 향하면 이미지 위에서 길이가 사라지고 방향도 사라지는데, 몇 픽셀 아래에서는 부호가 잡음이고 부호 하나가 뒤집히면 읽기 전체가 뒤집힙니다. 넓적다리·정강이·엉덩이~발목 간격에도 같은 값을 씁니다.",
    validationStatus: "internal",
    note: "정면 골반 폭의 24px 과 같은 종류의 가드이고, 값은 더 작습니다 — 골반 폭은 잡음이면 각도가 난수가 되지만 이쪽은 계산 자체가 성립하지 않는 선입니다.",
  },
};
