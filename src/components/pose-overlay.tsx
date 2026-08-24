"use client";

import { SKELETON, type Landmark } from "@/lib/pose";
import { useEffect, useRef, type RefObject } from "react";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  landmarks: Landmark[] | null;
  className?: string;
};

export function PoseOverlay({ videoRef, landmarks, className }: Props) {
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
      ctx.clearRect(0, 0, w, h);
      if (landmarks?.length) {
        ctx.lineWidth = Math.max(2, w / 280);
        ctx.strokeStyle = "rgba(224, 64, 42, 0.95)";
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        for (const [a, b] of SKELETON) {
          const pa = landmarks[a];
          const pb = landmarks[b];
          if (!pa || !pb) continue;
          ctx.beginPath();
          ctx.moveTo(pa.x * w, pa.y * h);
          ctx.lineTo(pb.x * w, pb.y * h);
          ctx.stroke();
        }
        for (const p of landmarks) {
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, Math.max(2, w / 220), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [videoRef, landmarks]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
    />
  );
}
