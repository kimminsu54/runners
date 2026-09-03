"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { footStrikeLabel } from "@/lib/landing-analysis";
import { comparePipelines, type PipelinePass } from "@/lib/pipeline-compare";
import { cn } from "@/lib/utils";

/**
 * A strike and the angle behind it, in the words the rest of the app uses.
 *
 * The angle is missing whenever the estimator could not resolve the foot, and
 * printing `NaN°` there says the code broke rather than that the measurement
 * did not happen — which is the difference between a bug and a finding.
 */
const strikeCell = (strike: string, deg: number) => {
  const label = footStrikeLabel[strike as keyof typeof footStrikeLabel] ?? strike;
  return Number.isFinite(deg) ? `${label} ${deg.toFixed(1)}°` : `${label} · 각도 없음`;
};

const degreeGap = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) ? `${(b - a).toFixed(1)}°` : "—";

/**
 * Two estimators over one clip, side by side.
 *
 * A development instrument, not part of the report. It exists to answer the
 * one question the project could not: how far apart are the browser's numbers
 * and a reference tool's on the same footage, with the analysis held constant.
 *
 * It refuses to imply more than it knows. The comparison is only valid when
 * both passes read the same clip over the same window, so those two facts are
 * checked and stated at the top rather than assumed — a table of differences
 * between two different clips looks exactly like a table of estimator error.
 * And a disagreement says one of them is wrong, never which one; the arbiter
 * is the manual label set, and the footer says so where the eye lands last.
 */
export function PipelineCompare({
  browser,
  sports2d,
}: {
  browser: PipelinePass;
  sports2d: PipelinePass;
}) {
  const { rows, paired, browserOnly, sports2dOnly, comparable, disagreements } =
    comparePipelines(browser, sports2d);

  return (
    <Card>
      <CardHeader>
        <p className="font-mono text-micro tracking-[0.18em] text-muted-foreground uppercase">
          Dev / Estimator comparison
        </p>
        <CardTitle className="mt-0.5">두 포즈 추정기, 같은 분석</CardTitle>
        <CardDescription>
          같은 영상을 브라우저(MediaPipe)와 Sports2D(RTMPose)로 읽고, 같은{" "}
          <code className="font-mono text-meta">analyzeLandings</code> 에 넣은 결과입니다.
          차이는 포즈 추정에서만 옵니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!comparable.ok ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-foreground">이 비교는 성립하지 않습니다</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {comparable.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="mt-1 text-muted-foreground">
              아래 표의 차이는 추정기 차이가 아니라 입력 차이입니다.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {browser.clip} · 앞 {browser.windowS.toFixed(1)}초 · 허용 오차 밖의 차이{" "}
            <span className="font-medium text-foreground">{disagreements}개</span>
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3 font-medium text-muted-foreground">항목</th>
                <th className="py-2 pr-3 font-medium">{browser.label}</th>
                <th className="py-2 pr-3 font-medium">{sports2d.label}</th>
                <th className="py-2 font-medium text-muted-foreground">차이</th>
              </tr>
            </thead>
            <tbody className="font-variant-numeric-tabular">
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-3 text-muted-foreground">
                    {row.label}
                    {row.note ? (
                      <span className="block text-meta text-muted-foreground/80">
                        {row.note}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{row.browser}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.sports2d}</td>
                  <td
                    className={cn(
                      "py-2 tabular-nums",
                      row.note
                        ? "text-muted-foreground"
                        : row.agree
                          ? "text-muted-foreground"
                          : "font-medium text-destructive",
                    )}
                  >
                    {row.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {paired.length ? (
          <div className="flex flex-col gap-1">
            <p className="font-mono text-meta tracking-[0.12em] text-muted-foreground uppercase">
              착지별
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-meta">
                <tbody>
                  {paired.map((pair) => (
                    <tr
                      key={pair.browser.tContact}
                      className={cn(
                        "border-b border-border/40",
                        !pair.sameStrike && "bg-destructive/5",
                      )}
                    >
                      <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                        {pair.browser.tContact.toFixed(2)}s
                      </td>
                      <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                        Δ{Math.round(pair.apart * 1000)}ms
                      </td>
                      <td className="py-1 pr-3">
                        {strikeCell(pair.browser.footStrike, pair.browser.footStrikeAngleDeg)}
                      </td>
                      <td className="py-1 pr-3">
                        {strikeCell(pair.sports2d.footStrike, pair.sports2d.footStrikeAngleDeg)}
                      </td>
                      <td className="py-1 tabular-nums">
                        {degreeGap(
                          pair.browser.footStrikeAngleDeg,
                          pair.sports2d.footStrikeAngleDeg,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {browserOnly.length || sports2dOnly.length ? (
              <p className="text-meta text-muted-foreground">
                한쪽만 잡은 착지 — 브라우저 {browserOnly.length}회 · Sports2D{" "}
                {sports2dOnly.length}회
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            시각이 겹치는 착지가 없어 착지별 비교를 만들지 못했습니다.
          </p>
        )}

        <p className="text-meta leading-5 text-muted-foreground">
          어느 쪽이 맞는지는 이 표로 알 수 없습니다. 둘 다 카메라 한 대의 2D 추정이고,
          차이가 있다는 것은 적어도 한쪽이 그 착지를 틀렸다는 뜻입니다. 판정은 240fps
          영상의 수동 라벨이 합니다.
        </p>
      </CardContent>
    </Card>
  );
}
