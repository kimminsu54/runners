"use client";

import { useAnalysisDetailsOpen } from "@/components/analysis-details";
import { Badge } from "@/components/ui/badge";
import type { SessionSummary } from "@/lib/session-summary";
import {
  recommendShoes,
  shoeImageSrc,
  type ShoePick,
} from "@/lib/shoes";
import { Footprints } from "lucide-react";
import Image from "next/image";

export function ShoeRecommendations({ summary }: { summary: SessionSummary }) {
  const showDetails = useAnalysisDetailsOpen();
  const rec = recommendShoes(summary);

  if (rec.kind === "general") {
    return (
      <div className="rounded-card border border-dashed border-border bg-neutral-50 px-4 py-4">
        <div className="mb-1 flex items-center gap-2">
          <Footprints className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium">러닝화 추천</h3>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          옆모습에서 뒤꿈치와 발가락이 보여 착지 주법이 정해지면, 그 주법에 맞는
          드롭과 롤링의 신발을 고릅니다. 지금은 주법을 아직 쓰지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Footprints className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-medium">러닝화 추천</h3>
          </div>
          <p className="text-sm text-foreground">{rec.headline}</p>
        </div>
        <span className="shrink-0 font-mono text-micro tracking-[0.18em] text-muted-foreground uppercase">
          04 / Shoe match
        </span>
      </div>

      {rec.primary.length ? (
        <ShoePickGrid
          title="나이키 · 아식스 · 아디다스"
          caption="주법에 맞는 우선 브랜드"
          picks={rec.primary}
          startIndex={1}
          showDetails={showDetails}
          featured
        />
      ) : null}

      {rec.others.length ? (
        <div className={rec.primary.length ? "mt-5" : undefined}>
          <ShoePickGrid
            title="다른 브랜드"
            caption="같은 주법의 다음 순위"
            picks={rec.others}
            startIndex={rec.primary.length + 1}
            showDetails={showDetails}
          />
        </div>
      ) : null}

      {showDetails ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {rec.note} 사진은 카탈로그용 생성 컷이며 실제 시즌 컬러와 다를 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}

function ShoePickGrid({
  title,
  caption,
  picks,
  startIndex,
  showDetails,
  featured = false,
}: {
  title: string;
  caption: string;
  picks: ShoePick[];
  startIndex: number;
  showDetails: boolean;
  featured?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-medium">{title}</h4>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {picks.map((pick, index) => {
          const photo = shoeImageSrc(pick.shoe);
          return (
            <article
              key={`${pick.shoe.brand}-${pick.shoe.model}`}
              className={
                featured
                  ? "flex flex-col overflow-hidden rounded-card border border-primary/25 bg-white"
                  : "flex flex-col overflow-hidden rounded-card border border-border bg-white"
              }
            >
              <div className="relative aspect-[4/3] bg-neutral-50">
                {photo ? (
                  <Image
                    src={photo}
                    alt={`${pick.shoe.brand} ${pick.shoe.model}`}
                    fill
                    sizes="(min-width: 768px) 30vw, 90vw"
                    className="object-contain p-3"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <Footprints className="size-8" aria-hidden />
                  </div>
                )}
                <span className="absolute top-3 left-3 font-mono text-micro text-muted-foreground">
                  {String(startIndex + index).padStart(2, "0")}
                </span>
                <Badge variant="outline" className="absolute top-3 right-3 bg-white/90">
                  {pick.shoe.category}
                </Badge>
              </div>
              <div className="flex flex-1 flex-col px-4 pt-3 pb-4">
                <p className="text-xs text-muted-foreground">{pick.shoe.brand}</p>
                <p className="text-base font-medium leading-6">{pick.shoe.model}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {pick.shoe.heelDropMm != null
                    ? `드롭 ${pick.shoe.heelDropMm}mm`
                    : "드롭 미표기"}
                  {pick.shoe.weightG != null ? ` · ${pick.shoe.weightG}g` : ""}
                  {pick.shoe.superTrainer ? " · 슈퍼트레이너" : ""}
                </p>
                {showDetails ? (
                  <ul className="mt-3 space-y-1.5 text-xs leading-5 text-muted-foreground">
                    {pick.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
