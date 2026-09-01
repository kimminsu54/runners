/**
 * Draws one landing as a picture you can keep.
 *
 * The report lives in a browser tab and disappears with it. This is the first
 * thing the app makes that outlives the session, which is why the numbers on it
 * are built by `buildHudFrame` under the same rules the screen obeys, and why
 * the note about what a 2D estimate is stays on the image rather than beside
 * it — the caveat has to travel with the picture.
 */

import { drawPose } from "@/components/pose-overlay";
import {
  blurRegion,
  FACE_COVER_LABEL,
  fallbackFaceBox,
  faceBoxNear,
  type FaceCover,
} from "@/lib/face-blur";
import type { PoseFrame } from "@/lib/landing-analysis";
import type { HudFrame } from "@/lib/hud-frame";

export type ExportFrameInput = {
  /** The seeked video, or null for the sample session, which has no footage. */
  video: HTMLVideoElement | null;
  frames: PoseFrame[];
  /** Index into `frames` of the moment being exported. */
  frameIndex: number;
  hud: HudFrame;
  /** Follows the preview toggle, so one control governs both. */
  coverFace: boolean;
};

const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;

export type ExportFrameResult = { blob: Blob; faceCover: FaceCover };

export type ExportPlan = {
  /** Whether the video frame goes on the canvas at all. */
  drawVideo: boolean;
  /** Whether a face is looked for and covered. */
  mosaic: boolean;
  /** Known up front unless the mosaic runs, where the ladder decides. */
  faceCover: FaceCover | null;
};

/**
 * The two independent decisions, pulled out of the drawing so they can be
 * checked.
 *
 * Not over-abstraction: folding them into one condition is a mistake that has
 * already been made here once, and it produced an export with face hiding
 * turned off that held no video frame at all — a skeleton on a black
 * rectangle, which no type or lint rule would ever object to.
 */
export function exportPlan(input: {
  hasVideo: boolean;
  coverFace: boolean;
}): ExportPlan {
  if (!input.hasVideo) {
    return { drawVideo: false, mosaic: false, faceCover: "no-photo" };
  }
  if (!input.coverFace) {
    return { drawVideo: true, mosaic: false, faceCover: "off" };
  }
  return { drawVideo: true, mosaic: true, faceCover: null };
}

export async function renderExportFrame(
  input: ExportFrameInput,
): Promise<ExportFrameResult | null> {
  const { video, frames, frameIndex, hud, coverFace } = input;
  const width = video?.videoWidth || FALLBACK_WIDTH;
  const height = video?.videoHeight || FALLBACK_HEIGHT;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0d0b0f";
  ctx.fillRect(0, 0, width, height);

  // Whether a face can be present is a property of the source, decided before
  // anything looks for one. "We found no landmarks, so there is nothing to
  // hide" would be the fail-open branch this module exists to avoid; "there is
  // no photograph here at all" is a different statement, and the only one that
  // licenses skipping the mosaic without anyone asking. Both of those, and the
  // runner's own choice to turn covering off, look identical from outside — so
  // each is reported rather than left silent.
  const plan = exportPlan({ hasVideo: Boolean(video), coverFace });
  let faceCover: FaceCover = plan.faceCover ?? "fallback";
  if (plan.drawVideo && video) {
    ctx.drawImage(video, 0, 0, width, height);
  }
  if (plan.mosaic) {
    const found = faceBoxNear(frames, frameIndex, width, height);
    faceCover = found?.source ?? "fallback";
    const box = found?.box ?? fallbackFaceBox(width, height);
    if (!blurRegion(canvas, box)) return null;
  }

  drawPose(ctx, frames[frameIndex]?.landmarks ?? null, width, height, {
    clear: false,
  });
  drawHud(ctx, hud, width, height, faceCover);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? { blob, faceCover } : null),
      "image/png",
    );
  });
}

/** Everything below is laid out against a 1280-wide frame and scaled. */
function drawHud(
  ctx: CanvasRenderingContext2D,
  hud: HudFrame,
  width: number,
  height: number,
  faceCover: FaceCover,
): void {
  const s = width / FALLBACK_WIDTH;
  const pad = 28 * s;
  const columns = Math.min(3, hud.rows.length);
  const rowsPerColumn = Math.ceil(hud.rows.length / columns);
  // Laid out from the bottom up so nothing collides as the row count changes:
  // a frontal still has five rows and a side-on one six, which is two rows per
  // column either way, but a future row would push the panel taller rather than
  // print over the note.
  const rowsTop = 96 * s;
  const rowStep = 64 * s;
  const valueOffset = 28 * s;
  const lastValue = rowsTop + (rowsPerColumn - 1) * rowStep + valueOffset;
  const hintOffset = lastValue + 34 * s;
  const noteOffset = hintOffset + 26 * s;
  const panelHeight = noteOffset + 16 * s;
  const top = height - panelHeight;

  const shade = ctx.createLinearGradient(0, top - 60 * s, 0, height);
  shade.addColorStop(0, "rgba(13, 11, 15, 0)");
  shade.addColorStop(0.35, "rgba(13, 11, 15, 0.82)");
  shade.addColorStop(1, "rgba(13, 11, 15, 0.95)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, top - 60 * s, width, panelHeight + 60 * s);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${30 * s}px system-ui, sans-serif`;
  // Measured in the font it is drawn in. Measuring after the switch to the
  // smaller subtitle font is how the two ran into each other.
  const titleWidth = ctx.measureText(hud.title).width;
  ctx.fillText(hud.title, pad, top + 40 * s);

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = `${19 * s}px system-ui, sans-serif`;
  ctx.fillText(hud.subtitle, pad + titleWidth + 24 * s, top + 40 * s);

  // The badge sits right-aligned on the title line.
  ctx.font = `600 ${20 * s}px system-ui, sans-serif`;
  const badgeWidth = ctx.measureText(hud.badge).width + 26 * s;
  const badgeHeight = 34 * s;
  const badgeX = width - pad - badgeWidth;
  const badgeY = top + 40 * s - badgeHeight + 8 * s;
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  roundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 17 * s);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(hud.badge, badgeX + 13 * s, badgeY + 24 * s);

  const columnWidth = (width - pad * 2) / columns;
  hud.rows.forEach((row, i) => {
    const column = Math.floor(i / rowsPerColumn);
    const within = i % rowsPerColumn;
    const x = pad + column * columnWidth;
    const y = top + rowsTop + within * rowStep;
    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    ctx.font = `${17 * s}px system-ui, sans-serif`;
    ctx.fillText(row.label, x, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${24 * s}px system-ui, sans-serif`;
    ctx.fillText(row.value, x, y + valueOffset);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.font = `${17 * s}px system-ui, sans-serif`;
  ctx.fillText(hud.hint, pad, top + hintOffset);
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = `${15 * s}px system-ui, sans-serif`;
  ctx.fillText(hud.note, pad, top + noteOffset);

  // The mosaic's own receipt, on the image, where anyone holding the file can
  // read it without taking the app's word for anything.
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = `${15 * s}px system-ui, sans-serif`;
  const cover = FACE_COVER_LABEL[faceCover];
  ctx.fillText(
    cover,
    width - pad - ctx.measureText(cover).width,
    top + hintOffset,
  );

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = `700 ${15 * s}px system-ui, sans-serif`;
  const mark = "STRIDE/LAB";
  ctx.fillText(mark, width - pad - ctx.measureText(mark).width, top + noteOffset);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
