/**
 * Loading a Sports2D result into the browser, so the reference pipeline can be
 * read on the same screen as the browser's own.
 *
 * Sports2D itself cannot run here — it is Python driving native onnxruntime —
 * and this does not try to. What it does is take the files Sports2D already
 * wrote and hand them to the analysis the app already has, which is the whole
 * point of the adapter: one clip, one analysis, pose estimation as the only
 * variable. Comparing the two then means running the clip normally, importing
 * the TRC, and reading the same report twice.
 *
 * Nothing leaves the browser. The files are read with FileReader like any
 * upload on this page, which is the same promise the hero makes about video.
 *
 * Every failure here is a refusal with a reason, never a fallback. Two of them
 * exist specifically because guessing would produce a plausible wrong answer:
 * the frame size, which normalisation depends on, and the vertical axis, which
 * decides whether a rearfoot landing is reported as a forefoot one.
 */

import {
  detectVerticalAxis,
  halpe26ToPoseFrames,
  parseTrc,
  type VerticalAxis,
} from "./sports2d";
import type { PoseFrame } from "./landing-analysis";

/** A file's name and contents, so this module never touches the DOM. */
export type NamedText = { name: string; text: string };

export type TrcImport = {
  frames: PoseFrame[];
  width: number;
  height: number;
  /** Frames per second from the TRC header. */
  rate: number;
  markerCount: number;
  /** How many frames carry a pose at all, for the note under the report. */
  trackedFrames: number;
  verticalAxis: VerticalAxis;
  /** The TRC's file name, shown where an uploaded clip's name would be. */
  sourceName: string;
  /**
   * Which clip this was, and which part of it, from the manifest run.py
   * writes. Both are needed to draw the skeleton over the footage: a TRC times
   * itself from zero, so a run of seconds 5 to 8 would line up against the
   * first three seconds of video and look plausible while being wrong.
   *
   * `clip` is null for a run made before the manifest existed, or one whose
   * manifest was not handed over. The caller must then not claim to know which
   * footage it belongs to.
   */
  clip: string | null;
  startS: number;
  /** How Sports2D was run, when the manifest says. For the provenance line. */
  mode: string | null;
};

/** The manifest run.py writes beside each run's outputs. */
const MANIFEST_NAME = "stride-lab.json";

type Manifest = { clip: string | null; startS: number; mode: string | null };

/**
 * Read the manifest, tolerating its absence and its malformation alike.
 *
 * A missing or broken manifest is not a reason to refuse the TRC — the numbers
 * in it are still worth reading. It is a reason not to claim which clip they
 * came from, which is why every field comes back nullable rather than
 * defaulted to something convenient.
 */
function readManifest(files: NamedText[]): Manifest {
  const found = files.find((file) => file.name.toLowerCase() === MANIFEST_NAME);
  if (!found) return { clip: null, startS: 0, mode: null };
  try {
    const parsed = JSON.parse(found.text) as Record<string, unknown>;
    const start = Number(parsed.start_s);
    return {
      clip: typeof parsed.clip === "string" ? parsed.clip : null,
      startS: Number.isFinite(start) ? start : 0,
      mode: typeof parsed.mode === "string" ? parsed.mode : null,
    };
  } catch {
    return { clip: null, startS: 0, mode: null };
  }
}

export type TrcImportResult =
  | { ok: true; value: TrcImport }
  | { ok: false; reason: string };

/**
 * Sports2D writes both a pixel and a metre TRC. We read the pixel one: divided
 * by the frame size it is exactly the shape MediaPipe produces, so the app's
 * own scale and floor estimates still apply and the comparison isolates pose
 * estimation. Taking Sports2D's metres would remove two real sources of error
 * at once and leave us unable to say which of them mattered.
 */
const isPixelTrc = (name: string) => /_px_.*\.trc$/i.test(name);
const isMetreTrc = (name: string) => /_m_.*\.trc$/i.test(name);
const isCalib = (name: string) => /_calib\.toml$/i.test(name);

/**
 * Whether a file is worth reading at all.
 *
 * A Sports2D output folder holds a rendered video, a frame image per frame and
 * a graph per marker. Handed the whole folder — which is the easiest thing for
 * a person to do — the caller must not read those as text; it filters with
 * this first. The metre TRC is included so that picking it gets the refusal
 * that says which file to use, rather than silently nothing.
 */
export function isImportCandidate(name: string): boolean {
  return (
    isPixelTrc(name) ||
    isMetreTrc(name) ||
    isCalib(name) ||
    name.toLowerCase() === MANIFEST_NAME
  );
}

/** Frame size out of the calibration file Sports2D writes beside the TRC. */
function frameSize(text: string): { width: number; height: number } | null {
  const match = text.match(/size\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function importTrc(files: NamedText[]): TrcImportResult {
  const trc = files.find((file) => isPixelTrc(file.name));
  if (!trc) {
    const metre = files.find((file) => isMetreTrc(file.name));
    if (metre) {
      return {
        ok: false,
        reason:
          "미터 TRC(_m_)가 아니라 픽셀 TRC(_px_)가 필요합니다. 같은 폴더에 함께 있습니다.",
      };
    }
    return {
      ok: false,
      reason: "픽셀 TRC(_px_….trc)를 찾지 못했습니다.",
    };
  }

  // The frame size is not in the TRC — its Units field says `m` even in the
  // pixel file — so it comes from the calibration file or not at all. A
  // guessed size tilts every foot angle, which is a wrong answer that looks
  // right, so this refuses instead.
  const calib = files.find((file) => isCalib(file.name));
  if (!calib) {
    return {
      ok: false,
      reason:
        "…_calib.toml 도 함께 골라 주세요. 프레임 크기가 거기 있고, 추측하면 발 각도가 전부 기울어집니다.",
    };
  }
  const size = frameSize(calib.text);
  if (!size) {
    return { ok: false, reason: `${calib.name} 에서 프레임 크기를 읽지 못했습니다.` };
  }

  let table;
  try {
    table = parseTrc(trc.text);
  } catch (error) {
    return {
      ok: false,
      reason: `TRC를 읽지 못했습니다: ${error instanceof Error ? error.message : "형식 오류"}`,
    };
  }

  // Whether y grows downward is read out of the data, because a standing
  // person's head is above their heels. Getting it wrong does not fail — it
  // flips the sign of every strike angle and reports rearfoot contacts as
  // forefoot ones.
  const verticalAxis = detectVerticalAxis(table);
  if (!verticalAxis) {
    return {
      ok: false,
      reason: "y축 방향을 데이터에서 판별하지 못했습니다. 추측하면 주법 판정이 뒤집힙니다.",
    };
  }

  const frames = halpe26ToPoseFrames(table, { ...size, verticalAxis });
  const trackedFrames = frames.filter((frame) => frame.landmarks).length;
  if (trackedFrames < 2) {
    return { ok: false, reason: "사람이 잡힌 프레임이 없습니다." };
  }

  return {
    ok: true,
    value: {
      frames,
      ...size,
      rate: table.rate,
      markerCount: table.markers.length,
      trackedFrames,
      verticalAxis,
      sourceName: trc.name,
      ...readManifest(files),
    },
  };
}
