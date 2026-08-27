import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  compareHint,
  footStrikeLabel,
  formatKneeFlexDeg,
  formatLoadingRateBwS,
  formatSeconds,
  formatStrikeAngleDeg,
  formatTimingMs,
  riskLabel,
  type Landing,
} from "@/lib/landing-analysis";
import { cn } from "@/lib/utils";

const riskClass: Record<Landing["risk"], string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  moderate: "bg-sky-50 text-sky-700 border-sky-200",
  elevated: "bg-amber-50 text-amber-800 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  severe: "bg-rose-50 text-rose-700 border-rose-200",
};

export function LandingCard({
  landing,
  order,
  selected,
  trusted = true,
  onSelect,
}: {
  landing: Landing;
  order: number;
  selected: boolean;
  trusted?: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} className="w-full text-left">
      <Card
        className={cn(
          "bg-white transition ring-foreground/10",
          selected && "ring-2 ring-primary",
        )}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">착지 {order}</p>
            <CardTitle className="text-base">
              {formatSeconds(landing.tContact)} ·{" "}
              {trusted ? `점수 ${landing.damageScore}` : "측정 참고용"}
            </CardTitle>
          </div>
          {trusted ? (
            <Badge variant="outline" className={cn("border", riskClass[landing.risk])}>
              {riskLabel(landing.risk)}
            </Badge>
          ) : (
            <Badge variant="outline">품질 부족</Badge>
          )}
        </CardHeader>
        {/* Rule §UI: a score on screen shows the values that move it. The load
            score is peakGrfBw + loadingRateBwS + kneeFlexContact, so all three
            sit here. Impact velocity was dropped — it reads as an input but
            never enters the score. */}
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Metric
            label="착지 주법"
            value={
              trusted && landing.footStrike !== "unknown"
                ? `${footStrikeLabel[landing.footStrike]} · ${formatStrikeAngleDeg(landing.footStrikeAngleDeg, landing.footStrike)}`
                : "판정 불가"
            }
          />
          <Metric
            label="추정 최대 반력"
            value={trusted ? `${landing.peakGrfBw.toFixed(1)} BW` : "측정 불가"}
          />
          <Metric
            label="부하율"
            value={
              trusted ? formatLoadingRateBwS(landing.loadingRateBwS) : "측정 불가"
            }
          />
          <Metric
            label="접지 순간 무릎"
            value={
              trusted ? formatKneeFlexDeg(landing.kneeFlexContact) : "측정 불가"
            }
          />
          <Metric
            label="접지 시간"
            value={
              trusted && landing.gaitBased
                ? formatTimingMs(landing.contactMs)
                : "측정 불가"
            }
          />
          <Metric
            label="체공 시간"
            value={
              trusted && landing.gaitBased
                ? formatTimingMs(landing.flightMs)
                : "측정 불가"
            }
          />
        </CardContent>
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          {trusted
            ? `${landing.note} ${compareHint(landing.damageScore)}`
            : "착지 후보는 찾았지만 사람 크기·추적 품질이 부족해 충격을 평가하지 않았습니다."}
        </p>
      </Card>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}
