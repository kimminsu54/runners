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
 * A directory is searched for the pixel TRC; the metre one is deliberately not
 * used (see README, "왜 픽셀 TRC인가"). Frame size comes from the calib.toml
 * Sports2D writes beside it rather than from a guess, because normalising by
 * the wrong height would tilt every foot angle.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { analyzeLandings, cadenceSpm } from "../../src/lib/landing-analysis";
import { detectVerticalAxis, halpe26ToPoseFrames, parseTrc } from "../../src/lib/sports2d";

/** Deepest match first, so `out/02` finds the file Sports2D nested two down. */
function find(root: string, pick: (name: string) => boolean): string | null {
  if (statSync(root).isFile()) return pick(root) ? root : null;
  for (const entry of readdirSync(root)) {
    const found = find(join(root, entry), pick);
    if (found) return found;
  }
  return null;
}

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

  const trcPath = find(target, (name) => name.endsWith(".trc") && name.includes("_px_"));
  if (!trcPath) {
    console.error(`픽셀 TRC를 찾지 못했습니다: ${target}`);
    return 1;
  }

  // The declared height is what Sports2D scales metres by; we read pixels, so
  // the stature the analysis uses is ours to pass and is stated in the output
  // rather than left implicit.
  const statureM = Number(flag("stature") ?? 1.7);
  const massKg = Number(flag("mass") ?? 70);

  const calib = find(target, (name) => name.endsWith("_calib.toml"));
  const dims = calib
    ? readFileSync(calib, "utf8").match(/size\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/)
    : null;
  if (!dims) {
    console.error("calib.toml 에서 프레임 크기를 읽지 못했습니다 — 정규화를 추측하지 않습니다");
    return 1;
  }
  const width = Number(dims[1]);
  const height = Number(dims[2]);

  const table = parseTrc(readFileSync(trcPath, "utf8"));
  const axis = detectVerticalAxis(table);
  if (!axis) {
    console.error("y축 규약을 데이터에서 판별하지 못했습니다 — 추측하면 주법이 뒤집힙니다");
    return 1;
  }

  const frames = halpe26ToPoseFrames(table, { width, height, verticalAxis: axis });
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
  console.log(
    `착지       ${result.landings.length}개` +
      (noContact ? ` · 접지 시간 없음 ${noContact}개` : ""),
  );
  for (const landing of result.landings) {
    console.log(
      `  ${landing.tContact.toFixed(3)}s ${landing.side.padEnd(5)} ${landing.footStrike.padEnd(9)}` +
        ` 각 ${landing.footStrikeAngleDeg.toFixed(1).padStart(6)}°` +
        ` 반력 ${landing.peakGrfBw.toFixed(2)}BW` +
        ` 접지 ${(landing.contactMs / 1000).toFixed(3)}s` +
        ` 오버스트라이드 ${(landing.footAheadRatio * 100).toFixed(1)}%`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
