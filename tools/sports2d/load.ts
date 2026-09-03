/**
 * Loading a Sports2D run from disk, for the offline tools.
 *
 * Shared by report.ts and framerate.ts because both need the same three
 * things and getting any of them wrong is silent: the pixel TRC rather than
 * the metre one, the frame size from the calibration file rather than a guess,
 * and the vertical axis read out of the data rather than assumed.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { PoseFrame } from "../../src/lib/landing-analysis";
import {
  detectVerticalAxis,
  halpe26ToPoseFrames,
  parseTrc,
  type TrcTable,
  type VerticalAxis,
} from "../../src/lib/sports2d";

export type LoadedRun = {
  trcPath: string;
  table: TrcTable;
  frames: PoseFrame[];
  width: number;
  height: number;
  verticalAxis: VerticalAxis;
};

/** First match anywhere under a directory, or the file itself. */
export function find(root: string, pick: (name: string) => boolean): string | null {
  if (statSync(root).isFile()) return pick(root) ? root : null;
  for (const entry of readdirSync(root)) {
    const found = find(join(root, entry), pick);
    if (found) return found;
  }
  return null;
}

/** Throws with a reason rather than returning something plausible. */
export function loadRun(target: string): LoadedRun {
  const trcPath = find(target, (name) => name.endsWith(".trc") && name.includes("_px_"));
  if (!trcPath) throw new Error(`픽셀 TRC를 찾지 못했습니다: ${target}`);

  const calib = find(target, (name) => name.endsWith("_calib.toml"));
  const dims = calib
    ? readFileSync(calib, "utf8").match(/size\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/)
    : null;
  if (!dims) {
    throw new Error("calib.toml 에서 프레임 크기를 읽지 못했습니다 — 정규화를 추측하지 않습니다");
  }
  const width = Number(dims[1]);
  const height = Number(dims[2]);

  const table = parseTrc(readFileSync(trcPath, "utf8"));
  const verticalAxis = detectVerticalAxis(table);
  if (!verticalAxis) {
    throw new Error("y축 방향을 데이터에서 판별하지 못했습니다 — 추측하면 주법이 뒤집힙니다");
  }

  return {
    trcPath,
    table,
    width,
    height,
    verticalAxis,
    frames: halpe26ToPoseFrames(table, { width, height, verticalAxis }),
  };
}
