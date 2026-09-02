"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { footStrikeLabel } from "@/lib/landing-analysis";
import {
  comparisonHeadline,
  compareSnapshots,
  parseBundle,
  toBundle,
  type MetricChange,
  type SessionSnapshot,
} from "@/lib/session-snapshot";
import { paceLabel } from "@/lib/session-summary";
import {
  clearSnapshots,
  deleteSnapshot,
  listSnapshots,
  saveSnapshot,
  storageAvailable,
} from "@/lib/session-store";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Download,
  Minus,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Storage support cannot change while the page is open. */
const subscribeNever = () => () => {};

const directionTone: Record<MetricChange["direction"], string> = {
  softer: "text-emerald-700",
  firmer: "text-amber-800",
  flat: "text-muted-foreground",
  descriptive: "text-foreground",
  unavailable: "text-muted-foreground",
};

function DirectionIcon({ change }: { change: MetricChange }) {
  if (change.direction === "flat" || change.direction === "unavailable") {
    return <Minus className="size-3.5" aria-hidden />;
  }
  return change.diff > 0 ? (
    <ArrowUp className="size-3.5" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5" aria-hidden />
  );
}

function strikeLabel(snapshot: SessionSnapshot): string {
  if (snapshot.dominantStrike === "mixed") return "혼합";
  if (snapshot.dominantStrike === "unknown") return "판정 불가";
  return footStrikeLabel[snapshot.dominantStrike];
}

