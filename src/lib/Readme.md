# A-1 · A-2 · A-3

이 폴더의 파일은 주법 판정, 브랜드 순위, 금지어 검사의 단일 구현입니다. 같은 역할의 함수를 别处에 새로 얹지 말고 여기를 쓰세요.

| 파일 | 역할 |
| --- | --- |
| `Footstrike.ts` | 착지 주법. 바깥 구간을 먼저 보고, 유한하지 않은 각도는 unknown |
| `Footstrike.test.ts` | 경계값 9개 (`npm run test:analysis`) |
| `Shoeranking.ts` | `PRIORITY_BRANDS` 순서가 곧 노출 순서. unknown은 `{ kind: "general" }` |
| `Shoeranking.test.ts` | 입력 순서를 뒤집어도 Nike → Asics → Adidas |
| `../../scripts/check-language.mjs` | `npm run check:language`. 면책은 통과, 실제 위반만 잡고 종료 코드 1 |

## A-1 주법

`angle <= 8`로 미드풋을 먼저 잡으면 `+8`이 미드풋으로 빨려 들어갑니다. 리어풋(`<= -8`)과 포어풋(`>= 8`)을 먼저 걸러냅니다. `Number.isFinite`가 없으면 `NaN`이 모든 비교에서 false가 되어 조용히 미드풋이 됩니다.

## A-2 브랜드

`PRIORITY_BRANDS = ["Nike", "Asics", "Adidas"]`. 주법이 없으면 빈 배열 대신 `kind: "general"`을 돌려 호출부가 `.map()`으로 그냥 지나가지 못하게 합니다. 신발 필드(`brand`, `model`, `category`, `heelDropMm`, `weightG`, `features`)는 기존 `Shoe` 타입을 따릅니다.

## A-3 금지어

면책(아닙니다 / 수는 없습니다)은 통과하고, 실제 위반만 실패합니다. CI에 `npm run check:language`를 붙이면 됩니다.
