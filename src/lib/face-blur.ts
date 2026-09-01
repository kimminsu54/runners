/**
 * Hiding the face in an exported frame.
 *
 * Worth being precise about what this is for. The video never leaves the
 * browser, so blurring nothing would not have leaked anything — this exists
 * because the export button creates the first file that *can* leave, and a
 * still of someone running is a picture of their face unless something removes
 * it. It is a sharing feature, not the privacy guarantee; that guarantee is
 * that the clip is never uploaded, and it is unchanged.
 *
 * The face is found from the pose landmarks the analysis already has — nose,
 * eyes, ears and mouth — rather than from a second detector. They are tracked
 * for every frame anyway, and a detector that disagreed with them would be one
 * more thing that can fail on its own.
 *
 * Failure is closed. A frame whose face cannot be located does not export
 * unblurred: the search widens to the neighbouring frames, then falls back to
 * covering the whole upper third, and only a frame where even that cannot be
 * drawn is refused outright. The ordering matters — the tempting default, "no
 * landmarks, so nothing to blur", is exactly the case where a face is present
 * and the tracker simply lost it.
 */

import { distPx, isVisible, LM, mid, type Landmark } from "@/lib/pose";
import type { PoseFrame } from "@/lib/landing-analysis";

export type FaceBox = { x: number; y: number; width: number; height: number };

/**
 * Which rung of the ladder answered. Carried out of here and onto the exported
 * image, because "the face is covered" is a claim, and a claim the viewer
 * cannot check is worth very little — the first report of this feature was that
 * the mosaic had not been applied, and nothing in the file could say whether
 * that was true, false, or a sample session with no photograph in it.
 */
export type FaceCover =
  /** Found on the exported frame itself. */
  | "frame"
  /** The tracker lost it there; a neighbouring frame supplied the box. */
  | "neighbour"
  /** No frame in the clip had a face. The whole upper third is covered. */
  | "fallback"
  /** There is no photograph to cover: the sample session draws a stick figure. */
  | "no-photo"
  /**
   * The runner turned face hiding off. Not a failure — the guard here is
   * against the tracker losing a face, not against someone deciding what to do
   * with a picture of themselves — but it is recorded on the image, because a
   * file that carries a face should say that it does.
   */
  | "off";

export type FaceCoverResult = { box: FaceBox; source: FaceCover };

/** Landmarks that lie on the face. */
const FACE_POINTS = [
  LM.nose,
  LM.leftEye,
  LM.rightEye,
  LM.leftEar,
  LM.rightEar,
  LM.mouthLeft,
  LM.mouthRight,
];

/**
 * The landmarks trace eyes, nose and mouth, which is the middle of a face and
 * not its edges: the skull continues above the eyes, the jaw below the mouth,
 * and hair beyond both. These pad the traced box out to a head.
 *
 * They were three times larger, which covered the head and a good part of the
 * shoulders with it — a block on the picture rather than a covered face. The
 * numbers below put roughly a third of a head's width of margin at each side,
 * more above than below because that is where the hair is. Anonymity is not
 * improved by covering a shoulder.
 */
const PAD_X = 0.35;
const PAD_ABOVE = 0.95;
const PAD_BELOW = 0.65;

/**
 * A head is about this fraction of the distance from the nose to the middle of
 * the shoulders, and that distance survives the runner turning sideways.
 *
 * The face landmarks alone do not. Seen straight on they span ear to ear, which
 * is a head wide; in profile the far ear and eye drop out and the span halves,
 * which would halve the box on exactly the footage this app is built for. Using
 * the larger of the two keeps one number meaning the same thing in both views.
 */
const HEAD_FROM_SHOULDERS = 0.9;

/** How wide the box gets however little of the face is visible, in head widths. */
const MIN_WIDTH_IN_HEADS = 1.6;

/** Below this the points are one blob and the box would be noise-sized. */
const MIN_SPAN_PX = 6;

export function faceBoxFrom(
  landmarks: Landmark[] | null,
  width: number,
  height: number,
): FaceBox | null {
  if (!landmarks?.length) return null;
  const points = FACE_POINTS.map((index) => landmarks[index]).filter(
    (point): point is Landmark => isVisible(point, 0.3),
  );
  if (points.length < 2) return null;

  const xs = points.map((p) => p.x * width);
  const ys = points.map((p) => p.y * height);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const spanX = right - left;
  const spanY = bottom - top;
  const span = Math.max(spanX, spanY, headScaleFrom(landmarks, width, height));
  if (span < MIN_SPAN_PX) return null;

  // In profile the visible points bracket the front of the face only — the ear
  // is the furthest back of them, and the skull carries on behind it. Padding
  // the landmark spread alone leaves a third of the head out, so the box also
  // has a floor in head widths, grown around the middle of what was seen.
  const boxWidth = Math.max(spanX + span * PAD_X * 2, span * MIN_WIDTH_IN_HEADS);
  const centreX = (left + right) / 2;

  return clampBox(
    {
      x: centreX - boxWidth / 2,
      y: top - span * PAD_ABOVE,
      width: boxWidth,
      height: spanY + span * (PAD_ABOVE + PAD_BELOW),
    },
    width,
    height,
  );
}

/**
 * The face box for one frame, widening to its neighbours when the tracker lost
 * it. A head does not move far in a tenth of a second, so a box from three
 * frames away still covers it — and covering slightly the wrong place beats
 * covering nothing.
 */
