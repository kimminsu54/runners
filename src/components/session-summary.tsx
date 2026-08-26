import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShoeRecommendations } from "@/components/shoe-recommendations";
import type { AnalysisResult } from "@/lib/landing-analysis";
import { buildSessionSummary, paceLabel, type PaceBand } from "@/lib/session-summary";
import type { GuidanceLevel } from "@/lib/training-guidance";
import { cn } from "@/lib/utils";
import { ClipboardList } from "lucide-react";

const PACE_SCALE: Array<{ band: PaceBand; duty: string }> = [
  { band: "walk", duty: "0.50+" },
  { band: "easy", duty: "0.40" },
  { band: "steady", duty: "0.33" },
  { band: "brisk", duty: "0.23" },
  { band: "fast", duty: "0.18" },
  { band: "sprint", duty: "<0.18" },
];

const levelLabel: Record<GuidanceLevel, string> = {
  monitor: "관찰",
  attention: "조절 권장",
  high: "우선 점검",
};

const levelClass: Record<GuidanceLevel, string> = {
  monitor: "border-emerald-200 bg-emerald-50 text-emerald-700",
  attention: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-rose-200 bg-rose-50 text-rose-700",
};

const riskTone: Record<string, string> = {
  low: "text-emerald-700",
  moderate: "text-sky-700",
  elevated: "text-amber-800",
  high: "text-orange-700",
  severe: "text-rose-700",
};

export function SessionSummaryCard({
  result,
  onSelectPeak,
}: {
  result: AnalysisResult;
  onSelectPeak?: (index: number) => void;
}) {
  const summary = buildSessionSummary(result);
  const qualityLabel = {
    good: "측정 품질 좋음",
    fair: "측정 오차 큼",
    poor: "페이스 판정 불가",
  }[result.quality.level];
  const qualityClass = {
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    fair: "border-amber-200 bg-amber-50 text-amber-800",
    poor: "border-rose-200 bg-rose-50 text-rose-700",
  }[result.quality.level];

  return (
    <Card className="rounded-2xl border-border bg-white">
      <CardHeader>
        <p className="font-mono text-[9px] tracking-[0.18em] text-primary uppercase">
          03 / Session report
        </p>
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-primary" aria-hidden />
          <CardTitle className="display-type text-2xl text-foreground">영상 전체 요약</CardTitle>
        </div>
        <CardDescription>
          프레임마다 추적한 착지를 모아 평균·반복 패턴·좌우 차이를 한 번에 봅니다.
          한 번의 착지가 아니라 구간 전체의 경향입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={qualityClass}>
            {qualityLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            사람 크기 {Math.round(result.quality.subjectHeightRatio * 100)}% ·
            자세 포착 {Math.round(result.quality.detectedRatio * 100)}%
          </span>
        </div>
        {result.quality.reasons.length ? (
          <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-7 py-3 text-xs leading-5 text-amber-900">
            {result.quality.reasons.map((reason, index) => (
              <li key={`${index}-${reason}`}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="space-y-2">
          <p className="text-lg font-medium leading-7">{summary.headline}</p>
          {summary.paragraphs.map((paragraph, index) => (
            <p
              key={`${index}-${paragraph}`}
              className="text-sm leading-6 text-muted-foreground"
            >
              {paragraph}
            </p>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {summary.metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl border border-border bg-neutral-50 px-3 py-3"
            >
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="text-base font-semibold tabular-nums">{metric.value}</p>
              {metric.hint ? (
                <p className="text-xs text-muted-foreground">{metric.hint}</p>
              ) : null}
            </div>
          ))}
        </div>

        {summary.pace !== "unknown" ? (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">페이스 위치</h3>
              <span className="text-xs text-muted-foreground">
                듀티 팩터가 낮을수록 빠른 페이스이고 충격이 커집니다
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {PACE_SCALE.map((step) => {
                const active = step.band === summary.pace;
                return (
                  <div
                    key={step.band}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-center",
                      active
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    <p className="text-[11px] leading-tight font-medium">
                      {paceLabel[step.band]}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px]">{step.duty}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {summary.strikeCounts.length ? (
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-medium">착지 주법 분포</h3>
              <span className="text-right text-xs text-muted-foreground">
                접지 순간 발가락–뒤꿈치 각도 기준
              </span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-neutral-100">
              {summary.strikeCounts.map((row) => (
                <div
                  key={row.type}
                  style={{ width: `${row.percent}%` }}
                  className={cn(
                    row.type === "rearfoot" && "bg-sky-500",
                    row.type === "midfoot" && "bg-emerald-500",
                    row.type === "forefoot" && "bg-amber-500",
                  )}
                  title={`${row.label} ${row.percent}%`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {summary.strikeCounts.map((row) => (
                <span key={row.type} className="text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "mr-1 inline-block size-2 rounded-full",
                      row.type === "rearfoot" && "bg-sky-500",
                      row.type === "midfoot" && "bg-emerald-500",
                      row.type === "forefoot" && "bg-amber-500",
                    )}
                  />
                  {row.label} {row.count}회 · {row.percent}%
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <ShoeRecommendations summary={summary} />

        {summary.riskCounts.length ? (
          <div className="flex flex-wrap gap-2">
            {summary.riskCounts.map((row) => (
              <span
                key={row.risk}
                className={cn(
                  "rounded-full border border-border bg-neutral-50 px-3 py-1 text-xs tabular-nums",
                  riskTone[row.risk],
                )}
              >
                {row.label} {row.count}회
              </span>
            ))}
            {summary.peakLandingIndex >= 0 && onSelectPeak ? (
              <button
                type="button"
                className="rounded-full border border-primary px-3 py-1 text-xs text-primary hover:bg-accent"
                onClick={() => onSelectPeak(summary.peakLandingIndex)}
              >
                가장 센 착지로 이동
              </button>
            ) : null}
          </div>
        ) : null}

        {summary.patterns.length ? (
          <div className="grid gap-3 md:grid-cols-3">
            {summary.patterns.map((pattern, index) => (
              <div
                key={`${index}-${pattern.area}-${pattern.title}`}
                className="rounded-xl border border-border p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn("border", levelClass[pattern.level])}
                  >
                    {levelLabel[pattern.level]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{pattern.area}</span>
                </div>
                <p className="text-sm font-medium">{pattern.title}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {pattern.evidence}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {summary.training.length ? (
          <ol className="grid gap-3 md:grid-cols-2">
            {summary.training.map((item, index) => (
              <li key={`${index}-${item.title}`} className="flex gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                  {index + 1}
                </span>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 leading-6 text-muted-foreground">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </CardContent>
    </Card>
  );
}
