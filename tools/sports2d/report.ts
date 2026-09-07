/**
 * Runs this app's analysis over a Sports2D pixel TRC and prints the report.
 *
 * This is the other half of the instrument. `run.py` produces the TRC; this
 * reads it through `src/lib/sports2d.ts` and hands it to the same
 * `analyzeLandings` the browser calls, so the two pipelines can be compared on
 * one clip with pose estimation as the only variable.
 *
 *     npx tsx tools/sports2d/report.ts tools/sports2d/out/02
 *     npx tsx tools/sports2d/report.ts <dir-or-trc> --stature 1.72 --mass 68
 *
 * Finding the right file is `load.ts`'s job and deliberately not repeated here.
 * It had been repeated, and the two copies disagreed: one picked the person
 * Sports2D tracked longest and the other took whichever file the walk found
 * last, so the same run printed two different reports depending on which tool
 * asked.
 */

import {
  analyzeLandings,
  cadenceSpm,
  strikeAngleSettles,
} from "../../src/lib/landing-analysis";
import { loadRun } from "./load";

function main(argv: string[]): number {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const flag = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const target = positional[0];
  if (!target) {
    console.error("사용법: npx tsx tools/sports2d/report.ts <out/<id> 또는 .trc>");
    return 2;
  }

  // The declared height is what Sports2D scales metres by; we read pixels, so
  // the stature the analysis uses is ours to pass and is stated in the output
  // rather than left implicit.
  const statureM = Number(flag("stature") ?? 1.7);
  const massKg = Number(flag("mass") ?? 70);

  let run;
  try {
    run = loadRun(target);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { trcPath, table, frames, width, height, verticalAxis: axis, people } = run;
  const tracked = frames.filter((frame) => frame.landmarks).length;

  // preFiltered because Sports2D already ran Hampel + Butterworth 6 Hz. Without
  // it we would measure our own smoothing and call it a pose difference.
  const result = analyzeLandings(frames, {
    statureM,
    massKg,
    width,
    height,
    preFiltered: true,
  });

  console.log(`TRC        ${trcPath}`);
  console.log(
    `사람       ${people}명 추적 · 가장 오래 잡힌 사람 선택` +
      (people > 1 ? " (person_ordering_method 는 on_click 이라 순서를 믿을 수 없습니다)" : ""),
  );
  console.log(`프레임     ${width}x${height} · ${table.rate} fps · ${table.frames.length}개 (추적 ${tracked}개)`);
  console.log(`마커       ${table.markers.length}개 · Units 필드 "${table.units}" (참고하지 않음)`);
  console.log(`y축        ${axis}`);
  console.log(`신장/체중  ${statureM}m / ${massKg}kg`);
  console.log(`카메라     ${result.cameraView}`);
  console.log(`품질       ${result.quality.level} · ${result.quality.reasons.join(", ") || "-"}`);
  // Cadence is not a field on the result — the caller derives it from the
  // landings, the same way the report screen does.
  const cadence = cadenceSpm(result.landings);
  const noContact = result.landings.filter(
    (landing) => !Number.isFinite(landing.contactMs),
  ).length;

  console.log(
    `케이던스   ${Number.isFinite(cadence) ? Math.round(cadence) : "-"} spm`,
  );
  // How many of the strike verdicts a single frame of doubt would change. This
  // is the number that decides whether the categories mean anything on a clip.
  const judged = result.landings.filter(
    (landing) => landing.footStrike !== "unknown",
  );
  const unsettled = judged.filter(
    (landing) =>
      !strikeAngleSettles(
        landing.footStrikeAngleDeg,
        landing.footStrikeAngleUncertaintyDeg,
      ),
  ).length;
  console.log(
    `착지       ${result.landings.length}개` +
      (noContact ? ` · 접지 시간 없음 ${noContact}개` : "") +
      (judged.length
        ? ` · 주법 판정 ${judged.length}개 중 ${unsettled}개는 한 프레임 차이로 바뀜`
        : ""),
  );
  for (const landing of result.landings) {
    console.log(
      `  ${landing.tContact.toFixed(3)}s ${landing.side.padEnd(5)} ${landing.footStrike.padEnd(9)}` +
        ` 각 ${landing.footStrikeAngleDeg.toFixed(1).padStart(6)}°` +
        ` ±${(Number.isFinite(landing.footStrikeAngleUncertaintyDeg) ? landing.footStrikeAngleUncertaintyDeg.toFixed(0) : "?").padStart(2)}°` +
        ` 반력 ${landing.peakGrfBw.toFixed(2)}BW` +
        ` 접지 ${(landing.contactMs / 1000).toFixed(3)}s` +
        ` 오버스트라이드 ${(landing.footAheadRatio * 100).toFixed(1)}%`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
