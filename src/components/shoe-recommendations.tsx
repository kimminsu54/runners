import { Badge } from "@/components/ui/badge";
import type { SessionSummary } from "@/lib/session-summary";
import { recommendShoes } from "@/lib/shoes";
import { Footprints } from "lucide-react";

export function ShoeRecommendations({ summary }: { summary: SessionSummary }) {
  const rec = recommendShoes(summary);

  if (!rec) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-neutral-50 px-4 py-4">
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
        <span className="shrink-0 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          04 / Shoe match
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {rec.picks.map((pick, index) => (
          <article
            key={`${pick.shoe.brand}-${pick.shoe.model}`}
            className="flex flex-col rounded-2xl border border-border bg-neutral-50 p-4"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Badge variant="outline">{pick.shoe.category}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{pick.shoe.brand}</p>
            <p className="text-base font-medium leading-6">{pick.shoe.model}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {pick.shoe.heelDropMm != null
                ? `드롭 ${pick.shoe.heelDropMm}mm`
                : "드롭 미표기"}
              {pick.shoe.weightG != null ? ` · ${pick.shoe.weightG}g` : ""}
            </p>
            <ul className="mt-3 space-y-1.5 text-xs leading-5 text-muted-foreground">
              {pick.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{rec.note}</p>
    </div>
  );
}
