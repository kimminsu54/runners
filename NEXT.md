# 이어서 할 일 — 정면 촬영 지원과 HUD 내보내기

프로젝트 비교 문서가 이 앱에 없다고 지적한 6개 항목 중 **4개를 끝냈고 2.5개가
남았습니다.** 다음 세션이 처음부터 다시 설계하지 않도록, 이미 내린 결정과
남은 작업을 여기에 적어 둡니다.

작업일: 2026-08-31 · 기준 커밋: `7d3dacc`

## 끝난 것

| 항목 | 커밋 | 상태 |
| --- | --- | --- |
| 임계값 근거·검증상태 표기 | `b39aae2` | 완료 |
| 오버스트라이딩 (몸 앞 착지) | `7d3dacc` | 완료 |
| `public/downloads` 규칙 파일 동기화 (기존 버그) | `b39aae2` | 완료 |
| 정면 판정 기하 (`pose.ts`) | 이 커밋 | **함수만 있고 아직 아무도 부르지 않음** |

`shared/thresholds.yaml` 이 판정 경계값의 단일 원본이고, `validation_status:
withheld` 는 라벨이 아니라 동작입니다 — `isPublishable` 이 false 를 돌려주면
판정 대신 "판정 보류"가 나갑니다. 오버스트라이딩이 그 첫 사용처입니다.

## 남은 것 1 — 정면(관상면) 촬영 지원과 과내전·외전

### 이미 만들어 둔 것

`src/lib/pose.ts` 에 세 함수가 있습니다. 순수 기하이고 타입 검사만 통과한
상태이며, 부르는 곳이 아직 없습니다.

- `pelvisWidthPx` — 모든 정면 측정의 게이트
- `frontalKneeValgusDeg` — 무릎 안쪽 무너짐. 양수가 안쪽
- `pelvicTiltLeftLowerDeg` — 골반 기울기. 양수면 왼쪽 골반이 낮음

각 함수의 주석에 **왜 그렇게 계산하는지**가 적혀 있습니다. 특히 "안쪽"의
기준을 발 위치가 아니라 골반 축에서 가져온 이유(크로스오버 착지에서 부호가
뒤집히기 때문)는 다시 유도하지 말고 주석을 읽으세요.

### 설계 결정 (다시 고민하지 말 것)

**정면은 결함이 아니라 두 번째 모드입니다.** 지금 코드는 정면 클립에 품질
사유를 붙여 `fair` 로 떨어뜨리고 "옆모습으로 다시 찍으라"고 합니다
(`landing-analysis.ts` 의 `assessQuality`). 이걸 없애고 `AnalysisResult` 에
`cameraView` 를 노출해 UI 가 분기하게 합니다.

**접지·반력·케이던스는 정면에서도 유효합니다.** 무게중심 상하 운동과 발 높이는
정면에서도 보입니다. 주법(발 각도)과 몸 앞 착지는 이미 정면에서 비워집니다.

**무릎 굽힘은 정면에서 무효입니다 — 이건 지금 있는 버그입니다.**
`kneeFlexionDeg` 는 이미지 평면에서 각도를 재는데, 정면에서는 무릎이 카메라
축 방향으로 굽습니다. 그런데 그 값이 지금 `landingLoadScore` 의 무릎 항목
(100점 중 18점)에 그대로 들어갑니다. 정면 클립은 뻣뻣한 착지로 과대평가됩니다.

고치는 방법:
- `landingLoadScore` 에 `kneeMeasured?: boolean` (기본 true) 추가. false 면 무릎
  항목을 빼고 남은 두 항목을 `100 / (BW_POINTS + RATE_POINTS)` 로 재정규화.
  기본값이 true 라 기존 테스트는 그대로 통과합니다.
