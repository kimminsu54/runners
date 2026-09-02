# Sports2D 기준 도구

앱과 별개로 도는 **오프라인 기준 도구**입니다. 제품은 계속 브라우저에서 분석하고,
이건 그 브라우저 값이 얼마나 틀렸는지 숫자로 말하기 위해 존재합니다. 설계 배경은
[`docs/sports2d-설계.md`](../../docs/sports2d-설계.md), 단계는 그 문서 7절입니다.

---

## 이 PC의 GPU 상황 — 확인 결과

**CUDA를 쓸 수 없습니다.** 확인한 내용입니다.

```
GPU        Intel(R) Graphics (내장, 공유 VRAM 2GB)
nvidia-smi 없음
```

Sports2D 밑단인 [rtmlib](https://github.com/Tau-J/rtmlib)이 받는 device는
`cpu` / `cuda` / `mps` 뿐이고 **DirectML은 지원하지 않습니다.** 즉 이 하드웨어에서
`--device CUDA` 는 선택지가 아니고, 인텔 내장 GPU를 쓰는 경로도 도구가 열어 주지
않습니다.

남는 선택은 **CPU 실행 프로바이더 사이의 선택**입니다. Sports2D는
`--backend auto|openvino|onnxruntime|opencv` 를 받고, 인텔 CPU에서는 보통 OpenVINO가
onnxruntime보다 빠릅니다. `run.py` 가 백엔드를 인자로 받는 이유이고, 어느 쪽이 실제로
빠른지는 0단계에서 재서 아래 표에 적습니다.

18클립을 한 번 처리하는 것이 목적이면 CPU로 충분합니다. 임계값을 바꿔가며 반복
실험할 단계(4~5단계)에서 시간이 문제가 되면, 그때는 이 PC의 설정을 바꾸는 것보다
**NVIDIA GPU가 있는 기계에서 돌리는 것**이 답입니다. `clips.csv` 와 `run.py` 를
그대로 옮기면 됩니다.

### 측정 (0단계에서 채움)

| 백엔드 | 모드 | 클립 | 프레임 | 소요 |
|---|---|---|---|---|
| | | | | |

---

## 설치

파이썬 3.11~3.13이 필요합니다. 이 PC에는 3.11.9가 있습니다(기본 `python` 은 3.14라
Sports2D가 받지 않습니다).

```powershell
py -3.11 -m venv tools\sports2d\.venv
tools\sports2d\.venv\Scripts\python.exe -m pip install -r tools\sports2d\requirements.txt
```

`.venv/` 와 `out/` 과 `clips/` 는 커밋하지 않습니다 — 가중치와 영상이 들어가는
자리입니다.

RTMPose 가중치는 **첫 실행 때 내려받습니다.** 첫 클립이 유독 오래 걸리는 이유입니다.

---

## 실행

`clips.csv` 가 처리할 클립 목록이자 **3단계 수동 라벨의 표본 행렬**입니다. 한 파일이
두 역할을 하므로 목록이 서로 어긋날 수 없습니다.

```powershell
tools\sports2d\.venv\Scripts\python.exe tools\sports2d\run.py
tools\sports2d\.venv\Scripts\python.exe tools\sports2d\run.py --only 03
tools\sports2d\.venv\Scripts\python.exe tools\sports2d\run.py --backend openvino
```

클립은 `tools/sports2d/clips/` 에 `clips.csv` 의 이름으로 넣습니다. `height_m` 은
**반드시 실제 신장**이어야 합니다 — Sports2D의 픽셀→미터 환산이 이 값에서 나옵니다.
지금 표는 전부 1.70으로 채워져 있으니 촬영한 사람에 맞게 고쳐야 합니다.

산출물은 `out/<id>/` 에 들어가고, 우리가 읽는 것은 **픽셀 TRC** 입니다.

---

## 읽는 쪽 — `report.ts`

`run.py` 가 TRC를 만들고, `report.ts` 가 그걸 **앱과 똑같은 `analyzeLandings`** 에
넣어 리포트를 찍습니다. 도구가 두 쪽으로 나뉘어 있는 이유는 비교 실험의 변수를
포즈 추정 하나로 묶기 위해서입니다.

```powershell
npx tsx tools/sports2d/report.ts tools/sports2d/out/02
npx tsx tools/sports2d/report.ts tools/sports2d/out/02 --stature 1.72 --mass 68
```

프레임 크기는 Sports2D가 옆에 써 주는 `_calib.toml` 에서 읽습니다 — 추측한 크기로
정규화하면 모든 발 각도가 기울어집니다. `--stature` 는 **우리 분석기가 쓰는** 신장이고
`clips.csv` 의 `height_m`(Sports2D의 미터 환산용)과 별개로 넘깁니다.

`out/02` 클립 하나로 확인한 실제 출력입니다.

```
프레임     720x1280 · 30 fps · 90개 (추적 88개)
마커       22개 · Units 필드 "m" (참고하지 않음)
y축        image-down
케이던스   168 spm
착지       8개 · 접지 시간 없음 4개
```

**접지 시간이 절반만 잡힙니다.** 30 fps에서 접지는 9~10프레임이고, 잡힌 값도
0.307 s·0.340 s 두 개로 프레임 단위에 양자화돼 있습니다. 이건 Sports2D의 한계가
아니라 **소스 클립의 프레임 레이트** 한계이고, 그래서 3단계 수동 라벨을 240fps로
찍기로 한 이유이기도 합니다. 두 파이프라인을 비교할 때 접지·체공 항목은 이 한계를
같이 적어야 합니다.

---

## 실제 파일이 고쳐 준 것

어댑터는 처음에 HALPE_26 **인덱스로 열을 읽도록** 썼고, 자작 픽스처 왕복 테스트는
통과했습니다. 실제 파일을 열자 두 가지가 달랐습니다.

**마커가 22개, 순서는 골격 순서입니다.** `Hip RHip RKnee RAnkle RBigToe RSmallToe
RHeel LHip …` 순이고 **눈과 귀는 아예 쓰이지 않습니다.** 인덱스로 읽었다면 24번 열을
왼발꿈치로 착각해서 **엉뚱한 관절로 만든 포즈를 에러 없이** 내놓았을 겁니다. 지금은
이름으로 매칭하고, 선택테스트가 **열 순서를 뒤집어도 리포트가 같은지** 확인합니다.

**`Units` 가 거짓말을 합니다.** 픽셀 파일 헤더에 `m` 이라고 적혀 있습니다. 그래서 이
필드로 분기하는 코드는 없습니다.

**얼굴 박스는 TRC에서 만들 수 없습니다.** 눈·귀가 없으므로 `faceBoxFrom` 이 null을
돌려주고 fail-closed로 떨어집니다 — 오프라인 비교에는 영향이 없지만, B 단계에서 서버
좌표로 미리보기를 그리려면 얼굴은 다른 경로로 받아야 합니다.

---

## 왜 픽셀 TRC인가

미터 TRC가 아니라 픽셀 TRC를 읽습니다. 픽셀을 프레임 크기로 정규화하면 MediaPipe가
내놓는 것과 정확히 같은 모양이 되어서, 앱의 스케일·바닥 추정이 그대로 적용되고
**비교 실험의 변수가 포즈 추정 하나로 고정**됩니다.

Sports2D의 미터 스케일과 검출된 바닥 각도를 채택하면 실제 오차원 두 개가 사라지지만,
그건 각각 따로 측정할 값입니다(설계 문서 7절 5단계). 한 번에 다 바꾸면 무엇이 무엇을
개선했는지 말할 수 없습니다.

읽는 쪽은 [`src/lib/sports2d.ts`](../../src/lib/sports2d.ts) 이고, 왕복 테스트로
어댑터가 리포트를 바꾸지 않는 것을 확인합니다(`npm run test:analysis` 의
`sports2d adapter ok`). 픽스처의 마커 목록·순서·헤더는 **실제 파일에서 베껴 온
것**입니다 — 자작 픽스처만 믿었을 때 놓친 것이 위 "실제 파일이 고쳐 준 것" 입니다.

**y축 규약을 추측하지 않습니다.** 분석기는 이미지 좌표(y가 아래로)를 전제하는데,
world-up 파일을 먹이면 모든 주법 각도의 부호가 뒤집히고 그건 에러 없이
리어풋을 포어풋으로 바꿔 보고합니다. `detectVerticalAxis` 가 데이터에서
판별하고(서 있는 사람의 머리는 발꿈치보다 위에 있으므로), 확신이 없으면 null을
돌려주어 호출자가 명시하게 합니다.

---

## 내부 평활을 끄는 것

Sports2D는 쓰기 전에 Hampel + Butterworth 6Hz를 통과시킵니다. 저역통과 두 단을
직렬로 걸면 유효 창이 넓어지므로, 어댑터로 넣은 프레임을 분석할 때는 반드시

```ts
analyzeLandings(frames, { ...options, preFiltered: true })
```

로 호출합니다. 이걸 빼면 **우리 평활을 재고 포즈 추정 차이라고 보고**하게 됩니다.

---

## 이 도구가 말해 주지 않는 것

Sports2D도 카메라 한 대의 2D 추정입니다. 원문 조건이 "촬영면과 가능한 한 평행하게"
이고 "깊이(Z)는 과신하지 말 것"입니다. 그래서 1단계 비교로는 **두 도구가 다르다는
사실만** 알 수 있고, 어느 쪽이 맞는지는 알 수 없습니다.

정확도를 숫자로 주장하려면 240fps 클립의 **수동 라벨**(설계 문서 6절 2단)이
필요합니다. `clips.csv` 의 `strike` 열은 촬영 시 의도한 주법이고 라벨이 아닙니다 —
라벨은 착지 단위로 따로 만듭니다.
