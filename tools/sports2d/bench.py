"""Times the pose estimator alone, per backend, on one real frame.

Why this exists separately from `run.py`: a full Sports2D pass over three
seconds of this clip took 1799 s, which is 20 s per frame — about 600x real
time, and far outside what RTMPose-m costs on any CPU. A number that wrong is a
misconfiguration, not slow hardware, and the way to find out is to time the two
pieces apart: detection and pose on one frame, without Sports2D's filtering,
plotting, video writing or OpenSim output.

    python bench.py                     # every backend, both models
    python bench.py --frames 5

Prints milliseconds per call. Anything in the tens of ms is normal; seconds per
call means the backend is not doing what it claims.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

BACKENDS = ["onnxruntime", "openvino", "opencv"]
MODES = ["lightweight", "balanced", "performance"]


def a_frame():
    """One real frame, from whichever clip is present."""
    import cv2

    clips = sorted((HERE / "clips").glob("*.*"))
    if not clips:
        sys.exit("clips/ 에 영상이 없습니다")
    capture = cv2.VideoCapture(str(clips[0]))
    # Not the first frame: a clip often opens before the runner is in shot, and
    # detection on an empty frame is not the cost we are measuring.
    capture.set(cv2.CAP_PROP_POS_FRAMES, 30)
    ok, frame = capture.read()
    capture.release()
    if not ok:
        sys.exit(f"프레임을 읽지 못했습니다: {clips[0].name}")
    return clips[0].name, frame


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", type=int, default=3, help="백엔드별 호출 횟수")
    parser.add_argument("--mode", default="balanced", choices=MODES)
    args = parser.parse_args()

    name, frame = a_frame()
    print(f"클립 {name} · 프레임 {frame.shape[1]}x{frame.shape[0]} · mode={args.mode}")

    import onnxruntime

    print(f"onnxruntime {onnxruntime.__version__} · providers {onnxruntime.get_available_providers()}")

    from rtmlib import BodyWithFeet

    for backend in BACKENDS:
        try:
            started = time.monotonic()
            model = BodyWithFeet(mode=args.mode, backend=backend, device="cpu")
            loaded = time.monotonic() - started
        except Exception as error:  # noqa: BLE001 — a backend that cannot load is a result
            print(f"{backend:>12}  로드 실패: {type(error).__name__}: {error}")
            continue

        times = []
        for _ in range(args.frames):
            started = time.monotonic()
            model(frame)
            times.append((time.monotonic() - started) * 1000)
        # The first call includes graph warm-up, so report it separately rather
        # than letting it inflate a mean of three.
        rest = times[1:] or times
        print(
            f"{backend:>12}  로드 {loaded:6.1f}s · 첫 호출 {times[0]:8.0f}ms"
            f" · 이후 중앙값 {statistics.median(rest):8.0f}ms"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
