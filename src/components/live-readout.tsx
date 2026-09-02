"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatLiveClock,
  type LiveMoment,
} from "@/lib/live-readout";
import type { AnalysisResult } from "@/lib/landing-analysis";
import { cn } from "@/lib/utils";
import { Pause, Play } from "lucide-react";

export function LiveReadout({
  result,
  moment,
  playing,
  canPlay,
  onTogglePlay,
  onSeek,
}: {
  result: AnalysisResult;
  moment: LiveMoment;
  playing: boolean;
  canPlay: boolean;
  onTogglePlay: () => void;
  onSeek: (analysisTime: number) => void;
}) {
  const duration = result.series.at(-1)?.t ?? 0;
  const progress = duration > 0 ? Math.min(1, Math.max(0, moment.t / duration)) : 0;
  const trusted = moment.trusted && result.quality.level !== "poor";

  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <p className="font-mono text-micro tracking-[0.18em] text-primary uppercase">
          02 / Live frame
        </p>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="display-type text-2xl text-foreground">
              지금 이 순간
            </CardTitle>
            <CardDescription>
              영상을 재생하면 접지·체공·무릎이 이 칸에서 따라갑니다. 힘판이 아닌
              2D 추정입니다.
            </CardDescription>
          </div>
          {canPlay ? (
            <Button
              size="sm"
              variant={playing ? "outline" : "default"}
              onClick={onTogglePlay}
            >
              {playing ? <Pause /> : <Play />}
              {playing ? "일시정지" : "재생하며 보기"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "border",
              moment.phase === "stance" &&
                "border-primary/30 bg-accent text-accent-foreground",
              moment.phase === "flight" &&
                "border-sky-200 bg-sky-50 text-sky-800",
              moment.phase === "air" && "border-border bg-neutral-50",
              moment.phase === "unknown" && "border-border text-muted-foreground",
            )}
          >
            {moment.phase === "stance" ? (
              <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-primary" />
            ) : null}
            {moment.phaseLabel}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {formatLiveClock(moment.t)}
          </span>
          {moment.landingOrder ? (
            <span className="text-xs text-muted-foreground">
              착지 {moment.landingOrder}
              {moment.side !== "unknown" ? ` · ${moment.sideLabel}` : ""}
            </span>
          ) : null}
        </div>

        <p className="text-base leading-7 font-medium">{moment.headline}</p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LiveMetric
            label="무릎"
            value={
              Number.isFinite(moment.kneeFlex)
                ? `약 ${Math.round(moment.kneeFlex)}°`
                : "측정 불가"
            }
          />
          <LiveMetric
            label="추정 반력"
            value={
              trusted && Number.isFinite(moment.grfBw)
                ? `${moment.grfBw.toFixed(1)} BW`
                : "측정 불가"
            }
          />
          <LiveMetric
            label="직전 주법"
            value={moment.strikeLabel}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-meta text-muted-foreground">
            <span>세션 타임라인</span>
            <span className="font-mono tabular-nums">
              {formatLiveClock(moment.t)} / {formatLiveClock(duration)}
            </span>
          </div>
          <div className="relative h-10">
            <input
              type="range"
              min={0}
              max={Math.max(0.01, duration)}
              step={0.01}
              value={Math.min(duration, Math.max(0, moment.t))}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="absolute inset-x-0 top-3 z-10 h-4 w-full cursor-pointer appearance-none bg-transparent"
              aria-label="분석 시간 이동"
            />
            <div className="absolute inset-x-0 top-[18px] h-1.5 rounded-full bg-neutral-100" />
            <div
              className="absolute top-[18px] h-1.5 rounded-full bg-primary"
              style={{ width: `${progress * 100}%` }}
            />
            {result.landings.map((landing, index) => {
              const left = duration > 0 ? (landing.tContact / duration) * 100 : 0;
              const active = index === moment.landingIndex;
              return (
                <button
                  key={`${landing.tContact}-${index}`}
                  type="button"
                  title={`착지 ${index + 1}`}
                  onClick={() => onSeek(landing.tContact)}
                  className={cn(
                    "absolute top-2 size-3.5 -translate-x-1/2 rounded-full border bg-white",
                    active
                      ? "z-20 border-primary bg-primary"
                      : "border-border hover:border-primary",
                  )}
                  style={{ left: `${left}%` }}
                />
              );
            })}
          </div>
        </div>

        <ul className="space-y-2">
          {moment.cues.map((cue) => (
            <li
              key={cue.title}
              className={cn(
                "rounded-xl border px-3 py-2.5",
                cue.level === "watch"
                  ? "border-amber-200 bg-amber-50"
                  : "border-border bg-neutral-50",
              )}
            >
              <p className="text-sm font-medium">{cue.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {cue.detail}
              </p>
            </li>
          ))}
        </ul>

        {!result.landings.length ? (
          <p className="text-xs text-muted-foreground">
            착지 후보가 없어 접지·체공은 비어 있습니다. 전신이 나오는 옆모습으로
            다시 찍어 보세요.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LiveMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-neutral-50 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
