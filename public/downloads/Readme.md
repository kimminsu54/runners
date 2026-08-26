# A-1 · A-2 · A-3

이 폴더의 파일은 주법 판정, 브랜드 순위, 금지어 검사의 단일 구현입니다. 같은 역할의 함수를 别处에 새로 얹지 말고 여기를 쓰세요.

| 파일 | 역할 |
| --- | --- |
| `Footstrike.ts` | 착지 주법. 바깥 구간 먼저, `view`, `±40°`, 분모는 판정된 착지 |
| `Footstrike.test.ts` | 경계값 15개 (`npm run test:analysis`) |
| `Shoeranking.ts` | `recommendShoes`가 `{ primary, others }`를 한 번에 내림. `N/A`는 `null` |
| `Shoeranking.test.ts` | 순서를 뒤집어도 Nike → Asics → Adidas, 높은 점수를 고름 |
| `../../scripts/check-language.mjs` | `npm run check:language`. 면책은 통과, 실제 위반만 잡고 종료 코드 1 |

## A-1 주법

`angle <= 8`로 미드풋을 먼저 잡으면 `+8`이 미드풋으로 빨려 들어갑니다. 리어풋(`<= -8`)과 포어풋(`>= 8`)을 먼저 걸러냅니다. `Number.isFinite`가 없으면 `NaN`이 모든 비교에서 false가 되어 조용히 미드풋이 됩니다. 정면은 `view: "front"`로 unknown입니다.

## A-2 브랜드

`PRIORITY_BRANDS = ["Nike", "Asics", "Adidas"]`. 주법이 없으면 빈 배열 대신 `kind: "general"`을 돌려 호출부가 `.map()`으로 그냥 지나가지 못하게 합니다. `전체`는 모든 주법 풀에, `미드풋|포어풋`은 두 풀에 들어갑니다.

## A-3 금지어

면책(아닙니다 / 수는 없습니다)은 통과하고, 실제 위반만 실패합니다. CI에 `npm run check:language`를 붙이면 됩니다. 걸린 문구는 예외 목록에 넣지 말고 고칩니다.
