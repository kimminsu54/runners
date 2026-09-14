"""Times seeking to frames against playing the clip and catching them.

Reaching frames costs more than reading them — 385 ms of a 646 ms frame on a
device four times slower than this one — because setting `currentTime` makes
the decoder start from a keyframe each time. Playing once and taking frames as
they are presented asks for each frame exactly once.

The catch is that playback runs on a clock: a decoder that cannot keep up drops
frames rather than slowing down, and a dropped frame is a landing never seen.
So this reports what was captured as well as what it cost.

    python tools/sports2d/frame-source-probe.py 06 [frames] [playbackRate]

Requires the dev server, a clip in clips.csv, and Chrome — STRIDELAB_CDP picks
which, and it matters here more than anywhere: the default harness browser runs
with --disable-gpu and decodes in software.
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

import websocket  # type: ignore

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
APP = "http://127.0.0.1:43217/"
CDP = f"http://127.0.0.1:{os.environ.get('STRIDELAB_CDP', '9223')}"


def main(argv: list[str]) -> int:
    if not argv:
        print("사용법: python tools/sports2d/frame-source-probe.py <id> [프레임 수] [배속]")
        return 2
    run_id = argv[0]
    frames = int(argv[1]) if len(argv) > 1 else 120
    rate = float(argv[2]) if len(argv) > 2 else 1.0
    chunk = int(argv[3]) if len(argv) > 3 else 0

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

    send("Page.enable")
    send("Runtime.enable")
    send("DOM.enable")
    send("Page.navigate", url=APP)
    js("new Promise(r => setTimeout(r, 5000))")

    root = send("DOM.getDocument")["root"]["nodeId"]
    node = send("DOM.querySelector", nodeId=root, selector="input[accept^='video']")["nodeId"]
    send("DOM.setFileInputFiles", nodeId=node, files=[str(clip)])
    js("new Promise(r => setTimeout(r, 2500))")

    # The question this probe exists for is not whether playback wins on this
    # machine but whether it still wins on a slow one, where dropping frames
    # is the thing that would make it useless.
    throttle = float(os.environ.get("STRIDELAB_CPU", "1"))
    if throttle > 1:
        send("Emulation.setCPUThrottlingRate", rate=throttle)

    out = js(f"window.__strideLabFrameProbe?.({frames}, {rate}, {chunk})")
    if not out:
        print("프로브가 없습니다 — 개발 서버인지 확인하세요")
        return 1

    seek, play = out["seek"], out["play"]
    cpu = f" · CPU {throttle:g}x 스로틀" if throttle > 1 else ""
    how = " · 연속" if not out.get("chunk") else f" · {out['chunk']}프레임씩 끊어서"
    print(
        f"[{run_id}] {row.get('label', '')} · {out['wanted']}프레임 요청"
        f" · {out['rate']:g}배속{cpu}{how}"
    )
    print(f"  탐색      {seek['perFrame']:6.1f}ms/프레임 · 합계 {seek['ms'] / 1000:5.1f}초")
    print(
        f"  순차 재생  {play['perFrame']:6.1f}ms/프레임 · 합계 {play['ms'] / 1000:5.1f}초"
        f" · 실제로 받은 프레임 {play['captured']}/{out['wanted']}"
    )
    if play["captured"] < out["wanted"]:
        missing = out["wanted"] - play["captured"]
        print(f"  ⚠ {missing}프레임이 오지 않았습니다 — 디코더가 배속을 못 따라갔습니다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
