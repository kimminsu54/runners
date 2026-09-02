/**
 * Reading Sports2D output into the shape this app already analyses.
 *
 * `analyzeLandings` is a pure function over normalised, MediaPipe-indexed
 * landmarks, so swapping the pose estimator is an adapter problem and not a
 * rewrite. That is what makes the comparison worth running: same clip, same
 * analysis, only the estimator differs, so any difference in the report came
 * from the estimator. It is also what a server-side precision path would use
 * later — the server returns coordinates, and the client's existing analysis
 * reads them, rather than a second copy of the analysis growing in Python.
 *
 * Two things this deliberately does not do.
 *
 * It reads the pixel TRC, not the metre one. Normalising pixels by the frame
 * size produces exactly what MediaPipe produces, so the app's own scale and
 * floor estimates still apply and the experiment isolates one variable.
 * Adopting Sports2D's metre scale and detected floor angle removes two real
 * error sources, and each deserves its own measurement afterwards.
 *
 * It does not carry confidence. TRC has no per-marker confidence column, so a
 * present marker is reported as fully visible — including the frames Sports2D
 * interpolated across gaps of up to ten frames. Interpolated frames are
 * therefore indistinguishable from measured ones here, which matters because
 * the quality gate counts tracked frames.
 */

import type { PoseFrame } from "@/lib/landing-analysis";
import { LM, type Landmark } from "@/lib/pose";

export type Vec3 = { x: number; y: number; z: number };

export type TrcFrame = {
  time: number;
  /** One entry per marker in `markers`, null where the row was blank. */
  points: Array<Vec3 | null>;
};

export type TrcTable = {
  /** Frames per second, from the header. */
  rate: number;
  /** Header units, verbatim — "px" or "m" for Sports2D. */
  units: string;
  markers: string[];
  frames: TrcFrame[];
};

/**
 * Parses an OpenSim TRC table.
 *
 * The header is read by finding the row that starts with `Frame#` rather than
 * by counting lines: Sports2D and OpenSim agree on the format but not on every
 * blank, and a parser that trusts line numbers breaks on the first tool that
 * writes one more tab than expected.
 */
export function parseTrc(text: string): TrcTable {
  const lines = text.split(/\r?\n/);
  const nameRow = lines.findIndex((line) => line.startsWith("Frame#"));
  if (nameRow < 1) {
    throw new Error("TRC: no 'Frame#' header row");
  }

  // The two rows above the marker names are the metadata field names and their
  // values, in the same column order.
  const fields = lines[nameRow - 2]?.split("\t").map((cell) => cell.trim()) ?? [];
  const values = lines[nameRow - 1]?.split("\t").map((cell) => cell.trim()) ?? [];
  const field = (name: string) => {
    const at = fields.indexOf(name);
    return at >= 0 ? values[at] : undefined;
  };
  const rate = Number(field("DataRate"));
  const units = field("Units") ?? "";

  const markers = lines[nameRow]
    .split("\t")
    .slice(2)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  if (!markers.length) throw new Error("TRC: no marker names");

  // nameRow + 1 is the X1 Y1 Z1 … axis row.
  const frames: TrcFrame[] = [];
  for (let i = nameRow + 2; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw?.trim()) continue;
    const cells = raw.split("\t");
    const time = Number(cells[1]);
    if (!Number.isFinite(time)) continue;
    const points = markers.map((_, m) => {
      const x = Number(cells[2 + m * 3]);
      const y = Number(cells[3 + m * 3]);
      const z = Number(cells[4 + m * 3]);
      // A gap is written as empty cells, which Number() turns into 0, so the
      // blank has to be checked before the number is trusted.
      const blank =
        !cells[2 + m * 3]?.trim() ||
        !cells[3 + m * 3]?.trim() ||
        !Number.isFinite(x) ||
        !Number.isFinite(y);
      return blank ? null : { x, y, z: Number.isFinite(z) ? z : 0 };
    });
    frames.push({ time, points });
  }

  return { rate, units, markers, frames };
}

/**
 * HALPE_26, the keypoint set behind Sports2D's default `body_with_feet` model,
 * mapped onto the MediaPipe indices this app's analysis reads.
 *
 * The two that matter are the last pair. MediaPipe has one point at the end of
 * the foot; HALPE_26 has the big toe and the small toe separately, which is
 * what makes a foot long axis possible that does not swing with toe-out. The
 * small toes have no MediaPipe index and so are carried in `footExtras`.
 */
