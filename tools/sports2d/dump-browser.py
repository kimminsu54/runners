"""Saves the browser's pose frames for one clip, so they can be read offline.

MediaPipe only runs in a browser, so when the two pipelines disagree about a
stance there has been no way to look at why: the pose the browser worked from
never left it. This drives the dev server for one clip and writes what it saw
next to the Sports2D output for the same clip, where foot-signal.ts can compare
the two.

    python tools/sports2d/dump-browser.py 06

Writes out/<id>/browser-frames.json. Requires the dev server, Chrome on 9223,
and a clip registered in clips.csv.
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


def main(argv: list[str]) -> int:
    if not argv:
        print("사용법: python tools/sports2d/dump-browser.py <clips.csv 의 id>")
        return 2
    run_id = argv[0]

    with (HERE / "clips.csv").open(encoding="utf-8-sig", newline="") as handle:
        row = next((r for r in csv.DictReader(handle) if r.get("id") == run_id), None)
    if not row:
        print(f"id {run_id!r} 를 clips.csv 에서 찾지 못했습니다")
        return 1
    clip = (HERE / row["file"]).resolve()
    if not clip.exists():
        print(f"클립 없음: {clip}")
        return 1

    with urllib.request.urlopen(f"{CDP}/json/list") as response:
        target = next(t for t in json.load(response) if t.get("type") == "page")
    ws = websocket.create_connection(
        target["webSocketDebuggerUrl"], timeout=300, suppress_origin=True
    )
    seq = 0

    def send(method: str, **params):
        nonlocal seq
        seq += 1
        ws.send(json.dumps({"id": seq, "method": method, "params": params}))
        while True:
            message = json.loads(ws.recv())
            if message.get("id") == seq:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})

    def js(expression: str):
        result = send(
            "Runtime.evaluate", expression=expression, awaitPromise=True, returnByValue=True
        )
        if result.get("exceptionDetails"):
            raise RuntimeError(result["exceptionDetails"])
        return result["result"].get("value")

    def wait(seconds: float) -> None:
        js(f"new Promise(r => setTimeout(r, {int(seconds * 1000)}))")

    send("Page.enable")
    send("Runtime.enable")
    send("DOM.enable")
    send("Page.navigate", url=APP)
    wait(5)

    root = send("DOM.getDocument")["root"]["nodeId"]
    node = send("DOM.querySelector", nodeId=root, selector="input[accept^='video']")["nodeId"]
    send("DOM.setFileInputFiles", nodeId=node, files=[str(clip)])
    wait(2.5)

    # Real time, matching how Sports2D read the same footage. Whatever the app
    # would have suggested is a separate question from this one.
    js(
        """(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '일반');
  if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
})()"""
    )
    wait(0.5)
    js(
        """(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('세션 분석 시작'));
  b.scrollIntoView({ block: 'center' });
  b.click();
})()"""
    )

    label = lambda: js(
        """(() => {
  const b = [...document.querySelectorAll('button')]
    .find(b => /세션 분석 시작|착지 분석 중|자세 모델 준비/.test(b.textContent));
  return b ? b.textContent.trim() : '';
})()"""
    ) or ""

    started = time.time()
    busy = False
    while time.time() - started < 300:
        text = label()
        if "중…" in text:
            busy = True
        elif busy and "세션 분석 시작" in text:
            break
        wait(2)
    else:
        print("브라우저 분석이 끝나지 않았습니다")
        return 1

    frames = js("window.__strideLabFrames ?? null")
    passes = js("window.__strideLabPasses ?? null")
    if not frames:
        print("포즈 프레임이 비어 있습니다 — 개발 모드인지 확인해 주세요")
        return 1

    out = HERE / "out" / run_id
    out.mkdir(parents=True, exist_ok=True)
    path = out / "browser-frames.json"
    tracked = sum(1 for f in frames if f.get("landmarks"))
    path.write_text(
        json.dumps(
            {
                "clip": clip.name,
                "frames": frames,
                "pass": (passes or {}).get("browser"),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(
        f"[{run_id}] {clip.name} · {len(frames)}프레임 (추적 {tracked}) → "
        f"{path.relative_to(HERE.parent.parent)}"
    )
    ws.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
