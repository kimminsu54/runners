"""Writes the reference preprocessing and keypoints for one frame.

The other half of `rtmpose-browser-check.mts`. The stage 6 plan is to run
RTMPose in the browser instead of standing up a server, and the one piece of it
with no code was the affine from bounding box to the model's 192x256 input — a
transform that moves every keypoint when it is slightly wrong and fails
nothing. So this emits what rtmlib itself produces for one frame: the raw
frame, the input tensor, the centre and scale, and the keypoints from a full
pass. The TypeScript side rebuilds all of it and is compared number by number.

    python tools/sports2d/rtmpose-reference.py

Writes into the scratchpad path at the top of the file. Needs the rtmlib model
cache, which `run.py` fills on first use.
"""
import json
import numpy as np
import cv2
from rtmlib.tools.pose_estimation.rtmpose import RTMPose

import sys as _sys

# Which frame, so the clamp path can be exercised on a frame whose box leaves
# the image rather than only on a comfortable one.
FRAME = int(_sys.argv[1]) if len(_sys.argv) > 1 else 100
CLIP = "clips/treadmill-720p.mp4"
OUT = "C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-ai-service/0bb35f78-1216-45b2-bc11-750a98790972/scratchpad/ref_preproc"

cap = cv2.VideoCapture(CLIP)
cap.set(cv2.CAP_PROP_POS_FRAMES, FRAME)
ok, img = cap.read()
cap.release()
assert ok, "frame not read"
h, w = img.shape[:2]

# The box the browser would hand over: the extent of MediaPipe's landmarks for
# this frame, in pixels.
frames = json.load(open("out/06/browser-frames.json", encoding="utf-8"))["frames"]
lms = frames[FRAME]["landmarks"]
assert lms, "no landmarks on this frame"
xs = [p["x"] * w for p in lms]
ys = [p["y"] * h for p in lms]
bbox = [min(xs), min(ys), max(xs), max(ys)]

pose = RTMPose.__new__(RTMPose)
pose.model_input_size = (192, 256)
pose.mean = (123.675, 116.28, 103.53)
pose.std = (58.395, 57.12, 57.375)
tensor, center, scale = RTMPose.preprocess(pose, img, bbox)

img.tofile(f"{OUT}_frame.bin")
np.ascontiguousarray(tensor, dtype=np.float32).tofile(f"{OUT}_tensor.bin")
json.dump(
    {
        "frame": FRAME,
        "width": w,
        "height": h,
        "bbox": bbox,
        "center": [float(center[0]), float(center[1])],
        "scale": [float(scale[0]), float(scale[1])],
        "tensorShape": list(tensor.shape),
    },
    open(f"{OUT}.json", "w", encoding="utf-8"),
    ensure_ascii=False,
    indent=2,
)
print("bbox", [round(v, 1) for v in bbox])
print("center", np.round(center, 2), "scale", np.round(scale, 2))
print("tensor", tensor.shape, tensor.dtype, "range", round(float(tensor.min()), 3), round(float(tensor.max()), 3))

# The same frame and box through rtmlib's own full pass, so the TypeScript
# chain can be compared against it rather than against a different model's TRC.
import os
model = os.path.expanduser(
    "~/.cache/rtmlib/hub/checkpoints/"
    "rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.onnx"
)
full = RTMPose(model, model_input_size=(192, 256), backend="onnxruntime", device="cpu")
kpts, scores = full(img, bboxes=[bbox])
json.dump(
    {
        "keypoints": kpts[0].tolist(),
        "scores": scores[0].tolist(),
    },
    open("C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-ai-service/0bb35f78-1216-45b2-bc11-750a98790972/scratchpad/ref_keypoints.json", "w", encoding="utf-8"),
    indent=2,
)
print("keypoints", kpts[0].shape, "· 발 관련 (15,16,20,21,24,25):")
for i in (15, 16, 20, 21, 24, 25):
    print(f"  {i:2}  ({kpts[0][i][0]:7.2f}, {kpts[0][i][1]:7.2f})  score {scores[0][i]:.3f}")
