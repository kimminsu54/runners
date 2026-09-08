"""Is MediaPipe's bounding box as good as the detector's, for RTMPose?

The stage 6 plan drops the person detector — yolox, 97 MB of the download — on
the grounds that MediaPipe already localises the runner, so its landmark extent
can serve as the box RTMPose needs. That is the single assumption holding up
the download budget and it had not been measured.

This runs RTMPose twice on the same frames, once with each box, and compares
the keypoints. Both passes are in Python against rtmlib, because the question
is about the box and not about the browser reimplementation.

Reported per keypoint group, because a box that is merely offset moves
everything a little while a box that clips the feet ruins exactly the
keypoints this project depends on.

    python tools/sports2d/rtmpose-box-source.py [clip_id] [frames]
"""

from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from rtmlib import RTMPose, YOLOX

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
CACHE = Path(os.path.expanduser("~/.cache/rtmlib/hub/checkpoints"))
POSE = CACHE / "rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.onnx"
DET = CACHE / "yolox_m_8xb8-300e_humanart-c2c7a14a.onnx"

# HALPE_26 indices. The feet are the point of the exercise; the rest is context.
GROUPS = {
    "발 (발목·엄지·소지·발꿈치)": [15, 16, 20, 21, 22, 23, 24, 25],
    "무릎": [13, 14],
    "엉덩이": [11, 12, 19],
    "상체": [5, 6, 7, 8, 9, 10, 17, 18],
}


def mediapipe_box(landmarks, width: int, height: int) -> list[float]:
    xs = [point["x"] * width for point in landmarks]
    ys = [point["y"] * height for point in landmarks]
    return [min(xs), min(ys), max(xs), max(ys)]


def detector_box(boxes, fallback: list[float]) -> list[float]:
    """The detected person overlapping the MediaPipe box the most.

    Not simply the largest or the first: these clips contain bystanders, and
    picking the wrong person would make the comparison a story about person
    selection rather than about the box.
    """
    best, overlap = fallback, 0.0
    for box in boxes:
        x1 = max(box[0], fallback[0])
        y1 = max(box[1], fallback[1])
        x2 = min(box[2], fallback[2])
        y2 = min(box[3], fallback[3])
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        if area > overlap:
            best, overlap = list(box[:4]), area
    return best


def main() -> int:
    clip_id = sys.argv[1] if len(sys.argv) > 1 else "06"
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    dump = HERE / "out" / clip_id / "browser-frames.json"
    if not dump.exists():
        print(f"{dump} 없음 — dump-browser.py 를 먼저 돌리세요")
        return 1
    payload = json.loads(dump.read_text(encoding="utf-8"))
    frames = payload["frames"]
    clip = HERE / "clips" / payload["clip"]

    pose = RTMPose(str(POSE), model_input_size=(192, 256), backend="onnxruntime", device="cpu")
    det = YOLOX(str(DET), model_input_size=(640, 640), backend="onnxruntime", device="cpu")

    cap = cv2.VideoCapture(str(clip))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    usable = [i for i, f in enumerate(frames) if f.get("landmarks")]
    picks = usable[:: max(1, len(usable) // count)][:count]
    gaps: dict[str, list[float]] = {name: [] for name in GROUPS}
    boxes_differ: list[float] = []
    signed: list[list[float]] = []

    for index in picks:
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, image = cap.read()
        if not ok:
            continue
        mp_box = mediapipe_box(frames[index]["landmarks"], width, height)
        yo_box = detector_box(det(image), mp_box)
        boxes_differ.append(
            float(np.mean([abs(a - b) for a, b in zip(mp_box, yo_box)]))
        )
        # Signed, per side, because a systematic difference is fixable by
        # padding the MediaPipe box and a scattered one is not.
        signed.append([m - y for m, y in zip(mp_box, yo_box)])
        mp_kpts, _ = pose(image, bboxes=[mp_box])
        yo_kpts, _ = pose(image, bboxes=[yo_box])
        for name, ids in GROUPS.items():
            for k in ids:
                gaps[name].append(
                    float(np.hypot(*(mp_kpts[0][k] - yo_kpts[0][k])))
                )
    cap.release()

    if not boxes_differ:
        print("비교할 프레임이 없습니다")
        return 1

    print(f"clip {clip_id} · {len(boxes_differ)}프레임 · {width}x{height}")
    print(f"박스 자체의 차이: 변마다 평균 {np.mean(boxes_differ):.1f}px")
    arr = np.array(signed)
    names = ("좌", "상", "우", "하")
    print("  부호 있는 차이 (MediaPipe − 검출기, 양수면 MediaPipe 박스가 안쪽):")
    for i, name in enumerate(names):
        print(
            f"    {name}  중앙 {np.median(arr[:, i]):+7.1f}px"
            f" · 표준편차 {arr[:, i].std():5.1f}px"
        )
    print()
    print("키포인트 차이 (MediaPipe 박스 대 검출기 박스)")
    for name, values in gaps.items():
        if not values:
            continue
        arr = np.array(values)
        print(
            f"  {name:22} 중앙 {np.median(arr):5.2f}px · 90% {np.percentile(arr, 90):6.2f}px"
            f" · 최대 {arr.max():7.2f}px"
        )
    feet = np.array(gaps["발 (발목·엄지·소지·발꿈치)"])
    # A foot keypoint carries about 1.3px of SimCC quantisation, so a gap at
    # that level is the model's own resolution rather than the box's doing.
    print()
    print(
        "→ 발 키포인트가 SimCC 한 칸(약 1.3px) 수준이면 박스 출처는 무관합니다."
        f" 지금 중앙 {np.median(feet):.2f}px"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
