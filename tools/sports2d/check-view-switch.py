"""Drives the page to check that a Sports2D run can be left again.

Opening a run used to be one-way: it replaced the report and revoked the
uploaded clip's object URL, so there was no route back to the video the person
had just analysed. This walks the round trip in a real browser — load a clip,
analyse it, open a run, switch back — and asserts at each step, because the bug
was invisible to types and to the selftest.

Two things it learned to measure properly. The pressed button is read from the
two the switch owns: taking the first `aria-pressed` button on the page picks
up the face-cover toggle, which is also pressed and says nothing about which
pass is showing. And the round trip is judged on the opening of the report
rather than a landing count or the whole text: the count is not on screen in a
form worth matching, and once both passes exist the comparison card renders
underneath, so the restored view is legitimately longer than the first pass
was.

Needs the dev server and Chrome on 9223, the same as dump-browser.py.

    python tools/sports2d/check-view-switch.py [clip_id]
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

STATE_JS = """
(() => {
  const tabs = [...document.querySelectorAll('button[aria-pressed]')]
    .filter((b) => ['업로드 영상', 'Sports2D'].includes(b.textContent.trim()));
  const on = tabs.find((b) => b.getAttribute('aria-pressed') === 'true');
  const text = document.body.innerText;
  return {
    video: !!document.querySelector('video[src]'),
    toggle: tabs.length,
    pressed: on ? on.textContent.trim() : null,
    report: text.length,
    digest: text.replace(/\\s+/g, ' ').slice(0, 4000),
  };
})()
"""

BUSY_JS = """
(() => {
  const b = [...document.querySelectorAll('button')]
    .find((b) => /세션 분석 시작|착지 분석 중|자세 모델 준비/.test(b.textContent));
  return b ? b.textContent.trim() : '';
})()
"""

DURATION_JS = """
(() => {
  const v = document.querySelector('video');
  return v && isFinite(v.duration) ? Math.round(v.duration) : 0;
})()
"""


def main(argv: list[str]) -> int:
    clip_id = argv[0] if argv else "06"
    with (HERE / "clips.csv").open(encoding="utf-8-sig", newline="") as handle:
        row = next((r for r in csv.DictReader(handle) if r.get("id") == clip_id), None)
    if not row:
        print(f"id {clip_id!r} 를 clips.csv 에서 찾지 못했습니다")
        return 1
    clip = (HERE / row["file"]).resolve()

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
            "Runtime.evaluate",
            expression=expression,
            awaitPromise=True,
            returnByValue=True,
        )
        return result.get("result", {}).get("value")

    def wait(seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end:
            send("Runtime.evaluate", expression="1")
            time.sleep(0.2)

    def click(text: str) -> bool:
        expression = (
            "(() => { const b = [...document.querySelectorAll('button,label')]"
            f".find((e) => e.textContent.trim().startsWith({json.dumps(text)}));"
            " if (!b) return false; b.scrollIntoView({block:'center'}); b.click();"
            " return true; })()"
        )
        return bool(js(expression))

    failures: list[str] = []

    send("Page.navigate", url=APP)
    wait(6)

    doc = send("DOM.getDocument", depth=-1)
    node = send(
        "DOM.querySelector", nodeId=doc["root"]["nodeId"], selector="input[type=file]"
    )
    send("DOM.setFileInputFiles", files=[str(clip)], nodeId=node["nodeId"])

    # Wait for the metadata, not a fixed pause. Analysing before the duration
    # is known covers a second and a half of a twelve second clip.
    deadline = time.time() + 30
    duration = 0
    while time.time() < deadline:
        duration = js(DURATION_JS) or 0
        if duration:
            break
        wait(1)

    before = js(STATE_JS)
    print(f"1. 클립 로드      video={before['video']} · 길이 {duration}초"
          f" · 전환 버튼 {before['toggle']}개")
    if not before["video"]:
        failures.append("클립을 올렸는데 video 요소가 없습니다")
    if not duration:
        failures.append("영상 메타데이터가 오지 않았습니다")
    if before["toggle"]:
        failures.append("판이 하나뿐인데 전환 버튼이 보입니다")

    if not click("세션 분석 시작"):
        print("분석 버튼을 찾지 못했습니다")
        return 1
    # Wait for it to start before waiting for it to end; breaking on "not
    # busy" alone returns immediately and calls an unstarted run finished.
    started = time.time()
    busy = False
    while time.time() - started < 900:
        label = js(BUSY_JS) or ""
        if "중…" in label:
            busy = True
        elif busy:
            break
        wait(2)
    analysed = js(STATE_JS)
    print(f"2. 브라우저 분석  video={analysed['video']} · 리포트 {analysed['report']}자")
    if analysed["report"] < 500:
        failures.append("분석 후에도 리포트가 비어 있습니다")

    if not click(f"Sports2D {clip_id}"):
        print(f"Sports2D {clip_id} 버튼을 찾지 못했습니다")
        return 1
    wait(5)
    imported = js(STATE_JS)
    print(
        f"3. Sports2D 열기  video={imported['video']}"
        f" · 전환 버튼 {imported['toggle']}개 · 눌린 것 {imported['pressed']}"
        f" · 리포트 {imported['report']}자"
    )
    if imported["toggle"] < 2:
        failures.append("두 판이 있는데 전환 버튼이 없습니다 — 돌아갈 방법이 없습니다")
    if imported["pressed"] != "Sports2D":
        failures.append(f"Sports2D 를 열었는데 눌린 것이 {imported['pressed']} 입니다")
    if imported["digest"] == analysed["digest"]:
        failures.append("Sports2D 를 열었는데 리포트가 그대로입니다")

    if not click("업로드 영상"):
        failures.append("'업로드 영상' 버튼을 찾지 못했습니다")
    else:
        wait(2)
        back = js(STATE_JS)
        print(
            f"4. 되돌아가기    video={back['video']}"
            f" · 눌린 것 {back['pressed']} · 리포트 {back['report']}자"
        )
        if not back["video"]:
            failures.append("돌아왔는데 업로드한 영상이 사라졌습니다")
        # Compared on the opening of the report, not the whole of it. Once
        # both passes exist the comparison card renders underneath, so the
        # restored view is legitimately longer than the first pass was — 2629
        # characters against 1505 — and demanding equality called that a
        # regression.
        head = analysed["digest"][:300]
        if head and head not in back["digest"]:
            failures.append("돌아온 리포트의 앞부분이 분석 직후와 다릅니다")
        if back["digest"] == imported["digest"]:
            failures.append("돌아왔는데 Sports2D 리포트가 그대로입니다")
        if back["pressed"] != "업로드 영상":
            failures.append("어느 판을 보고 있는지 버튼이 말해 주지 않습니다")

    print()
    if failures:
        for line in failures:
            print(f"  실패: {line}")
        return 1
    print("  왕복 확인됨 — 업로드 분석 ↔ Sports2D 를 오갈 수 있습니다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
