"""Runs Sports2D over the reference clips and reports what it produced.

This is the offline reference instrument, not part of the app. The app keeps
analysing in the browser; this exists so we can say how far off the browser's
numbers are, which is the thing nothing in the project can do today.

Reads clips.csv, which is also the sample matrix the manual labelling will use,
so the clip list and the label list cannot drift apart.

    python run.py                  # every clip in clips.csv
    python run.py --only 03        # one row by its id
    python run.py --backend onnxruntime --device CPU

Outputs land in out/<id>/ and the pixel TRC is what src/lib/sports2d.ts reads.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sports2d_exe() -> str:
    r"""The console script beside the interpreter running this file.

    Not the bare name: the virtual environment's Scripts directory is not on
    PATH unless somebody activated it, and this is meant to be runnable as
    `tools\sports2d\.venv\Scripts\python.exe tools\sports2d\run.py`.
    """
    name = "sports2d.exe" if os.name == "nt" else "sports2d"
    beside = Path(sys.executable).with_name(name)
    return str(beside) if beside.exists() else "sports2d"

CLIPS = HERE / "clips.csv"
OUT = HERE / "out"

# What the TRC does not say about itself.
#
# A TRC records frames and times starting at zero, so it cannot tell you which
# clip it came from or which part of it. That matters as soon as the app draws
# the skeleton over the video: a run of seconds 5 to 8 would line up against
# seconds 0 to 3 of the footage and look plausible while being wrong, and a run
# of a different clip entirely would look like a tracking failure. So each run
# writes this beside its outputs and the app reads it.
MANIFEST = "stride-lab.json"

# Why these and not the defaults.
#
# Body_with_feet is HALPE_26, the only model here that carries the heel and both
# toes per side. Those keypoints are the reason for the whole exercise: the
# browser has one point at the end of the foot and judges foot strike from it.
#
# performance over balanced because this runs offline against eighteen clips
# and accuracy is the entire point. If it turns out too slow to iterate on,
# balanced is the knob to turn first — and the difference belongs in the
# comparison report, not in a guess.
#
# det_frequency 1 runs person detection every frame. The default of 4 leans on
# tracking between detections, which is a reasonable trade in a product and a
# poor one in the instrument you are measuring the product against.
POSE_MODEL = "Body_with_feet"
MODE = "performance"
DET_FREQUENCY = "1"

# Everything Sports2D produces that we do not read.
#
# Measured on three seconds of one clip: the whole pass took 1799 s, and the
# pixel TRC — the only file this project reads — was written 419 s before the
# run ended. The rest went on an overlay video, a PNG per frame and a graph per
# marker, none of which the comparison uses. Timing the pose estimator on its
# own gives 0.59 s per frame, so the extra outputs cost more than the
# estimation they illustrate.
#
# They are still worth having when a person wants to check that the skeleton is
# on the runner rather than on someone in the background, which is what --full
# is for. Off by default, because eighteen clips is the plan and each one paying
# for a video nobody opens is not.
LEAN = [
    "--save_vid", "false",
    "--save_img", "false",
    "--save_graphs", "false",
    "--show_graphs", "false",
    "--show_realtime_results", "false",
    "--make_c3d", "false",
]


def rows() -> list[dict[str, str]]:
    if not CLIPS.exists():
        sys.exit(f"clips.csv 없음: {CLIPS}\n(tools/sports2d/README.md 참고)")
    with CLIPS.open(encoding="utf-8-sig", newline="") as handle:
        return [row for row in csv.DictReader(handle) if row.get("id")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="clips.csv 의 id 하나만 처리")
    # 'auto' lets Sports2D pick. On Intel-only hardware openvino is usually the
    # quickest of the CPU paths; there is no CUDA to pick, so the choice is
    # between CPU execution providers rather than between CPU and GPU.
    parser.add_argument("--backend", default="auto",
                        choices=["auto", "openvino", "onnxruntime", "opencv"])
    parser.add_argument("--device", default="auto",
                        choices=["auto", "CPU", "CUDA", "MPS", "ROCM"])
    parser.add_argument("--mode", default=MODE,
                        choices=["lightweight", "balanced", "performance"])
    # Whole clips at performance mode on a CPU take minutes. A few seconds is
    # enough to check the plumbing and to time a backend.
    parser.add_argument("--time-range", nargs=2, metavar=("START", "END"),
                        help="초 단위 구간만 처리 (설치 확인·시간 측정용)")
    # A switch rather than a deletion: looking at the overlay is the only way to
    # catch the skeleton tracking the wrong person.
    parser.add_argument("--full", action="store_true",
                        help="오버레이 영상·프레임 이미지·그래프까지 만들기 (느림)")
    args = parser.parse_args()

    selected = [row for row in rows() if not args.only or row["id"] == args.only]
    if not selected:
        sys.exit(f"id {args.only!r} 를 clips.csv 에서 찾지 못했습니다")

    OUT.mkdir(exist_ok=True)
    failures = 0

    for row in selected:
        clip = (HERE / row["file"]).resolve()
        if not clip.exists():
            print(f"[{row['id']}] 파일 없음: {clip}")
            failures += 1
            continue

        target = OUT / row["id"]
        target.mkdir(parents=True, exist_ok=True)
        command = [
            sports2d_exe(),
            "--video_input", str(clip),
            "--first_person_height", row["height_m"],
            "--pose_model", POSE_MODEL,
            "--mode", args.mode,
            "--det_frequency", DET_FREQUENCY,
            "--backend", args.backend,
            "--device", args.device,
            "--result_dir", str(target),
        ]
        if not args.full:
            command += LEAN
        # visible_side changes how the sagittal angles are signed, so it is read
        # from the manifest rather than assumed. 'auto' is Sports2D's own guess.
        if row.get("visible_side"):
            command += ["--visible_side", row["visible_side"]]
        if args.time_range:
            command += ["--time_range", *args.time_range]

        print(f"[{row['id']}] {clip.name} · 신장 {row['height_m']}m · {args.mode}/{args.backend}"
              f"{' · 전체 출력' if args.full else ''}")
        started = time.monotonic()
        result = subprocess.run(command, cwd=target)
        took = time.monotonic() - started

        (target / MANIFEST).write_text(
            json.dumps(
                {
                    "id": row["id"],
                    "clip": clip.name,
                    "start_s": float(args.time_range[0]) if args.time_range else 0.0,
                    "end_s": float(args.time_range[1]) if args.time_range else None,
                    "height_m": float(row["height_m"]),
                    "pose_model": POSE_MODEL,
                    "mode": args.mode,
                    "backend": args.backend,
                    "det_frequency": int(DET_FREQUENCY),
                    "full_outputs": bool(args.full),
                    "seconds": round(took, 1),
                    "exit_code": result.returncode,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        produced = sorted(p.relative_to(target) for p in target.rglob("*") if p.is_file())
        trcs = [p for p in produced if p.suffix == ".trc"]
        print(f"[{row['id']}] 종료 {result.returncode} · {took:.0f}s · 산출 {len(produced)}개"
              f" · TRC {len(trcs)}개")
        for path in trcs:
            print(f"    {path}")
        if result.returncode != 0 or not trcs:
            failures += 1

    print(f"\n{len(selected) - failures}/{len(selected)} 성공")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
