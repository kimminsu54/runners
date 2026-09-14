"""Compares the two candidate denominators for the fore-aft landing distance.

The two tracks disagree about what to divide by: stature here, leg length on
the other side. The number is a pixel ratio either way — `footAheadRatio` is
`footAheadM / statureM`, and `footAheadM` is pixels times `statureM /
staturePx`, so the entered height cancels and what is left is
`pixels / staturePx`. Dividing by leg length would leave `pixels / legPx`.

So the choice is not about units. It is about which denominator this pipeline
can measure, and how steadily. Both are read from the same pose, so both can
be checked against the dumps already on disk.

    python tools/sports2d/overstride-denominator.py

Reads out/<id>/browser-frames.json, which dump-browser.py writes.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import statistics
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent

# MediaPipe pose landmark indices.
NOSE = 0
L_HIP, R_HIP = 23, 24
L_ANKLE, R_ANKLE = 27, 28
L_HEEL, R_HEEL = 29, 30

# shared/thresholds.yaml: the nose sits at about 92% of standing height.
NOSE_HEEL_OF_STATURE = 0.92
VISIBLE = 0.3


def dist(a, b, w: float, h: float) -> float:
    return math.hypot((a["x"] - b["x"]) * w, (a["y"] - b["y"]) * h)


def mid(a, b):
    if not a or not b:
        return None
    if min(a.get("visibility", 1), b.get("visibility", 1)) < VISIBLE:
        return None
    return {"x": (a["x"] + b["x"]) / 2, "y": (a["y"] + b["y"]) / 2}


def spread(values: list[float]) -> tuple[float, float]:
    """Median, and the half-width of the middle 80% as a share of it.

    Standard deviation would be read by the outliers this signal has: a frame
    where a foot is lost puts one length far from the rest. The 10th-to-90th
    band says what the denominator does on a normal frame.
    """
    if len(values) < 5:
        return (math.nan, math.nan)
    values = sorted(values)
    med = statistics.median(values)
    lo = values[int(len(values) * 0.1)]
    hi = values[int(len(values) * 0.9)]
    return (med, (hi - lo) / med if med else math.nan)


def halves(values: list[float]) -> float:
    """How far the first half's median sits from the second half's.

    The denominator is taken once per clip as a median, so per-frame jitter is
    not what it costs — a median absorbs that. What it cannot absorb is drift:
    a runner coming towards the camera grows, and a median then describes
    neither end of the clip. This is the number that reaches the report.
    """
    if len(values) < 10:
        return math.nan
    half = len(values) // 2
    a = statistics.median(values[:half])
    b = statistics.median(values[half:])
    whole = statistics.median(values)
    return abs(a - b) / whole if whole else math.nan


def local_error(values: list[float], window: int = 15) -> float:
    """What one median for the whole clip costs against a local one.

    Both denominators drift, and a drifting denominator divided into a landing
    that happened at one moment is simply the wrong number for that landing.
    This asks how wrong: for every frame, the median of its neighbours against
    the median of the clip, reported as the middle 80% of that disagreement.
    """
    if len(values) < window * 4:
        return math.nan
    whole = statistics.median(values)
    if not whole:
        return math.nan
    errors = [
        abs(statistics.median(values[i - window : i + window]) - whole) / whole
        for i in range(window, len(values) - window)
    ]
    errors.sort()
    return errors[int(len(errors) * 0.9)]


def main() -> int:
    with (HERE / "clips.csv").open(encoding="utf-8-sig", newline="") as handle:
        rows = {r["id"]: r for r in csv.DictReader(handle)}

    print(
        f"{'클립':<4} {'조건':<20}"
        f" {'신장 화면밖':>11} {'반쪽차':>7} {'국소차':>7}"
        f" {'다리 화면밖':>11} {'반쪽차':>7} {'국소차':>7}"
    )
    for run_id, row in rows.items():
        path = HERE / "out" / run_id / "browser-frames.json"
        if not path.exists():
            continue
        size = re.search(r"(\d+)x(\d+)", row.get("note", "") or "")
        if not size:
            print(f"{run_id:<4} 해상도를 note 에서 못 읽었습니다")
            continue
        w, h = float(size.group(1)), float(size.group(2))

        frames = json.loads(path.read_text(encoding="utf-8"))["frames"]
        tracked = [f["landmarks"] for f in frames if f.get("landmarks")]
        statures: list[float] = []
        legs: list[float] = []
        # MediaPipe returns a landmark for a joint that is not in shot, placed
        # where it estimates the joint to be. So "we could compute it" is not
        # the same as "we saw it", and a clip framed on the legs will still
        # hand back a nose. Counting the ones outside the frame separates the
        # two.
        off_nose = 0
        off_leg = 0
        for lm in tracked:
            nose = lm[NOSE]
            if not (0 <= nose["x"] <= 1 and 0 <= nose["y"] <= 1):
                off_nose += 1
            heel = mid(lm[L_HEEL], lm[R_HEEL]) or mid(lm[L_ANKLE], lm[R_ANKLE])
            if heel and nose.get("visibility", 1) >= VISIBLE:
                px = dist(nose, heel, w, h)
                if px > 20:
                    statures.append(px / NOSE_HEEL_OF_STATURE)
            hip = mid(lm[L_HIP], lm[R_HIP])
            ankle = mid(lm[L_ANKLE], lm[R_ANKLE])
            if ankle and not (0 <= ankle["y"] <= 1):
                off_leg += 1
            if hip and ankle:
                px = dist(hip, ankle, w, h)
                if px > 20:
                    legs.append(px)

        n = max(1, len(tracked))
        s_med, s_band = spread(statures)
        l_med, l_band = spread(legs)
        fmt = lambda v: "—" if math.isnan(v) else f"{v * 100:5.1f}%"
        print(
            f"{run_id:<4} {row.get('label', '')[:20]:<20}"
            f" {off_nose / n * 100:10.0f}% {fmt(halves(statures)):>7} {fmt(local_error(statures)):>7}"
            f" {off_leg / n * 100:10.0f}% {fmt(halves(legs)):>7} {fmt(local_error(legs)):>7}"
        )
    print()
    print("화면밖 = 그 관절이 화면 밖에 있던 프레임 비율 (추정으로 채워진 값)")
    print("반쪽차 = 앞 절반의 중앙값과 뒤 절반의 중앙값 차이 ÷ 전체 중앙값.")
    print("         분모는 클립당 중앙값 하나로 쓰이므로 이쪽이 실제로 걸리는 값")
    print("국소차 = 주변 30프레임의 중앙값이 클립 전체 중앙값과 어긋나는 정도(90백분위).")
    print("         착지 하나에 클립 하나짜리 분모를 쓸 때 그 착지가 받는 오차")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
