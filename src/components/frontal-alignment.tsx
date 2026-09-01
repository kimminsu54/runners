import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatKneeValgusDeg,
  formatPelvicDropDeg,
  type Landing,
} from "@/lib/landing-analysis";
import { evidence, WITHHELD_LABEL } from "@/lib/thresholds";
import { Scan } from "lucide-react";

/**
 * What a clip filmed from the front can say.
 *
 * The app used to treat this framing as a mistake: it dropped the quality grade
 * and asked for the clip again from the side. But a camera in front of the
 * runner keeps everything that comes from vertical motion and timing — contact,
 * flight, force, cadence — and is the only view that shows the frontal plane at
 * all. What it loses is the sagittal plane: strike pattern, how far ahead the
 * foot landed, and knee flexion, which from here bends along the camera axis
 * and is blanked rather than guessed.
 *
 * Both angles are published and neither is graded. The boundaries that exist
 * for them come from slow single-leg screening rather than from running video,
 * so the thresholds are marked withheld and the verdict never renders.
 */

type Row = {
  label: string;
  pick: (landing: Landing) => number;
  format: (value: number) => string;
  hint: string;
};

const ROWS: Row[] = [
  {
    label: "무릎 정렬",
    pick: (l) => l.kneeValgusDeg,
    format: formatKneeValgusDeg,
    hint: "디딘 다리의 무릎이 발–엉덩이 선에서 얼마나 벗어났는지. 지지 구간의 최대값입니다.",
  },
  {
    label: "골반 기울기",
    pick: (l) => l.pelvicDropDeg,
    format: formatPelvicDropDeg,
    hint: "디딘 발 반대쪽 골반이 얼마나 내려갔는지. 역시 지지 구간의 최대값입니다.",
  },
];

function meanOf(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return Number.NaN;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

export function FrontalAlignment({
  landings,
  trusted,
}: {
  landings: Landing[];
  trusted: boolean;
}) {
  const left = landings.filter((l) => l.side === "left");
  const right = landings.filter((l) => l.side === "right");
  const measured = landings.some(
    (l) => Number.isFinite(l.kneeValgusDeg) || Number.isFinite(l.pelvicDropDeg),
  );

  return (
    <Card className="rounded-2xl border-border bg-white">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Scan className="size-4 text-primary" aria-hidden />
          <CardTitle>정면에서 본 좌우 정렬</CardTitle>
        </div>
        <CardDescription>
          이 영상은 정면·후면으로 읽혔습니다. 접지·체공 시간과 추정 반력, 케이던스는
          그대로 나오고, 옆모습에서만 잴 수 있는 착지 주법·몸 앞 착지·무릎 굽힘은
          내지 않습니다. 대신 옆모습으로는 볼 수 없는 좌우 정렬을 봅니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {trusted && measured ? (
          <>
            <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-2 text-sm">
              <span className="text-xs text-muted-foreground">항목</span>
              <span className="text-right text-xs text-muted-foreground">
                왼발 지지 {left.length}회
              </span>
              <span className="text-right text-xs text-muted-foreground">
                오른발 지지 {right.length}회
              </span>

              {ROWS.map((row) => {
                const a = meanOf(left.map(row.pick));
                const b = meanOf(right.map(row.pick));
                return (
                  <FragmentRow
                    key={row.label}
                    label={row.label}
                    hint={row.hint}
                    left={Number.isFinite(a) ? row.format(a) : "측정 불가"}
                    right={Number.isFinite(b) ? row.format(b) : "측정 불가"}
                  />
                );
              })}
            </div>

            {/* Said the same way the fore-aft distance says it, and for the same
                reason: the number is measured, the grade is not available. */}
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">
                좌우 정렬 · {WITHHELD_LABEL}
              </span>{" "}
              — {evidence("frontal_knee_valgus_notable_deg").source}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              좌우 값의 차이는 같은 영상 안의 비교라 각도의 절대 기준 없이도 볼 수
              있습니다. 한쪽만 크게 다르면 그 다리를 같은 코스에서 다시 찍어
              비교해 보세요.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            정면으로 읽혔지만 골반 폭이 좁게 잡혀 좌우 정렬을 재지 못했습니다.
            허리와 무릎이 함께 보이도록 조금 더 가까이서 찍어 주세요.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FragmentRow({
  label,
  hint,
  left,
  right,
}: {
  label: string;
  hint: string;
  left: string;
  right: string;
}) {
  return (
    <>
      <span className="text-muted-foreground">
        {label}
        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground/80">
          {hint}
        </span>
      </span>
      <span className="text-right font-medium tabular-nums">{left}</span>
      <span className="text-right font-medium tabular-nums">{right}</span>
    </>
  );
}
