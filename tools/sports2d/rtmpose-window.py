"""Runs RTMPose over a whole window using MediaPipe's boxes, for the analysis.

The one-frame checks proved the browser preprocessing reproduces rtmlib. The
box comparison then showed MediaPipe's box is not the detector's — 4.8px median
on foot keypoints, against a 1.3px quantisation floor — which leaves the real
question open, because pixels are not the thing the report is made of. What
matters is whether the analysis comes out the same: the stance durations, the
interval structure, the strike.

So this runs the pose model the way the browser would — MediaPipe's landmark
extent as the box, no detector — over every frame of the window, and writes the
keypoints in the shape the TRC adapter already reads. The TypeScript side then
puts them through `analyzeLandings` and compares against the Sports2D run,
which used the detector.

    python tools/sports2d/rtmpose-window.py 06

Writes out/<id>/rtmpose-window.json next to the browser dump.
"""

from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

import cv2
from rtmlib import RTMPose

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
CACHE = Path(os.path.expanduser("~/.cache/rtmlib/hub/checkpoints"))
POSE = CACHE / "rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.onnx"

# HALPE_26 order, named the way the TRC adapter's marker map expects. The eyes,
# ears, head and hip centre are carried through as markers the analysis does
# not read, so the file stays a faithful record of what the model returned.
HALPE_26 = [
    "nose", "leye", "reye", "lear", "rear",
    "lshoulder", "rshoulder", "lelbow", "relbow", "lwrist", "rwrist",
    "lhip", "rhip", "lknee", "rknee", "lankle", "rankle",
    "head", "neck", "hip",
    "lbigtoe", "rbigtoe", "lsmalltoe", "rsmalltoe", "lheel", "rheel",
]

# Below this the model is guessing and the adapter should see a gap rather than
# a confident wrong point. rtmlib's own scores on these clips run 0.4 to 0.8.
MIN_SCORE = 0.3


def main() -> int:
    clip_id = sys.argv[1] if len(sys.argv) > 1 else "06"
    dump = HERE / "out" / clip_id / "browser-frames.json"
    if not dump.exists():
        print(f"{dump} 없음 — dump-browser.py 를 먼저 돌리세요")
        return 1
    payload = json.loads(dump.read_text(encoding="utf-8"))
    frames = payload["frames"]
    clip = HERE / "clips" / payload["clip"]

    pose = RTMPose(str(POSE), model_input_size=(192, 256), backend="onnxruntime", device="cpu")
    cap = cv2.VideoCapture(str(clip))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    out_frames = []
    tracked = 0
    for index, entry in enumerate(frames):
        landmarks = entry.get("landmarks")
        time = entry.get("t", index / fps)
        if not landmarks:
            out_frames.append({"time": time, "points": [None] * len(HALPE_26)})
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, image = cap.read()
        if not ok:
            out_frames.append({"time": time, "points": [None] * len(HALPE_26)})
            continue
        xs = [point["x"] * width for point in landmarks]
        ys = [point["y"] * height for point in landmarks]
        box = [min(xs), min(ys), max(xs), max(ys)]
        kpts, scores = pose(image, bboxes=[box])
        points = [
            None
            if scores[0][k] < MIN_SCORE
            else {"x": float(kpts[0][k][0]), "y": float(kpts[0][k][1]), "z": 0.0}
            for k in range(len(HALPE_26))
        ]
        out_frames.append({"time": time, "points": points})
        tracked += 1
        if index % 60 == 0:
            print(f"  {index}/{len(frames)}")
    cap.release()

    target = HERE / "out" / clip_id / "rtmpose-window.json"
    target.write_text(
        json.dumps(
            {
                "clip": payload["clip"],
                "rate": fps,
                "units": "px",
                "width": width,
                "height": height,
                "markers": HALPE_26,
                "frames": out_frames,
            }
        ),
        encoding="utf-8",
    )
    print(f"{target.name} · {tracked}/{len(frames)} 프레임 · {width}x{height} · {fps:.2f}fps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
