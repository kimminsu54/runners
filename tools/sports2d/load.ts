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
  trackedFrameCount,
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
  /** How many people Sports2D tracked, so a choice among them is visible. */
  people: number;
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

/** Every match anywhere under a directory. */
export function findAll(root: string, pick: (name: string) => boolean): string[] {
  if (statSync(root).isFile()) return pick(root) ? [root] : [];
  return readdirSync(root).flatMap((entry) => findAll(join(root, entry), pick));
}

const isPixelTrc = (name: string) => name.endsWith(".trc") && name.includes("_px_");

/**
 * The runs under a path, which is either one run or a directory of them.
 *
 * Asking only whether a TRC exists somewhere beneath is not enough, because it
 * is true of `out` as well as of `out/06`, and treating the whole output tree
 * as one run made `loadRun` pick the best-tracked person across every clip and
 * report it as though it were one. So the test is whether an immediate
 * subdirectory has a TRC of its own: that makes the path a collection, and
 * anything else with a TRC beneath it a single run.
 *
 * Naming conventions would have been the wrong test either way — Sports2D
 * names its output folder after the clip, and the ids come from clips.csv.
 */
export function runsUnder(target: string): string[] {
  if (statSync(target).isFile()) return isPixelTrc(target) ? [target] : [];
  const children = readdirSync(target)
    .map((entry) => join(target, entry))
    .filter((path) => statSync(path).isDirectory());
  const collection = children.filter((path) => findAll(path, isPixelTrc).length);
  if (collection.length) return collection;
  return findAll(target, isPixelTrc).length ? [target] : [];
}

/** Throws with a reason rather than returning something plausible. */
export function loadRun(target: string): LoadedRun {
  const candidates = findAll(target, isPixelTrc);
  if (!candidates.length) throw new Error(`픽셀 TRC를 찾지 못했습니다: ${target}`);

  // The person on screen the longest. Taking the first file found read
  // person13 of a race clip — a spectator — and every number after that was
  // about them.
  const parsed = candidates
    .map((path) => {
      const table = parseTrc(readFileSync(path, "utf8"));
      return { path, table, tracked: trackedFrameCount(table) };
    })
    .sort((a, b) => b.tracked - a.tracked);
  const chosen = parsed[0];
  const trcPath = chosen.path;

  const calib = find(target, (name) => name.endsWith("_calib.toml"));
  const dims = calib
    ? readFileSync(calib, "utf8").match(/size\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/)
    : null;
  if (!dims) {
    throw new Error("calib.toml 에서 프레임 크기를 읽지 못했습니다 — 정규화를 추측하지 않습니다");
  }
  const width = Number(dims[1]);
  const height = Number(dims[2]);

  const table = chosen.table;
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
    people: candidates.length,
    frames: halpe26ToPoseFrames(table, { width, height, verticalAxis }),
  };
}
