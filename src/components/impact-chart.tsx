"use client";

import type { SeriesPoint } from "@/lib/landing-analysis";
import { formatSeconds } from "@/lib/landing-analysis";

type Props = {
  series: SeriesPoint[];
  landingTimes: number[];
  selectedTime: number | null;
  onSelectTime?: (t: number) => void;
};

export function ImpactChart({ series, landingTimes, selectedTime, onSelectTime }: Props) {
  if (series.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        분석할 궤적이 없습니다.
      </div>
    );
  }

  const w = 720;
  const h = 180;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const t0 = series[0].t;
  const t1 = series[series.length - 1].t;
  const grfs = series.map((s) => s.grfBw).filter(Number.isFinite);
  const maxG = Math.max(2.2, ...grfs, 1);
  const x = (t: number) => pad.l + ((t - t0) / Math.max(0.001, t1 - t0)) * (w - pad.l - pad.r);
  const y = (g: number) => pad.t + (1 - g / maxG) * (h - pad.t - pad.b);

  const path = series
    .filter((s) => Number.isFinite(s.grfBw))
    .map((s, i) => `${i === 0 ? "M" : "L"} ${x(s.t).toFixed(1)} ${y(s.grfBw).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-auto w-full"
      role="img"
      aria-label="시간에 따른 추정 지면반력"
    >
      <line x1={pad.l} y1={y(1)} x2={w - pad.r} y2={y(1)} className="stroke-border" strokeDasharray="4 4" />
      <text x={4} y={y(1) + 4} className="fill-muted-foreground text-[10px]">
        1 BW
      </text>
      <text x={4} y={y(maxG) + 10} className="fill-muted-foreground text-[10px]">
        {maxG.toFixed(1)}
      </text>
      <path d={path} fill="none" className="stroke-amber-400" strokeWidth={2} />
      {landingTimes.map((t) => (
        <line
          key={t}
          x1={x(t)}
          x2={x(t)}
          y1={pad.t}
          y2={h - pad.b}
          className="stroke-rose-400/70"
          strokeWidth={selectedTime !== null && Math.abs(selectedTime - t) < 0.04 ? 2.5 : 1}
        />
      ))}
      <text x={pad.l} y={h - 8} className="fill-muted-foreground text-[10px]">
        {formatSeconds(t0)}
      </text>
      <text x={w - pad.r} y={h - 8} textAnchor="end" className="fill-muted-foreground text-[10px]">
        {formatSeconds(t1)}
      </text>
      {onSelectTime ? (
        <rect
          x={pad.l}
          y={pad.t}
          width={w - pad.l - pad.r}
          height={h - pad.t - pad.b}
          fill="transparent"
          className="cursor-crosshair"
          onClick={(e) => {
            const svg = e.currentTarget.ownerSVGElement;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * w;
            const ratio = (px - pad.l) / (w - pad.l - pad.r);
            onSelectTime(t0 + clamp01(ratio) * (t1 - t0));
          }}
        />
      ) : null}
    </svg>
  );
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}
