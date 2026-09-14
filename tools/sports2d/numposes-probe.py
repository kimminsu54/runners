"""Times `numPoses` 1 against 3 on the same frames, in the browser.

Comparing whole runs could not answer what asking for three bodies costs: four
runs of the crowded clip, ordered 1-3-3-1 so a steady drift would cancel, put
three bodies faster than one, and seeking — which cannot depend on the setting
— showed a difference of its own the same size. This machine moves between
runs by more than the setting does.

So the two settings are compared inside one page, on the same frame, by
`window.__strideLabPoseProbe`. This drives it.

    python tools/sports2d/numposes-probe.py 04 [frames]

Requires the dev server, Chrome on 9223, and a clip registered in clips.csv.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

import websocket  # type: ignore

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
APP = "http://127.0.0.1:43217/"
CDP = "http://127.0.0.1:9223"


def main(argv: list[str]) -> int:
    if not argv:
        print("사용법: python tools/sports2d/numposes-probe.py <id> [프레임 수]")
        return 2
    run_id = argv[0]
    frames = int(argv[1]) if len(argv) > 1 else 40

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

    out = js(f"window.__strideLabPoseProbe?.({frames})")
    if not out:
        print("프로브가 없습니다 — 개발 서버인지 확인하세요")
        return 1

    one, three, diff = out["one"], out["three"], out["diff"]
    n = out["frames"]
    print(f"[{run_id}] {row.get('label', '')}")
    print(f"  같은 프레임 {n}장 · 3으로 요청할 때 실제로 찾은 몸 평균 {out['bodiesFound']:.2f}개")
    print(f"  numPoses 1   중앙 {one['median']:.1f}ms · 평균 {one['mean']:.1f}ms")
    print(f"  numPoses 3   중앙 {three['median']:.1f}ms · 평균 {three['mean']:.1f}ms")
    print(
        f"  프레임 내 차이 중앙 {diff['median']:+.1f}ms · 평균 {diff['mean']:+.1f}ms"
        f" · 3이 더 느린 프레임 {diff['threeSlowerFrames']}/{n}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
