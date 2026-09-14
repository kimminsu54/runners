"""Runs the pass on each MediaPipe pose model and compares the reports.

The app ships `lite`, which the Sports2D design note calls the least accurate
of the three. The defect that 3단계 ended on is a foot signal — the treadmill
clip splits one contact in two — and the answer reached for was a different
estimator entirely, at 56 MB and minutes of phone time. The two larger
MediaPipe models were never tried, and trying them costs a file swap.

Every model reads the same sought frame, because runs of one clip differ here
by more than the thing being compared.

    python tools/sports2d/model-probe.py 06 [lite,full,heavy]

Needs pose_landmarker_full.task and pose_landmarker_heavy.task in
public/models. Requires the dev server and a clip in clips.csv; STRIDELAB_CDP
picks the browser.
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
        print("사용법: python tools/sports2d/model-probe.py <id> [모델들]")
        return 2
    run_id = argv[0]
    models = (argv[1] if len(argv) > 1 else "lite,full,heavy").split(",")

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

    out = js(f"window.__strideLabModelProbe?.({json.dumps(models)})")
    if not out:
        print("프로브가 없습니다 — 개발 서버인지, 모델 파일이 있는지 확인하세요")
        return 1

    cpu = f" · CPU {throttle:g}x 스로틀" if throttle > 1 else ""
    print(f"[{run_id}] {row.get('label', '')}{cpu}")
    print(f"  {'모델':>6} {'추론':>9} {'추적':>10} {'착지':>5} {'접지':>8} {'힘':>8} {'케이던스':>9}  판정")
    base = out[0]
    for lane in out:
        fmt = lambda v, u = "": "—" if v is None else f"{v:.0f}{u}"
        grf = lane["peakGrfBw"]
        print(
            f"  {lane['model']:>6} {lane['detectMsPerFrame']:7.0f}ms"
            f"  {lane['tracked']:4d}/{lane['frames']:<4d}"
            f"  {lane['landings']:4d}"
            f"  {fmt(lane['contactMs'], 'ms'):>8}"
            f"  {('—' if grf is None else f'{grf:.2f}BW'):>8}"
            f"  {fmt(lane['cadenceSpm']):>9}  {lane['quality']}"
        )
    if len(out) > 1:
        print()
        print(f"  {base['model']} 대비")
        for lane in out[1:]:
            def d(key: str) -> str:
                a, b = base.get(key), lane.get(key)
                if a is None or b is None or not a:
                    return "—"
                return f"{(b - a) / a * 100:+.0f}%"
            print(
                f"  {lane['model']:>6}  착지 {lane['landings'] - base['landings']:+d}"
                f" · 접지 {d('contactMs')} · 힘 {d('peakGrfBw')}"
                f" · 케이던스 {d('cadenceSpm')} · 추론 {d('detectMsPerFrame')}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
