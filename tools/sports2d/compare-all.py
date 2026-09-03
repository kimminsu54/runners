"""Runs both pipelines over every registered clip and writes the comparison.

Stage 2 of docs/sports2d-설계.md: the same clip through the browser's estimator
and through Sports2D's, with the analysis held constant, so the difference is
attributable to pose estimation alone.

MediaPipe only runs in a browser, so the browser half is driven through the
Chrome DevTools Protocol against the dev server rather than reimplemented here.
That is the point: the numbers compared are the ones the product actually
shows, not a second implementation that might agree with neither.

    # once Sports2D has produced runs for the clips:
    python tools/sports2d/run.py --time-range 0 12
    # then, with the dev server up and Chrome listening on 9223:
    python tools/sports2d/compare-all.py

Writes comparison.csv (one row per metric per clip), landings.csv (every
landing from both passes) and prints the summary.
Requires: websocket-client, a dev server, and Chrome started with
--remote-debugging-port=9223.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import websocket  # type: ignore

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
APP = "http://127.0.0.1:43217/"
CDP = "http://127.0.0.1:9223"
OUT_CSV = HERE / "comparison.csv"
LANDINGS_CSV = HERE / "landings.csv"

# The capture-rate control defaults to 8x, which is what phone slow-motion
# records. Every clip here is 30 fps footage of ordinary playback, so both
# pipelines are pinned to real time — Sports2D has no such setting and always
# reads real time, and comparing a pass on an eight-times slower clock to one
# on real time compares nothing. Whatever the app would have *suggested* is
# recorded instead, because a suggestion of 4x is evidence about that clip.
CAPTURE_RATE_LABEL = "일반"


class Page:
    def __init__(self, url: str) -> None:
        with urllib.request.urlopen(f"{CDP}/json/list") as response:
            target = next(t for t in json.load(response) if t.get("type") == "page")
        self.ws = websocket.create_connection(
            target["webSocketDebuggerUrl"], timeout=300, suppress_origin=True
        )
        self.seq = 0
        self.send("Page.enable")
        self.send("Runtime.enable")
        self.send("DOM.enable")
        self.url = url

    def send(self, method: str, **params):
        self.seq += 1
        self.ws.send(json.dumps({"id": self.seq, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.seq:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})

    def js(self, expression: str):
        result = self.send(
            "Runtime.evaluate", expression=expression, awaitPromise=True, returnByValue=True
        )
        if result.get("exceptionDetails"):
            raise RuntimeError(result["exceptionDetails"])
        return result["result"].get("value")

    def wait(self, seconds: float) -> None:
        self.js(f"new Promise(r => setTimeout(r, {int(seconds * 1000)}))")

    def reload(self) -> None:
        self.send("Page.navigate", url=self.url)
        self.wait(5)

    def attach(self, clip: Path) -> None:
        root = self.send("DOM.getDocument")["root"]["nodeId"]
        node = self.send(
            "DOM.querySelector", nodeId=root, selector="input[accept^='video']"
        )["nodeId"]
        self.send("DOM.setFileInputFiles", nodeId=node, files=[str(clip)])
        self.wait(2.5)

    def click_text(self, text: str, exact: bool = False) -> bool:
        return bool(
            self.js(
                """(() => {
  const want = %s;
  const exact = %s;
  const b = [...document.querySelectorAll('button')].find(b => {
    const t = b.textContent.trim();
    return exact ? t === want : t.includes(want);
  });
  if (!b) return false;
  b.scrollIntoView({ block: 'center' });
  b.click();
  return true;
})()"""
                % (json.dumps(text), "true" if exact else "false")
            )
        )

    def analyze_label(self) -> str:
        return (
            self.js(
                """(() => {
  const b = [...document.querySelectorAll('button')]
    .find(b => /세션 분석 시작|착지 분석 중|자세 모델 준비/.test(b.textContent));
  return b ? b.textContent.trim() : '';
})()"""
            )
            or ""
        )

    def analyse(self, timeout: float = 240) -> bool:
        """Click analyse and wait for the button to go back to idle."""
        if not self.click_text("세션 분석 시작"):
            return False
        started = time.time()
        busy = False
        while time.time() - started < timeout:
            label = self.analyze_label()
            if "중…" in label:
                busy = True
            elif busy and "세션 분석 시작" in label:
                return True
            self.wait(2)
        return False

    def table(self) -> list[dict[str, str]]:
        rows = self.js(
            """(() => {
  const heading = [...document.querySelectorAll('*')]
    .find(e => e.textContent.trim() === '두 포즈 추정기, 같은 분석');
  const table = heading?.closest('[data-slot="card"]')?.querySelector('table');
  if (!table) return null;
  return [...table.querySelectorAll('tbody tr')].map(tr => {
    const cells = [...tr.querySelectorAll('td')];
    const label = cells[0]?.querySelector('span');
    return {
      metric: (label ? cells[0].textContent.replace(label.textContent, '') : cells[0]?.textContent || '').trim(),
      note: label ? label.textContent.trim() : '',
      browser: (cells[1]?.textContent || '').trim(),
      sports2d: (cells[2]?.textContent || '').trim(),
      delta: (cells[3]?.textContent || '').trim(),
      agree: !cells[3]?.className.includes('text-destructive'),
    };
  });
})()"""
        )
        return rows or []

    def passes(self) -> dict:
        """Both passes as the page holds them, landing by landing.

        The table above is averages, and averages cannot tell a small
        disagreement about every contact from a total disagreement about a few.
        The page publishes this for exactly that reason.
        """
        return self.js("window.__strideLabPasses ?? null") or {}

    def context(self) -> dict:
        return self.js(
            """(() => {
  const text = document.body.innerText;
  const ps = [...document.querySelectorAll('p')].map(p => p.textContent.trim());
  return {
    incomparable: text.includes('이 비교는 성립하지 않습니다'),
    suggestion: (text.match(/([0-9]+)배 슬로우로 다시 분석/) || [])[1] || '',
    provenance: ps.find(p => p.startsWith('Sports2D')) || '',
  };
})()"""
        )


def rows_for_clip(page: Page, run_id: str, clip: Path) -> tuple[list[dict], dict, dict]:
    page.reload()
    page.attach(clip)
    if not page.click_text(CAPTURE_RATE_LABEL, exact=True):
        raise RuntimeError("촬영 배속 컨트롤을 찾지 못했습니다")
    page.wait(0.5)
    if not page.analyse():
        raise RuntimeError("브라우저 분석이 끝나지 않았습니다")
    if not page.click_text(f"Sports2D {run_id}"):
        raise RuntimeError(f"Sports2D {run_id} 버튼이 없습니다 — run.py 를 먼저 돌리세요")
    page.wait(4)
    return page.table(), page.context(), page.passes()


def main() -> int:
    clips = HERE / "clips.csv"
    with clips.open(encoding="utf-8-sig", newline="") as handle:
        manifest = [row for row in csv.DictReader(handle) if row.get("id")]

    page = Page(APP)
    records: list[dict] = []
    landings: list[dict] = []
    summary: list[dict] = []

    for row in manifest:
        run_id = row["id"]
        clip = (HERE / row["file"]).resolve()
        if not clip.exists():
            print(f"[{run_id}] 클립 없음: {clip}")
            continue
        print(f"[{run_id}] {clip.name} …", flush=True)
        try:
            table, context, both = rows_for_clip(page, run_id, clip)
        except RuntimeError as error:
            print(f"[{run_id}] 실패: {error}")
            summary.append({"id": run_id, "clip": clip.name, "status": str(error)})
            continue

        if not table:
            print(f"[{run_id}] 비교 표가 나오지 않았습니다")
            summary.append({"id": run_id, "clip": clip.name, "status": "비교 표 없음"})
            continue

        for entry in table:
            records.append({"id": run_id, "clip": clip.name, **entry})

        # Every landing from both passes, in one long table. Contact time is
        # the key to line them up later; nothing here pairs them, because
        # pairing is a decision the analysis already makes and duplicating it
        # in a script would let the two drift apart.
        for source in ("browser", "sports2d"):
            pass_data = both.get(source) or {}
            for landing in pass_data.get("landings") or []:
                landings.append(
                    {
                        "id": run_id,
                        "clip": clip.name,
                        "pipeline": source,
                        "camera": pass_data.get("cameraView", ""),
                        "quality": (pass_data.get("quality") or {}).get("level", ""),
                        "t_contact": round(landing.get("tContact", 0), 4),
                        "side": landing.get("side", ""),
                        "strike": landing.get("footStrike", ""),
                        "strike_angle_deg": landing.get("footStrikeAngleDeg"),
                        "peak_grf_bw": landing.get("peakGrfBw"),
                        "contact_ms": landing.get("contactMs"),
                        "flight_ms": landing.get("flightMs"),
                        "foot_ahead_ratio": landing.get("footAheadRatio"),
                        "knee_flex_contact": landing.get("kneeFlexContact"),
                    }
                )
        disagreements = sum(
            1 for entry in table if not entry["agree"] and not entry["note"]
        )
        summary.append(
            {
                "id": run_id,
                "clip": clip.name,
                "status": "성립하지 않음" if context["incomparable"] else "비교됨",
                "disagreements": disagreements,
                "suggested_slowmo": context["suggestion"],
            }
        )
        print(f"[{run_id}] 허용 오차 밖 {disagreements}개"
              f"{' · 성립하지 않음' if context['incomparable'] else ''}"
              f"{' · 배속 제안 ' + context['suggestion'] + '배' if context['suggestion'] else ''}")

    if landings:
        with LANDINGS_CSV.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(landings[0].keys()))
            writer.writeheader()
            writer.writerows(landings)
        print(f"{LANDINGS_CSV.name}: {len(landings)}행")

    if records:
        with OUT_CSV.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["id", "clip", "metric", "note", "browser", "sports2d", "delta", "agree"],
            )
            writer.writeheader()
            writer.writerows(records)
        print(f"\n{OUT_CSV.name}: {len(records)}행")

    print("\n=== 요약 ===")
    for entry in summary:
        print("  " + json.dumps(entry, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