- 정면이면 `kneeFlexContact` / `kneeFlexPeak` 을 `NaN` 으로. 소비처는 전부
  NaN 안전함을 확인했습니다 (`NaN < 18` 은 false, `mean()` 은 비유한값을 거름).
  `training-guidance` 의 뻣뻣한 착지 패턴은 자동으로 발화하지 않게 됩니다.
- `series[].kneeFlex` 도 정면이면 NaN 으로. 안 그러면 `live-readout` 이
  랜딩이 아니라 시리즈에서 무릎 각도를 읽어 계속 표시합니다.

**측정 시점은 접지 순간이 아니라 스탠스 최대값입니다.** 무릎이 가장 안으로
들어가는 것은 중간 지지 구간입니다. `RawLanding` 과 `ContactInterval` 에
`stanceEndIdx` 를 추가해 `[strikeIdx, stanceEndIdx]` 구간의 최대값을 씁니다.

**판정은 보류합니다.** 정면 2D 각도에 러닝용으로 검증된 경계가 없습니다.
각도만 내보내고, 좌우 차이(같은 클립 안의 자기 참조 비교)만 published 로 씁니다.

### 붙일 임계값 (`shared/thresholds.yaml`, version 을 4로 올릴 것)

`min_subject_height_ratio` 앞에 넣으면 됩니다. `unit` 주석 줄에 `px` 를 추가하고,
`thresholds.ts` 의 `formatThresholdValue` 에 `case "px"` 를,
`threshold-evidence.tsx` 의 `GROUP_LABEL`/`GROUP_ORDER` 에 `frontal: "정면 촬영 판정"`
을 추가해야 합니다.

```yaml
  frontal_knee_valgus_notable_deg:
    label: "무릎 안쪽 무너짐 · 판정 경계"
    value: 10
    unit: "deg"
    applies_to: "frontal"
    source: "정면에서 본 넙다리−정강이의 정렬 이탈 각도입니다. 느린 한다리 스쿼트 스크리닝에는 쓰이는 경계가 있지만 달리기 영상에 검증된 기준은 없어, 각도만 재고 좋다·나쁘다를 가르지 않습니다."
    validation_status: "withheld"
    note: "스탠스 구간의 최대값을 씁니다. 무릎이 가장 안으로 들어가는 순간은 접지 직후가 아니라 중간 지지 구간입니다."

  frontal_pelvic_drop_notable_deg:
    label: "골반 기울기 · 판정 경계"
    value: 5
    unit: "deg"
    applies_to: "frontal"
    source: "디딘 발 쪽을 기준으로 반대쪽 골반이 얼마나 내려갔는지입니다. 러닝에서 검증된 경계가 없어 각도만 재고 판정하지 않습니다."
    validation_status: "withheld"
    note: "스탠스 구간의 최대값. 양수는 반대쪽 골반이 내려간 것입니다."

  frontal_pelvis_min_width_px:
    label: "정면 측정 최소 골반 폭"
    value: 24
    unit: "px"
    applies_to: "frontal"
    source: "두 엉덩이 랜드마크의 화면상 좌우 간격입니다. 옆에서 찍으면 거의 겹쳐서 이 간격이 잡음이 되고, 잡음으로 계산한 정렬 각도는 작은 오차가 아니라 난수입니다."
    validation_status: "internal"
    note: "미달이면 정면 지표를 아예 내지 않습니다. 화면 폭 1280 기준으로 잡은 값입니다."
```

### 픽스처

`syntheticFrontRunFrames` 는 이미 있습니다 (`synthetic-jump.ts`). 어깨·엉덩이를
넓혀 `side_view_max_profile_ratio` 를 넘기고, 발을 정면으로 세워 방향이 없게
만든 것입니다. 측정된 `sideViewRatio` 는 0.330 입니다.

여기에 무릎 x 오프셋과 골반 상하 오프셋을 옵션으로 받게 확장하면 밸구스·골반
기울기를 원하는 값으로 넣을 수 있습니다. `poseAt` 은 이미
`leftKneeX`/`rightKneeX` 를 받습니다. 골반 기울기는 `hipHalf` 옆에
좌우 엉덩이 y 오프셋 옵션을 하나 더 추가하면 됩니다.

