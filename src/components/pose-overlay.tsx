"use client";

import { SKELETON, type Landmark } from "@/lib/pose";
import { useEffect, useRef, type RefObject } from "react";

/**
 * `clear` is on by default because the live overlay redraws every animation
 * frame on top of itself. An exported still is the other case: the frame and
 * its background are already on the canvas, and wiping them is how the first
 * version of the export came out transparent — with the video path about to
 * lose the photograph the same way.
 */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[] | null,
  width: number,
  height: number,
  { clear = true }: { clear?: boolean } = {},
) {
  if (clear) ctx.clearRect(0, 0, width, height);
  if (!landmarks?.length) return;
  ctx.lineWidth = Math.max(2, width / 280);
  ctx.strokeStyle = "rgba(224, 64, 42, 0.95)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const [a, b] of SKELETON) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * width, pa.y * height);
    ctx.lineTo(pb.x * width, pb.y * height);
    ctx.stroke();
  }
  for (const point of landmarks) {
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, Math.max(2, width / 220), 0, Math.PI * 2);
    ctx.fill();
  }
}

type OverlayProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  landmarks: Landmark[] | null;
  className?: string;
};

export function PoseOverlay({ videoRef, landmarks, className }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 360;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      drawPose(ctx, landmarks, w, h);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [videoRef, landmarks]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}

/** Stick figure for the sample session, when there is no video element. */
export function PoseSketch({
  landmarks,
  className,
}: {
  landmarks: Landmark[] | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = 1280;
    const h = 720;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, w, h);
    drawPose(ctx, landmarks, w, h);
  }, [landmarks]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
