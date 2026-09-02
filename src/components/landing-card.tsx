import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  compareHint,
  footStrikeLabel,
  formatFootAhead,
  formatFootAheadRatio,
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
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">착지 {order}</p>
            <CardTitle className="text-base">
              {formatSeconds(landing.tContact)} ·{" "}
              {trusted ? `점수 ${landing.damageScore}` : "측정 참고용"}
            </CardTitle>
            {/* Rule §UI: a score on screen shows the values that move it. The
                load score is peakGrfBw + loadingRateBwS + kneeFlexContact, and
                the rule is why they stay on the collapsed row rather than
                going behind the fold with everything else — a row that showed
                23 and hid what made it 23 would be the thing the rule forbids.
                Impact velocity is not here: it reads as an input but never
                enters the score. */}
            <p className="mt-1 truncate font-mono text-xs tabular-nums text-muted-foreground">
              {trusted
                ? `${landing.peakGrfBw.toFixed(1)} BW · ${formatLoadingRateBwS(landing.loadingRateBwS)} · 무릎 ${formatKneeFlexDeg(landing.kneeFlexContact)}`
                : "촬영 품질이 부족해 평가하지 않았습니다"}
            </p>
          </div>
          {trusted ? (
            <Badge variant="outline" className={cn("border", riskClass[landing.risk])}>
              {riskLabel(landing.risk)}
            </Badge>
          ) : (
            <Badge variant="outline">품질 부족</Badge>
          )}
        </CardHeader>
        {/* Nine of these stacked as full cards was a wall you scrolled past
            rather than read. The rest of the numbers open on the landing you
            picked — which is a click you were already making, since choosing a
            landing seeks the video to it. */}
        {selected ? (
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Metric
            label="착지 주법"
            value={
              trusted && landing.footStrike !== "unknown"
                ? `${footStrikeLabel[landing.footStrike]} · ${formatStrikeAngleDeg(landing.footStrikeAngleDeg, landing.footStrike)}`
                : "판정 불가"
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
          {/* Measured, never graded. Running has no agreed boundary for how far
              ahead is too far, so the card shows the distance and says nothing
              about it — see the withheld status in the 판정 근거 card. */}
          <Metric
            label="몸 앞 착지"
            value={trusted ? formatFootAhead(landing.footAheadM) : "측정 불가"}
            hint={
              trusted && Number.isFinite(landing.footAheadRatio)
                ? formatFootAheadRatio(landing.footAheadRatio)
                : undefined
            }
          />
        </CardContent>
        ) : null}
        {selected ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            {trusted
              ? `${landing.note} ${compareHint(landing.damageScore)}`
              : "착지 후보는 찾았지만 사람 크기·추적 품질이 부족해 충격을 평가하지 않았습니다."}
          </p>
        ) : null}
      </Card>
    </button>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
      {hint ? (
        <p className="text-xs tabular-nums text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