export function faceBoxNear(
  frames: PoseFrame[],
  index: number,
  width: number,
  height: number,
  maxSearch = 6,
): FaceCoverResult | null {
  const direct = faceBoxFrom(frames[index]?.landmarks ?? null, width, height);
  if (direct) return { box: direct, source: "frame" };
  for (let step = 1; step <= maxSearch; step++) {
    for (const at of [index - step, index + step]) {
      if (at < 0 || at >= frames.length) continue;
      const box = faceBoxFrom(frames[at]?.landmarks ?? null, width, height);
      if (box) return { box, source: "neighbour" };
    }
  }
  return null;
}

/** What the exported image says about the face, in the corner where it says it. */
export const FACE_COVER_LABEL: Record<FaceCover, string> = {
  frame: "얼굴 모자이크 적용",
  neighbour: "얼굴 모자이크 적용 (앞뒤 프레임 기준)",
  fallback: "얼굴을 찾지 못해 상단 전체를 모자이크",
  "no-photo": "샘플 세션 · 영상 없음",
  off: "얼굴 가리기 끔 (사용자 선택)",
};

/**
 * What to cover when no frame in the clip yielded a face: the whole upper
 * third. Crude on purpose. It is the difference between exporting a picture of
 * someone and exporting a picture of someone's legs, which is what the report
 * is about anyway.
 */
export function fallbackFaceBox(width: number, height: number): FaceBox {
  return { x: 0, y: 0, width, height: Math.round(height / 3) };
}

/**
 * Head width inferred from the nose and the shoulders, or NaN when either is
 * missing. Only ever used as a floor under the landmark span, so a bad estimate
 * can make the box slightly too large and never too small.
 */
function headScaleFrom(
  landmarks: Landmark[],
  width: number,
  height: number,
): number {
  const nose = landmarks[LM.nose];
  const shoulders = mid(landmarks[LM.leftShoulder], landmarks[LM.rightShoulder]);
  if (!isVisible(nose, 0.3) || !shoulders) return Number.NaN;
  if (
    !isVisible(landmarks[LM.leftShoulder], 0.3) &&
    !isVisible(landmarks[LM.rightShoulder], 0.3)
  ) {
    return Number.NaN;
  }
  return distPx(nose!, shoulders, width, height) * HEAD_FROM_SHOULDERS;
}

function clampBox(box: FaceBox, width: number, height: number): FaceBox {
  const x = Math.max(0, Math.min(box.x, width));
  const y = Math.max(0, Math.min(box.y, height));
  return {
    x,
    y,
    width: Math.max(1, Math.min(box.width, width - x)),
    height: Math.max(1, Math.min(box.height, height - y)),
  };
}

/**
 * How coarse the mosaic is: the box is reduced to about this many cells across
 * before being scaled back up.
 *
 * A mosaic rather than a blur, because a Gaussian blur of a small face is
 * reversible enough to be uncomfortable and, more practically, a fixed blur
 * radius stops hiding anything as soon as the video is larger than the one it
 * was tuned on. Cells scale with the box, so the result is the same at any
 * resolution.
 */
const MOSAIC_CELLS = 6;

export type MosaicPlan = {
  /** Size of the reduced copy the region is rebuilt from. */
  smallWidth: number;
  smallHeight: number;
  /** Source rectangle on the full-size canvas, snapped to whole pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The arithmetic of the mosaic, kept apart from the canvas so it can be
 * checked. Both sides have to stay whole-pixel and at least two cells across,
 * or the reduced copy collapses to a single colour on one axis and the result
 * is a flat rectangle rather than a mosaic.
 */
export function mosaicPlan(box: FaceBox, cells = MOSAIC_CELLS): MosaicPlan {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const across = Math.max(2, Math.min(cells, width, height));
  return {
    smallWidth: across,
    smallHeight: Math.max(2, Math.round((height / width) * across)),
    x,
    y,
    width,
    height,
  };
}

/**
 * Copies one region of `source` onto `dest` as a mosaic.
 *
 * Source and destination share a coordinate space: for the exported still they
 * are the same canvas, and for the live preview the source is the video element
 * and the destination is the transparent overlay drawn on top of it, sized to
 * the video's own pixels. That is what lets the preview cover a face it cannot
 * modify — the video element itself is untouched, and the overlay carries a
 * pixelated copy of the region at the same place.
 *
 * `scratch` is for callers redrawing every animation frame; allocating a canvas
 * sixty times a second is the kind of waste that only shows up on a slow
 * machine. Returns false when a context is refused, which is the caller's
 * signal to refuse rather than hand back an uncovered frame.
 */
export function pixelateInto(
  dest: HTMLCanvasElement,
  source: CanvasImageSource,
  box: FaceBox,
  scratch?: HTMLCanvasElement,
): boolean {
  const ctx = dest.getContext("2d");
  if (!ctx) return false;
  const plan = mosaicPlan(box);

  const small = scratch ?? document.createElement("canvas");
  small.width = plan.smallWidth;
  small.height = plan.smallHeight;
  const smallCtx = small.getContext("2d");
  if (!smallCtx) return false;

  smallCtx.imageSmoothingEnabled = true;
  smallCtx.clearRect(0, 0, plan.smallWidth, plan.smallHeight);
  smallCtx.drawImage(
    source,
    plan.x,
    plan.y,
    plan.width,
    plan.height,
    0,
    0,
    plan.smallWidth,
    plan.smallHeight,
  );

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    small,
    0,
    0,
    plan.smallWidth,
    plan.smallHeight,
    plan.x,
    plan.y,
    plan.width,
    plan.height,
  );
  ctx.restore();
  return true;
}

/** Pixelates one region of a canvas in place, reading and writing itself. */
export function pixelateRegion(
  canvas: HTMLCanvasElement,
  box: FaceBox,
): boolean {
  return pixelateInto(canvas, canvas, box);
}
