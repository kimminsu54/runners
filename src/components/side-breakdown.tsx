import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  footStrikeLabel,
  formatFootAheadRatio,
  formatKneeFlexDeg,
  formatLoadingRateBwS,
  formatTimingMs,
} from "@/lib/landing-analysis";
import { evidence, WITHHELD_LABEL } from "@/lib/thresholds";
import type { SessionSummary, SideStats } from "@/lib/session-summary";
import { cn } from "@/lib/utils";
import { Footprints } from "lucide-react";

/**
 * A gap this size is inside what a hand-held camera and a 30 fps clip can
 * produce on their own. Below it the two feet are the same foot twice.
 */
const NOTABLE_GAP_PCT = 10;

type Row = {
  label: string;
  pick: (side: SideStats) => number;
  format: (value: number) => string;
  /** Rows where a left/right gap is worth pointing at. */
  compare: boolean;
};

const ROWS: Row[] = [
  {
    label: "추정 최대 반력",
    pick: (s) => s.meanPeakGrfBw,
    format: (v) => `${v.toFixed(1)} BW`,
    compare: true,
  },
  {
    label: "부하율",
    pick: (s) => s.meanLoadingRateBwS,
    format: formatLoadingRateBwS,
    compare: true,
  },
  {
    label: "접지 순간 무릎",
    pick: (s) => s.meanKneeFlexContact,
    format: formatKneeFlexDeg,
    compare: true,
  },
  {
    label: "접지 시간",
    pick: (s) => s.meanContactMs,
    format: formatTimingMs,
    // Contact time tracks pace, and both feet share one pace — a gap here is
    // the tracker, not the runner. Shown, never flagged.
    compare: false,
  },
  {
    label: "몸 앞 착지",
    pick: (s) => s.meanFootAheadRatio,
    format: formatFootAheadRatio,
    // A left/right gap here is worth seeing: one foot reaching further than the
    // other is the runner, not the camera, in a way contact time is not.
    compare: true,
  },
  {
    label: "평균 점수",
    pick: (s) => s.meanScore,
    format: (v) => String(Math.round(v)),
    compare: true,
  },
];

function gapPct(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  const mid = (a + b) / 2;
  if (mid === 0) return Number.NaN;
  return (Math.abs(a - b) / Math.abs(mid)) * 100;
}

export function SideBreakdown({ summary }: { summary: SessionSummary }) {
  const sides = summary.sides;
  if (!sides) return null;

  const { left, right, unassigned } = sides;

  return (
    <Card className="rounded-2xl border-border bg-white">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Footprints className="size-4 text-primary" aria-hidden />
          <CardTitle>왼발 · 오른발</CardTitle>
        </div>
        <CardDescription>
          같은 구간에서 두 발이 각각 어떻게 받았는지 나눠 본 것입니다. 좌우 차이는
          코스 경사나 촬영 각도에서도 생깁니다. 특정 부상 확률이나 진단이 아닙니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Said once, at session level, rather than on every landing card: the
            distance is published, the verdict is not. A frontal clip never
            measured it, and explaining a judgement that was not withheld but
            simply absent would only confuse. */}
        {Number.isFinite(left.meanFootAheadRatio) ||
        Number.isFinite(right.meanFootAheadRatio) ? (
        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            몸 앞 착지 · {WITHHELD_LABEL}
          </span>{" "}
          — {evidence("overstride_ratio_notable").source}
        </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-2 text-sm">
          <span className="text-xs text-muted-foreground">항목</span>
          <span className="text-right text-xs text-muted-foreground">
            왼발 {left.count}회
          </span>
          <span className="text-right text-xs text-muted-foreground">
            오른발 {right.count}회
          </span>

          {ROWS.map((row) => {
            const a = row.pick(left);
            const b = row.pick(right);
            const gap = row.compare ? gapPct(a, b) : Number.NaN;
            const notable = Number.isFinite(gap) && gap >= NOTABLE_GAP_PCT;
            return (
              <FragmentRow
                key={row.label}
                label={row.label}
                notable={notable}
                gap={gap}
                left={Number.isFinite(a) ? row.format(a) : "측정 불가"}
                right={Number.isFinite(b) ? row.format(b) : "측정 불가"}
              />
            );
          })}

          <span className="text-muted-foreground">주법</span>
          <span className="text-right font-medium">
            {left.dominantStrike === "unknown"
              ? "판정 불가"
              : footStrikeLabel[left.dominantStrike]}
          </span>
          <span className="text-right font-medium">
            {right.dominantStrike === "unknown"
              ? "판정 불가"
              : footStrikeLabel[right.dominantStrike]}
          </span>
        </div>

        {unassigned > 0 ? (
          <p className="text-xs text-muted-foreground">
            좌우를 가리지 못한 착지 {unassigned}회는 이 표에서 빠졌습니다. 두 발이 겹쳐
            보이는 각도에서 생깁니다.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {ROWS.some(
            (row) =>
              row.compare && gapPct(row.pick(left), row.pick(right)) >= NOTABLE_GAP_PCT,
          )
            ? `한쪽으로 ${NOTABLE_GAP_PCT}% 이상 기운 항목이 있습니다. 같은 코스를 반대 방향으로 한 번 더 찍어 보면 경사나 촬영 각도 때문인지 갈립니다.`
            : "두 발의 값이 서로 비슷합니다."}
        </p>
      </CardContent>
    </Card>
  );
}

function FragmentRow({
  label,
  left,
  right,
  notable,
  gap,
}: {
  label: string;
  left: string;
  right: string;
  notable: boolean;
  gap: number;
}) {
  return (
    <>
      <span className={cn("text-muted-foreground", notable && "text-amber-800")}>
        {label}
        {notable ? (
          <span className="ml-1.5 font-mono text-xs">차이 {Math.round(gap)}%</span>
        ) : null}
      </span>
      <span
        className={cn("text-right font-medium tabular-nums", notable && "text-amber-800")}
      >
        {left}
      </span>
      <span
        className={cn("text-right font-medium tabular-nums", notable && "text-amber-800")}
      >
        {right}
      </span>
    </>
  );
}
