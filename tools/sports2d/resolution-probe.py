"""Runs the pass at several input resolutions and compares the reports.

Taking frames from playback rather than seeking is worth 3.3x on a slow device,
but frames then have to be held to read afterwards and 360 of them is a
gigabyte at native size. Shrinking is the only way that fits, and it is the one
thing this analysis cannot spend freely: MediaPipe reads landmarks from a crop
taken at full resolution, so a frame that arrives already reduced blurs the
crop. 3단계 said the app's problem is the foot signal.

So the gate is accuracy. Every size reads the same sought frame, because runs
of one clip differ here by more than the effect looked for.

    python tools/sports2d/resolution-probe.py 06 [sizes]

Sizes are the long edge, comma separated; 0 means the video element as it is.
Requires the dev server and a clip in clips.csv. STRIDELAB_CDP picks the
browser - use the GPU one, the default harness decodes in software.
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
        print("사용법: python tools/sports2d/resolution-probe.py <id> [긴 변들]")
        return 2
    run_id = argv[0]
    sizes = [int(x) for x in (argv[1] if len(argv) > 1 else "0,640,512,384,256").split(",")]

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

    out = js(f"window.__strideLabResolutionProbe?.({json.dumps(sizes)})")
    if not out:
        print("프로브가 없습니다 — 개발 서버인지 확인하세요")
        return 1

    cpu = f" · CPU {throttle:g}x 스로틀" if throttle > 1 else ""
    print(f"[{run_id}] {row.get('label', '')}{cpu}")
    print(
        f"  {'입력':>11}  {'추론':>8}  {'추적':>9}  {'착지':>4}"
        f"  {'접지':>7}  {'힘':>7}  {'케이던스':>8}  판정"
    )
    base = out[0]
    for lane in out:
        name = "원본" if lane["size"] == 0 else f"{lane['size']}"
        contact = lane["contactMs"]
        grf = lane["peakGrfBw"]
        spm = lane["cadenceSpm"]
        fmt = lambda v, unit="": "—" if v is None else f"{v:.0f}{unit}"
        print(
            f"  {name:>5} {lane['input']:>10}"
            f"  {lane['detectMsPerFrame']:6.0f}ms"
            f"  {lane['tracked']:4d}/{lane['frames']:<4d}"
            f"  {lane['landings']:4d}"
            f"  {fmt(contact, 'ms'):>7}"
            f"  {'—' if grf is None else f'{grf:.2f}BW':>7}"
            f"  {fmt(spm):>8}"
            f"  {lane['quality']}"
        )
    # What matters is not the absolute numbers but whether shrinking moves them.
    print()
    print("  원본 대비 차이")
    for lane in out[1:]:
        def delta(key: str) -> str:
            a, b = base.get(key), lane.get(key)
            if a is None or b is None or a == 0:
                return "—"
            return f"{(b - a) / a * 100:+.0f}%"
        print(
            f"  {lane['size']:>5}  착지 {lane['landings'] - base['landings']:+d}"
            f" · 접지 {delta('contactMs')}"
            f" · 힘 {delta('peakGrfBw')}"
            f" · 케이던스 {delta('cadenceSpm')}"
            f" · 추적 {lane['tracked'] - base['tracked']:+d}프레임"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
