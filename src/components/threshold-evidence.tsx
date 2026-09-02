import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatThresholdValue,
  THRESHOLDS,
  validationLabel,
  validationMeaning,
  type ThresholdRecord,
  type ValidationStatus,
} from "@/lib/thresholds";
import { ScrollText } from "lucide-react";

/**
 * Every threshold behind the numbers on this page, with what it rests on.
 *
 * The report already refuses to publish what it cannot measure. This is the
 * other half of the same honesty: for what it does publish, the boundary that
 * decided it, and how far the reason for that boundary goes. A reader who wants
 * to know why 8° is the line between midfoot and forefoot can find out here
 * rather than having to read the source.
 */

const GROUP_LABEL: Record<string, string> = {
  running: "달리기 판정",
  frontal: "정면 촬영 판정",
  camera: "촬영 조건",
  tracking: "추적 품질",
  scoring: "충격 점수",
};

const GROUP_ORDER = ["running", "frontal", "camera", "tracking", "scoring"];

/** Muted for the values this project chose, plain for the ones it did not. */
const STATUS_VARIANT: Record<ValidationStatus, "secondary" | "outline" | "destructive"> = {
  literature: "secondary",
  derived: "secondary",
  convention: "outline",
  internal: "outline",
  withheld: "destructive",
};

function groupOf(record: ThresholdRecord): string {
  return GROUP_ORDER.includes(record.appliesTo) ? record.appliesTo : "running";
}

export function ThresholdEvidence({ className }: { className?: string }) {
  const records = Object.values(THRESHOLDS);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    rows: records.filter((record) => groupOf(record) === group),
  })).filter((entry) => entry.rows.length);

  const statuses = [...new Set(records.map((r) => r.validationStatus))].sort();

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="size-4 text-muted-foreground" aria-hidden />
          판정 근거
        </CardTitle>
        <CardDescription>
          이 화면의 판정을 가른 경계값과, 그 경계가 어디에 기대고 있는지입니다.
          값은 <code className="text-meta">shared/thresholds.yaml</code> 한 곳에서만
          바뀌며, 코드와 어긋나면 테스트가 실패합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {groups.map(({ group, rows }) => (
          <div key={group} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">
              {GROUP_LABEL[group]}
            </h3>
            <ul className="flex flex-col divide-y divide-border">
              {rows.map((record) => (
                <li key={record.key} className="flex flex-col gap-1 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">
                      {record.label}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="font-mono text-sm tabular-nums text-foreground">
                        {formatThresholdValue(record)}
                      </span>
                      <Badge variant={STATUS_VARIANT[record.validationStatus]}>
                        {validationLabel[record.validationStatus]}
                      </Badge>
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {record.source}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="flex flex-col gap-1.5 rounded-xl bg-secondary/60 p-3">
          {statuses.map((status) => (
            <p key={status} className="text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">
                {validationLabel[status]}
              </span>{" "}
              — {validationMeaning[status]}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