검증할 성질 (오버스트라이딩 테스트와 같은 방식):
- 정렬된 다리 → 0에 가까움
- 무릎을 안쪽으로 넣으면 양수, 바깥으로 빼면 음수
- **좌우 대칭으로 뒤집어도 같은 값** (골반 축에서 부호를 가져오는 이유)
- 옆모습 픽스처에서는 전부 NaN (골반 폭 게이트)
- 정면 클립에서 무릎 굽힘과 점수의 무릎 항목이 빠지는지

### UI

`cameraView === "front"` 일 때만 나오는 카드 하나
(`src/components/frontal-alignment.tsx`). 좌우 무릎 정렬 각과 골반 기울기,
좌우 차이, 그리고 "이 클립은 정면으로 읽혀서 주법·몸 앞 착지·무릎 굽힘 대신
좌우 정렬을 봅니다"라는 설명. 판정 보류 문구는
`side-breakdown.tsx` 가 오버스트라이딩에 쓰는 방식을 그대로 따르면 됩니다.

## 남은 것 2 — HUD 프레임 내보내기와 얼굴 블러

아직 손대지 않았습니다.

- 지금 앱에는 프레임을 내보내는 경로가 아예 없습니다. `pose-overlay.tsx` 의
  캔버스는 화면 위에만 그립니다.
- 그래서 얼굴 블러는 **공유용 기능**이지 프라이버시 기능이 아닙니다. 영상이
  기기 밖으로 나가지 않는다는 사실은 그대로입니다. 커밋 메시지와 UI 문구에서
  이걸 흐리지 마세요.
- 블러 입력은 별도 얼굴 검출기가 아니라 포즈 랜드마크 0~10번(코·눈·귀·입)
  입니다. `LM` 에 `leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
  mouthLeft: 9, mouthRight: 10` 을 추가하면 됩니다. (일부러 아직 안 넣었습니다 —
  쓰는 커밋에서 같이 넣는 편이 읽기 좋습니다.)
- **fail-closed 로 만들 것.** 얼굴 랜드마크를 못 찾으면 블러를 건너뛰고 원본을
  내보내는 게 아니라, 직전 프레임의 박스를 유지하고 → 그것도 없으면 화면 위
  1/3 을 통째로 블러 → 그래도 안 되면 그 프레임을 내보내지 않습니다.
- 커널 크기는 화면 폭에 비례해야 합니다. 고정 픽셀 값은 해상도가 바뀌면
  블러가 사실상 사라집니다.
- 캔버스는 `videoRef` 의 blob URL 에서 그리므로 tainted 가 아니어서
  `toBlob` 이 됩니다. 데모 모드(`?demo=report`)는 영상이 없으므로
  `PoseSketch` 를 어두운 배경에 그리는 경로가 따로 필요합니다.

## 작업 순서 제안

1. 정면 모드의 **버그 수정 부분 먼저** (무릎 굽힘·점수 재정규화). 지금도 틀린
   숫자가 나가고 있고, 새 기능과 독립적으로 고칠 수 있습니다.
2. 정면 지표(무릎 정렬·골반 기울기)와 픽스처·테스트.
3. 정면 카드 UI 와 품질 사유 제거.
4. HUD 내보내기 + 얼굴 블러.

## 확인 방법

```bash
npm run test:analysis   # 픽스처·경계값·근거 계층·다운로드 동기화
npm run check:language  # 금지어
npm run lint
npm run build
npm run emit:thresholds # YAML 을 고쳤으면 반드시
npm run sync:downloads  # src/lib 의 규칙 파일을 고쳤으면 반드시
```

`emit:thresholds` 와 `sync:downloads` 를 빼먹으면 `test:analysis` 가 어긋났다고
알려 줍니다. 그게 그 테스트의 목적입니다.
