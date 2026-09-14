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
import os
import sys
import time
import urllib.request
from pathlib import Path

import websocket  # type: ignore

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
APP = "http://127.0.0.1:43217/"
# The default browser for this harness runs with --disable-gpu, which decodes
# video in software. That is not what a user's browser does, and seeking is
# most of the pass, so STRIDELAB_CDP points at a second Chrome with the GPU
# left on when the question is what the pass really costs.
CDP = f"http://127.0.0.1:{os.environ.get('STRIDELAB_CDP', '9223')}"


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
        target["webSocketDebuggerUrl"], timeout=900, suppress_origin=True
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

    # A slower machine, asked for with STRIDELAB_CPU=4. The desktop numbers
    # cannot say whether this is usable on a phone and a phone is not always
    # at hand, so the renderer is slowed instead. Applied after the page and
    # the model have loaded, so the extra wall time is spent on the pass being
    # measured rather than on a load that is not part of it.
    #
    # Read the two halves of the timing separately. The throttle slows seeking
    # as much as inference - in headless Chrome the decode is in the process
    # being throttled - whereas a phone decodes video in hardware and would
    # not. So the throttled total is an upper bound, and holding seeking at
    # its desktop cost gives the lower one.
    throttle = float(os.environ.get("STRIDELAB_CPU", "1"))

    send("Page.navigate", url=APP)
    wait(5)

    root = send("DOM.getDocument")["root"]["nodeId"]
    node = send("DOM.querySelector", nodeId=root, selector="input[accept^='video']")["nodeId"]
    send("DOM.setFileInputFiles", nodeId=node, files=[str(clip)])
    wait(2.5)

    if throttle > 1:
        send("Emulation.setCPUThrottlingRate", rate=throttle)

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
    # Fifteen minutes, not five. Asking the estimator for three bodies rather
    # than one — so the subject can be held across frames — costs a landmark
    # pass each, and a crowded clip ran past the old ceiling with the socket
    # closing mid-analysis and no dump written.
    while time.time() - started < 900:
        text = label()
        if "중…" in text:
            busy = True
        elif busy and "세션 분석 시작" in text:
            break
        wait(2)
    else:
        print("브라우저 분석이 끝나지 않았습니다")
        return 1

    # What the pass cost, measured inside the page. A stopwatch out here also
    # times the page load, the model load and the fixed waits above, and the
    # spread between runs is larger than the thing being measured.
    timing = js("window.__strideLabTiming ?? null")
    frames = js("window.__strideLabFrames ?? null")
    passes = js("window.__strideLabPasses ?? null")
    if not frames:
        print("포즈 프레임이 비어 있습니다 — 개발 모드인지 확인해 주세요")
        return 1

    out = HERE / "out" / run_id
    out.mkdir(parents=True, exist_ok=True)
    path = out / "browser-frames.json"
    tracked = sum(1 for f in frames if f.get("landmarks"))
    if timing and timing.get("frames"):
        n = timing["frames"]
        seek = timing["seekMs"] / n
        detect = timing["detectMs"] / n
        speed = f" · CPU {throttle:g}x 스로틀" if throttle > 1 else ""
        print(
            f"  프레임당 탐색 {seek:.0f}ms · 추론 {detect:.0f}ms"
            f" · 합계 {(seek + detect) * n / 1000:.0f}초 ({n}프레임){speed}"
        )
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
