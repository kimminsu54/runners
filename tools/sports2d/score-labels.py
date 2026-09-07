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
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent / "out" / "labels"
STRIKES = {"rearfoot", "midfoot", "forefoot"}


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