export const HALPE26_TO_MEDIAPIPE: ReadonlyArray<readonly [number, number]> = [
  [0, LM.nose],
  [1, LM.leftEye],
  [2, LM.rightEye],
  [3, LM.leftEar],
  [4, LM.rightEar],
  [5, LM.leftShoulder],
  [6, LM.rightShoulder],
  [7, 13], // left elbow
  [8, 14], // right elbow
  [9, 15], // left wrist
  [10, 16], // right wrist
  [11, LM.leftHip],
  [12, LM.rightHip],
  [13, LM.leftKnee],
  [14, LM.rightKnee],
  [15, LM.leftAnkle],
  [16, LM.rightAnkle],
  [24, LM.leftHeel],
  [25, LM.rightHeel],
  [20, LM.leftFootIndex],
  [21, LM.rightFootIndex],
];

/** HALPE_26 index of the small toes, which MediaPipe has no slot for. */
export const HALPE26_SMALL_TOE = { left: 22, right: 23 } as const;

/**
 * Which way the vertical axis runs in the file.
 *
 * The analysis is written for image coordinates, where y grows downward — the
 * foot-strike angle takes a positive `toe.y - heel.y` to mean the forefoot is
 * below the heel. Feed it a file whose y grows upward and every strike angle
 * flips sign, which does not fail: it silently reports rearfoot contacts as
 * forefoot and forefoot as rearfoot. So the convention is a required argument,
 * never a default.
 */
export type VerticalAxis = "image-down" | "world-up";

/**
 * Reads the convention out of the data instead of asking anyone to remember it.
 *
 * An upright runner's head is above their heels, whatever the units, so the
 * sign of nose-minus-heel settles it with no room for argument. Returns null
 * when neither marker is present often enough to be sure, in which case the
 * caller has to say.
 */
export function detectVerticalAxis(table: TrcTable): VerticalAxis | null {
  const noseAt = table.markers.findIndex((name) => /^nose$/i.test(name));
  const heelAt = table.markers.findIndex((name) => /heel/i.test(name));
  if (noseAt < 0 || heelAt < 0) return null;

  let down = 0;
  let up = 0;
  for (const frame of table.frames) {
    const nose = frame.points[noseAt];
    const heel = frame.points[heelAt];
    if (!nose || !heel) continue;
    if (nose.y < heel.y) down += 1;
    else if (nose.y > heel.y) up += 1;
  }
  const seen = down + up;
  if (seen < 5) return null;
  // A clear majority, not a bare one: a runner mid-flight with a badly tracked
  // heel can put one frame the wrong way round.
  if (down / seen > 0.8) return "image-down";
  if (up / seen > 0.8) return "world-up";
  return null;
}

export type Sports2dAdaptOptions = {
  /** Frame size the pixel coordinates were written against. */
  width: number;
  height: number;
  /** Pass `detectVerticalAxis`'s answer, or state it. Never guessed here. */
  verticalAxis: VerticalAxis;
};

/**
 * Turns a parsed pixel TRC into the frames `analyzeLandings` takes.
 *
 * Markers absent from a frame become landmarks with zero visibility rather
 * than being dropped, because the analysis asks about individual joints —
 * `isVisible(heel)` has to be able to say no while the rest of the pose is
 * still usable. A frame with no usable marker at all becomes a null pose,
 * which is what the tracked-frame ratio counts.
 */
export function halpe26ToPoseFrames(
  table: TrcTable,
  options: Sports2dAdaptOptions,
): PoseFrame[] {
  const { width, height, verticalAxis } = options;
  if (!(width > 0) || !(height > 0)) {
    throw new Error("frame width and height are needed to normalise pixels");
  }

  const missing: Landmark = { x: 0, y: 0, z: 0, visibility: 0 };
  const toLandmark = (point: Vec3): Landmark => ({
    x: point.x / width,
    // The analysis speaks image coordinates. A world-up file is flipped once,
    // here, so nothing downstream has to know which file it came from.
    y: verticalAxis === "image-down" ? point.y / height : 1 - point.y / height,
    z: point.z / width,
    // TRC carries no confidence. A marker that is present is reported as seen;
    // see the note at the top of this file about interpolated frames.
    visibility: 1,
  });

  return table.frames.map((frame) => {
    const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ ...missing }));
    let seen = 0;
    for (const [halpe, mediapipe] of HALPE26_TO_MEDIAPIPE) {
      const point = frame.points[halpe];
      if (!point) continue;
      landmarks[mediapipe] = toLandmark(point);
      seen += 1;
    }
    if (!seen) return { t: frame.time, landmarks: null };

    const smallToe = (index: number) => {
      const point = frame.points[index];
      return point ? toLandmark(point) : undefined;
    };
    const leftSmallToe = smallToe(HALPE26_SMALL_TOE.left);
    const rightSmallToe = smallToe(HALPE26_SMALL_TOE.right);

    return {
      t: frame.time,
      landmarks,
      ...(leftSmallToe || rightSmallToe
        ? { footExtras: { leftSmallToe, rightSmallToe } }
        : {}),
    };
  });
}
