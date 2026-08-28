"use client";

import { Button } from "@/components/ui/button";
import type { AnalysisResult } from "@/lib/landing-analysis";
import { buildSnapshot } from "@/lib/session-snapshot";
import type { SessionSummary } from "@/lib/session-summary";
import {
  newSessionId,
  saveSnapshot,
  storageAvailable,
} from "@/lib/session-store";
import { Check, Save } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

/** Storage support cannot change while the page is open. */
const subscribeNever = () => () => {};

export function SaveSessionButton({
  result,
  summary,
  label,
}: {
  result: AnalysisResult;
  summary: SessionSummary;
  label: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  // `indexedDB` does not exist while the page is prerendered on the server, so
  // this is read through the store hook rather than an effect. The server
  // snapshot assumes support so the button does not flash a fallback first.
  const supported = useSyncExternalStore(
    subscribeNever,
    storageAvailable,
    () => true,
  );

  // A new clip is a new session, so it gets its own save. This is the "adjust
  // state when a prop changes" pattern: doing it in an effect would render the
  // stale "저장됨" once before correcting itself.
  const [seenResult, setSeenResult] = useState(result);
  if (seenResult !== result) {
    setSeenResult(result);
    setState("idle");
    setMessage(null);
  }

  if (!supported) {
    return (
      <p className="text-xs text-muted-foreground">
        이 브라우저에서는 세션을 저장할 수 없습니다. 시크릿 창이라면 일반 창에서 다시 열어 주세요.
      </p>
    );
  }

  const save = async () => {
    setState("saving");
    try {
      await saveSnapshot(
        buildSnapshot({
          id: newSessionId(),
          savedAt: Date.now(),
          label,
          result,
          summary,
        }),
      );
      setState("saved");
      setMessage(null);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={save}
        disabled={state === "saving" || state === "saved"}
      >
        {state === "saved" ? <Check /> : <Save />}
        {state === "saved"
          ? "저장됨"
          : state === "saving"
            ? "저장 중…"
            : "이 세션 저장"}
      </Button>
      {state === "saved" ? (
        <Link
          href="/compare"
          className="text-xs text-primary underline underline-offset-4"
        >
          다른 세션과 비교하기
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">
          영상은 저장하지 않습니다. 이 브라우저에만 숫자가 남습니다.
        </span>
      )}
      {message ? <span className="text-xs text-rose-700">{message}</span> : null}
    </div>
  );
}
