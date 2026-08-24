import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Landing } from "@/lib/landing-analysis";
import {
  buildLandingGuidance,
  type GuidanceLevel,
} from "@/lib/training-guidance";
import { cn } from "@/lib/utils";
import { AlertTriangle, Dumbbell, Stethoscope } from "lucide-react";

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

export function InjuryGuidance({ landing }: { landing: Landing }) {
  const guidance = buildLandingGuidance(landing);

  return (
    <Card className="rounded-2xl border-border bg-white">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Stethoscope className="size-4 text-primary" aria-hidden />
          <CardTitle>부담 가능 부위와 훈련 제안</CardTitle>
        </div>
        <CardDescription>
          선택한 착지의 하중·흡수 시간·무릎 굽힘을 바탕으로 한 패턴 설명입니다.
          특정 부상 확률이나 진단이 아닙니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="rounded-lg border border-border bg-neutral-50 px-3 py-2 text-sm">
          {guidance.summary}
        </p>

        <section aria-labelledby="load-patterns">
          <h3 id="load-patterns" className="mb-3 text-sm font-medium">
            관찰된 부담 패턴
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {guidance.patterns.map((pattern, index) => (
              <div
                key={`${index}-${pattern.area}-${pattern.title}`}
                className="rounded-xl border border-border bg-neutral-50 p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn("border", levelClass[pattern.level])}
                  >
                    {levelLabel[pattern.level]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {pattern.area}
                  </span>
                </div>
                <p className="font-medium">{pattern.title}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  근거: {pattern.evidence}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {pattern.meaning}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="training-plan">
          <div className="mb-3 flex items-center gap-2">
            <Dumbbell className="size-4 text-primary" aria-hidden />
            <h3 id="training-plan" className="text-sm font-medium">
              다음 훈련에서 해볼 것
            </h3>
          </div>
          <ol className="grid gap-3 md:grid-cols-2">
            {guidance.training.map((item, index) => (
              <li
                key={`${index}-${item.title}`}
                className="flex gap-3 rounded-xl border border-border bg-neutral-50 p-4"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-rose-600"
            aria-hidden
          />
          <p className="leading-6 text-rose-900">
            한쪽에 국소 통증·부종이 있거나, 절뚝거리거나, 휴식 후에도 통증이
            심해진다면 영상 점수와 관계없이 달리기를 중단하고 스포츠의학
            전문가에게 평가받으세요.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
