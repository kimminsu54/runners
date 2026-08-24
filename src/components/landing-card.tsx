import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  compareHint,
  formatSeconds,
  riskLabel,
  type Landing,
} from "@/lib/landing-analysis";
import { cn } from "@/lib/utils";

const riskClass: Record<Landing["risk"], string> = {
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  moderate: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  elevated: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  severe: "bg-rose-500/15 text-rose-300 border-rose-500/30",
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
          "bg-card/70 transition ring-foreground/10",
          selected && "ring-2 ring-amber-400/70",
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
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Metric
            label="추정 최대 반력"
            value={trusted ? `${landing.peakGrfBw.toFixed(1)} BW` : "측정 불가"}
          />
          <Metric
            label="접지 시간"
            value={
              landing.gaitBased ? `${Math.round(landing.contactMs)} ms` : "측정 불가"
            }
          />
          <Metric
            label="체공 시간"
            value={
              landing.gaitBased ? `${Math.round(landing.flightMs)} ms` : "측정 불가"
            }
          />
          <Metric label="착지 속도" value={`${landing.impactVelocity.toFixed(1)} m/s`} />
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
