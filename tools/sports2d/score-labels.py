"""Turns a filled adjudication sheet into a number.

Joins labels.csv, which a person filled in blind, with key.csv, which held what
was hidden from them, and reports which pipeline the person sided with on each
disagreement.

    python tools/sports2d/score-labels.py

What this measures is agreement between a person and each pipeline on the
contacts where the two pipelines differ, not accuracy. The person read the same
30 fps frames the algorithms read; five frames spanning touchdown gives them
more to go on than the single frame the angle is taken from, which is why the
answer is worth anything at all, but it is not ground truth and the result
belongs in the threshold file as `internal` if it goes there.

It is also a sample of the hard cases only. Contacts the two pipelines agreed
on are not in the sheet, so a score here says who is right more often when they
part ways — not how often either is right.
"""

from __future__ import annotations

import csv
import io
import sys
from collections import Counter
from math import comb
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent / "out" / "labels"
STRIKES = {"rearfoot", "midfoot", "forefoot"}

# Width of the midfoot category, the same +-8 the app classifies with. It is
# the yardstick for how large a disagreement is: a gap wider than the whole
# middle category is not a borderline call about where a line sits.
MIDFOOT_BAND_DEG = 16.0


def main() -> int:
    labels_path = HERE / "labels.csv"
    key_path = HERE / "key.csv"
    for path in (labels_path, key_path):
        if not path.exists():
            sys.exit(f"{path.name} 없음 — label-sheet.py 를 먼저 돌리세요")

    with labels_path.open(encoding="utf-8-sig", newline="") as handle:
        labels = {row["id"]: row for row in csv.DictReader(handle)}
    with key_path.open(encoding="utf-8-sig", newline="") as handle:
        key = {row["id"]: row for row in csv.DictReader(handle)}

    judged = 0
    unsure = 0
    blank = 0
    winner: Counter[str] = Counter()
    neither: list[str] = []
    per_clip: dict[str, Counter[str]] = {}

    for item_id, row in sorted(key.items()):
        verdict = (labels.get(item_id, {}).get("verdict") or "").strip().lower()
        if not verdict:
            blank += 1
            continue
        if verdict not in STRIKES:
            # `unsure` is an answer, and a frequent one would say the sheet is
            # asking more than 30 fps can settle.
            unsure += 1
            continue
        judged += 1
        clip = row["clip_id"]
        counts = per_clip.setdefault(clip, Counter())
        matched = False
        for pipeline in ("browser", "sports2d"):
            if row[pipeline].strip().lower() == verdict:
                winner[pipeline] += 1
                counts[pipeline] += 1
                matched = True
        if not matched:
            # The person picked a third answer, which means both were wrong
            # rather than one of them right.
            winner["neither"] += 1
            counts["neither"] += 1
            neither.append(f"{item_id} ({clip} {row['t_contact']}s): 사람 {verdict} · "
                           f"브라우저 {row['browser']} · Sports2D {row['sports2d']}")

    total = len(key)
    print(f"불일치 {total}개 · 판정됨 {judged} · unsure {unsure} · 미기입 {blank}")
    if not judged:
        print("\nlabels.csv 의 verdict 열이 아직 비어 있습니다")
        return 0

    print()
    for pipeline in ("browser", "sports2d", "neither"):
        count = winner[pipeline]
        share = count / judged * 100
        name = {"browser": "브라우저", "sports2d": "Sports2D", "neither": "둘 다 틀림"}[pipeline]
        print(f"  {name.ljust(10)} {count:>3}/{judged} ({share:.0f}%)")

    if len(per_clip) > 1:
        print("\n클립별")
        for clip, counts in sorted(per_clip.items()):
            n = sum(counts.values())
            print(
                f"  {clip}  브라우저 {counts['browser']} · Sports2D {counts['sports2d']}"
                f" · 둘 다 틀림 {counts['neither']}  (총 {n})"
            )

    if neither:
        print("\n둘 다 틀린 착지")
        for line in neither[:8]:
            print(f"  {line}")

    # Whether the split means anything at all.
    #
    # Reporting a share and stopping invites reading the larger number as the
    # better pipeline, and on a sample this size it usually is not. Each
    # contact is one coin flip between the two, so the question is whether the
    # count sits further from even than chance would put it.
    contested = winner["browser"] + winner["sports2d"]
    if contested:
        lead = max(winner["browser"], winner["sports2d"])
        tail = sum(comb(contested, k) for k in range(contested - lead + 1))
        p_value = min(1.0, tail * 2 / 2 ** contested)
        print(f"\n앞선 정도 {lead}/{contested} · 양측 이항검정 p={p_value:.2f}")
        if p_value > 0.05:
            print("  우연히 갈릴 수 있는 차이입니다. 이 표본으로는 어느 쪽이 더 정확한지"
                  " 말할 수 없습니다.")
        else:
            print("  우연으로 보기 어려운 차이입니다.")

    # How far apart the two were, not just which side the person took.
    #
    # A one-category disagreement near a boundary and a thirty-degree
    # disagreement are the same row in the count above and completely
    # different findings. If the gap routinely exceeds the width of the middle
    # category then the two are not arguing about where a line falls, they are
    # measuring different things.
    gaps = sorted(
        abs(float(row["browser_deg"]) - float(row["sports2d_deg"]))
        for item_id, row in key.items()
        if (labels.get(item_id, {}).get("verdict") or "").strip().lower() in STRIKES
    )
    if gaps:
        over = sum(1 for gap in gaps if gap > MIDFOOT_BAND_DEG)
        print(f"\n같은 착지에 대한 두 파이프라인의 각도 차이: 최소 {gaps[0]:.0f}°"
              f" · 중앙값 {gaps[len(gaps) // 2]:.0f}° · 최대 {gaps[-1]:.0f}°")
        print(f"  미드풋 구간 폭({MIDFOOT_BAND_DEG:.0f}°)보다 큰 경우 {over}/{len(gaps)}")

    # The count treats every row as an independent case. It is worth printing
    # what the rows actually are, because a sheet that is one runner's same
    # foot seven times over is one case with seven votes.
    print("\n표본 구성")
    for clip in sorted(per_clip):
        ids = [i for i in key if key[i]["clip_id"] == clip]
        sides = Counter(key[i]["side"] for i in ids)
        said = Counter(
            (labels.get(i, {}).get("verdict") or "").strip().lower() for i in ids
        )
        side_text = " · ".join(f"{name} {n}" for name, n in sorted(sides.items()))
        said_text = " · ".join(f"{name} {n}" for name, n in sorted(said.items()) if name)
        print(f"  clip {clip}: {len(ids)}개 ({side_text})  사람 판정: {said_text}")

    # A sheet answered mostly `unsure` is not a weak result, it is a statement
    # about the footage — and saying so beats reporting a score from the few
    # that happened to be legible.
    if unsure and unsure >= judged:
        print(
            f"\nunsure 가 판정된 수({judged})만큼 있습니다. 30fps 프레임으로는"
            " 가릴 수 없는 착지가 절반 이상이라는 뜻이고, 이 표본으로 승패를"
            " 말하기는 어렵습니다."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