function savedAtLabel(savedAt: number): string {
  // Fixed locale so the two cards never disagree about formatting. Seconds are
  // included because two clips of the same run get the same file name, and
  // minute precision leaves the rows indistinguishable.
  return new Date(savedAt).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function CompareSessions() {
  const [snapshots, setSnapshots] = useState<SessionSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Read through the store hook, not an effect: `indexedDB` is absent during
  // prerender, and doing it in the effect meant reload() set state
  // synchronously before its first await.
  const supported = useSyncExternalStore(
    subscribeNever,
    storageAvailable,
    () => true,
  );

  const reload = useCallback(async () => {
    try {
      const rows = await listSnapshots();
      setSnapshots(rows);
      setError(null);
      // Newest is the run you just made, so it defaults to the "after" side.
      setAfterId((current) => current ?? rows[0]?.id ?? null);
      setBeforeId((current) => current ?? rows[1]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장된 세션을 읽지 못했습니다.");
      setSnapshots([]);
    }
  }, []);

  // The initial load reads its own state so the effect never touches state
  // before awaiting, and drops the result if the page navigated away mid-read.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listSnapshots();
        if (cancelled) return;
        setSnapshots(rows);
        setError(null);
        setAfterId((current) => current ?? rows[0]?.id ?? null);
        setBeforeId((current) => current ?? rows[1]?.id ?? null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "저장된 세션을 읽지 못했습니다.");
        setSnapshots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const exportAll = async () => {
    const rows = await listSnapshots();
    const blob = new Blob([JSON.stringify(toBundle(rows, Date.now()), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stride-lab-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`${rows.length}개 세션을 내보냈습니다.`);
  };

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failed import.
    event.target.value = "";
    if (!file) return;
    const parsed = parseBundle(await file.text());
    if (!parsed.ok) {
      setNotice(parsed.reason);
      return;
    }
    let added = 0;
    for (const session of parsed.sessions) {
      // A re-import of the same file must not duplicate rows, so the id from
      // the file is kept and simply overwrites.
      await saveSnapshot(session);
      added += 1;
    }
    await reload();
    setNotice(`${added}개 세션을 가져왔습니다.`);
  };

  const remove = async (id: string) => {
    await deleteSnapshot(id);
    if (beforeId === id) setBeforeId(null);
    if (afterId === id) setAfterId(null);
    await reload();
  };

  if (!supported) {
    return (
      <p className="text-sm text-muted-foreground">
        이 브라우저에서는 저장된 세션을 읽을 수 없습니다. 시크릿 창이라면 일반 창에서
        다시 열어 주세요.
      </p>
    );
  }

  if (snapshots === null) {
    return <p className="text-sm text-muted-foreground">저장된 세션을 읽는 중입니다…</p>;
  }

  if (error) {
    return <p className="text-sm text-rose-700">{error}</p>;
  }

  // The toolbar renders in both states on purpose: importing a file is most
  // useful precisely when this browser has nothing saved yet.
  const toolbar = (
    <>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={exportAll}
          disabled={!snapshots.length}
        >
          <Download />
          파일로 내보내기
        </Button>
        <label
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border",
            "px-3 py-1.5 text-sm font-medium hover:bg-neutral-50",
          )}
        >
          <Upload className="size-4" />
          파일에서 가져오기
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={importFile}
          />
        </label>
        {snapshots.length ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await clearSnapshots();
              setBeforeId(null);
              setAfterId(null);
              await reload();
            }}
          >
            <Trash2 />
            전체 삭제
          </Button>
        ) : null}
        {notice ? <span className="text-xs text-muted-foreground">{notice}</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        내보낸 파일에는 숫자만 들어 있고 영상은 포함되지 않습니다. 다른 브라우저나 기기로
        세션을 옮길 때 쓰세요.
      </p>
    </>
  );

  if (snapshots.length < 2) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>비교하려면 세션이 두 개 필요합니다</CardTitle>
            <CardDescription>
              지금 저장된 세션은 {snapshots.length}개입니다. 리포트 위쪽의{" "}
              <span className="font-medium">이 세션 저장</span> 을 눌러 두 번 이상 모아
              주세요. 같은 코스에서 한 가지만 바꿔 찍은 두 클립이 가장 잘 비교됩니다.
            </CardDescription>
          </CardHeader>
        </Card>
        {toolbar}
      </div>
    );
  }

  const before = snapshots.find((s) => s.id === beforeId) ?? null;
  const after = snapshots.find((s) => s.id === afterId) ?? null;
  const comparison = before && after ? compareSnapshots(before, after) : null;
  const sameSession = before && after && before.id === after.id;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <SessionPicker
          title="이전"
          snapshots={snapshots}
          selectedId={beforeId}
          onSelect={setBeforeId}
          onDelete={remove}
        />
        <SessionPicker
          title="이후"
          snapshots={snapshots}
          selectedId={afterId}
          onSelect={setAfterId}
          onDelete={remove}
        />
      </div>

      {sameSession ? (
        <p className="text-sm text-muted-foreground">
          같은 세션을 양쪽에 골랐습니다. 서로 다른 두 세션을 선택해 주세요.
        </p>
      ) : comparison?.kind === "blocked" ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base text-amber-900">
              품질이 부족해 비교하지 않습니다
            </CardTitle>
            <CardDescription className="text-amber-900">
              {comparison.reason}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : comparison?.kind === "ready" && before && after ? (
        <Card>
          <CardHeader>
            <CardTitle className="display-type text-2xl">변화</CardTitle>
            <CardDescription>
              {before.label} → {after.label}. 한 프레임(30 ms)보다 작은 차이는 변화로
              보지 않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-lg font-medium leading-7">
              {comparisonHeadline(comparison.changes)}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {comparison.changes.map((change) => (
                <div
                  key={change.metric.key}
                  className="rounded-xl border border-border bg-neutral-50 px-3 py-3"
                >
                  <p className="text-xs text-muted-foreground">{change.metric.label}</p>
                  {change.direction === "unavailable" ? (
                    <p className="text-base font-semibold">비교 불가</p>
                  ) : (
                    <>
                      <p className="flex items-center gap-1.5 text-sm tabular-nums">
                        <span className="text-muted-foreground">
                          {change.metric.format(change.before)}
                        </span>
                        <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
                        <span className="text-base font-semibold">
                          {change.metric.format(change.after)}
                        </span>
                      </p>
                      <p
                        className={cn(
                          "mt-1 flex items-center gap-1 text-xs",
                          directionTone[change.direction],
                        )}
                      >
                        <DirectionIcon change={change} />
                        {change.direction === "flat"
                          ? "변화 없음"
                          : change.metric.format(Math.abs(change.diff))}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              두 클립의 촬영 조건이 다르면 차이의 일부는 촬영에서 옵니다. 같은 각도·같은
              거리에서 찍은 영상끼리 비교해 주세요. 특정 부상 확률이나 진단이 아닙니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">비교할 두 세션을 골라 주세요.</p>
      )}

      {toolbar}
    </div>
  );
}

function SessionPicker({
  title,
  snapshots,
  selectedId,
  onSelect,
  onDelete,
}: {
  title: string;
  snapshots: SessionSnapshot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {snapshots.map((snapshot) => (
          <div
            key={snapshot.id}
            className={cn(
              "flex items-start gap-2 rounded-xl border px-3 py-2",
              snapshot.id === selectedId
                ? "border-primary ring-1 ring-primary"
                : "border-border",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(snapshot.id)}
              className="flex-1 text-left"
            >
              <p className="truncate text-sm font-medium">{snapshot.label}</p>
              <p className="text-xs text-muted-foreground">
                {savedAtLabel(snapshot.savedAt)} · 착지 {snapshot.landingCount}회 ·{" "}
                {paceLabel[snapshot.pace]} · {strikeLabel(snapshot)}
              </p>
              {snapshot.quality === "poor" ? (
                <Badge variant="outline" className="mt-1 border-rose-200 bg-rose-50 text-rose-700">
                  품질 부족
                </Badge>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => onDelete(snapshot.id)}
              aria-label={`${snapshot.label} 삭제`}
              className="mt-0.5 text-muted-foreground hover:text-rose-700"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
