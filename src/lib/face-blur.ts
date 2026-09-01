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

import { isVisible, LM, type Landmark } from "@/lib/pose";
import type { PoseFrame } from "@/lib/landing-analysis";

export type FaceBox = { x: number; y: number; width: number; height: number };

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
 * and hair beyond both. These pad the traced box out to something that covers a
 * head, generously — an over-large blur costs a little of the runner's
 * shoulder, an under-large one costs their anonymity.
 */
const PAD_X = 1.1;
const PAD_ABOVE = 1.6;
const PAD_BELOW = 1.0;

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
  // A head seen straight on is wider than the eye-to-eye span but a head in
  // profile collapses it, so size the padding from whichever span is larger.
  const span = Math.max(spanX, spanY);
  if (span < MIN_SPAN_PX) return null;

  return clampBox(
    {
      x: left - span * PAD_X,
      y: top - span * PAD_ABOVE,
      width: spanX + span * PAD_X * 2,
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
): FaceBox | null {
  const direct = faceBoxFrom(frames[index]?.landmarks ?? null, width, height);
  if (direct) return direct;
  for (let step = 1; step <= maxSearch; step++) {
    for (const at of [index - step, index + step]) {
      if (at < 0 || at >= frames.length) continue;
      const box = faceBoxFrom(frames[at]?.landmarks ?? null, width, height);
      if (box) return box;
    }
  }
  return null;
}

/**
 * What to cover when no frame in the clip yielded a face: the whole upper
 * third. Crude on purpose. It is the difference between exporting a picture of
 * someone and exporting a picture of someone's legs, which is what the report
 * is about anyway.
 */
export function fallbackFaceBox(width: number, height: number): FaceBox {
  return { x: 0, y: 0, width, height: Math.round(height / 3) };
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

/**
 * Pixelates one region of a canvas in place. Returns false when the browser
 * would not give the scratch context, which is the caller's signal to refuse
 * the export rather than hand back an unblurred frame.
 */
export function pixelateRegion(
  canvas: HTMLCanvasElement,
  box: FaceBox,
): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));
  const cells = Math.max(2, Math.min(MOSAIC_CELLS, w, h));
  const smallW = cells;
  const smallH = Math.max(2, Math.round((h / w) * cells));

  const scratch = document.createElement("canvas");
  scratch.width = smallW;
  scratch.height = smallH;
  const scratchCtx = scratch.getContext("2d");
  if (!scratchCtx) return false;

  scratchCtx.imageSmoothingEnabled = true;
  scratchCtx.drawImage(canvas, box.x, box.y, w, h, 0, 0, smallW, smallH);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, smallW, smallH, box.x, box.y, w, h);
  ctx.restore();
  return true;
}
