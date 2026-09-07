"""Builds a blind adjudication sheet for the contacts the two pipelines disagree on.

Stage 3 of docs/sports2d-설계.md asked for manual labels from 240 fps footage.
These clips are 30 fps, so a label read off them is not ground truth — the
person sees the frames the algorithm saw, and what comes out is agreement
rather than accuracy. What 30 fps can support is narrower and still useful:
where the two pipelines disagree about a foot strike, a person can say which
of them looks right, and that says which one is wrong more often when they
part ways.

Two things make that answer worth having rather than circular.

It is blind. The verdicts are not drawn on the images and the filenames carry a
random id, so nothing tells the labeller what either pipeline said or which
clip they are looking at. An overlay would anchor the judgement to the answer
it is meant to check.

It shows a sequence, not a frame. A single frame at 30 fps can catch a foot
already flattened, and judging from it would repeat the algorithm's own
handicap. Five frames spanning touchdown let a person see which part of the
foot arrived first, which is information the single frame has lost.

    python tools/sports2d/label-sheet.py

Writes out/labels/ with one strip per disagreement, sheet.html for judging
them, labels.csv as the file the judging produces, and key.csv holding what was
hidden. Open sheet.html in a browser, judge, save the CSV over labels.csv, then
run score-labels.py.
"""

from __future__ import annotations

import csv
import io
import random
import sys
from collections import defaultdict
from pathlib import Path

import cv2

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "labels"

# How far apart two contacts may be and still be the same footfall. The same
# 80 ms the pipeline comparison uses, for the same reason: two frames of slack
# at 30 fps, well inside the shortest step a runner takes.
PAIR_WINDOW_S = 0.08

# Frames either side of touchdown in each strip. Two before and two after
# covers the roll-in at 30 fps without turning the strip into a filmstrip
# nobody will scroll.
BEFORE = 2
AFTER = 2

# The band of the frame each tile keeps, measured from the top. The feet live
# in the bottom of a running shot and the ground line has to be in view — it is
# what tells a foot's angle apart from a foot's shape.
CROP_FROM = 0.55
STRIP_HEIGHT = 220


def landings_by_clip() -> dict[str, dict[str, list[dict]]]:
    path = HERE / "landings.csv"
    if not path.exists():
        sys.exit(f"landings.csv 없음: {path}\n(compare-all.py 를 먼저 돌리세요)")
    grouped: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            grouped[row["id"]][row["pipeline"]].append(row)
    return grouped


def disagreements(rows: dict[str, list[dict]]) -> list[dict]:
    """Contacts both pipelines found and named differently.

    Nearest-first pairing, the same as the comparison's: walking the two lists
    together would pair everything after a missed footfall with the wrong
    partner and call all of it a disagreement.
    """
    browser = sorted(rows.get("browser", []), key=lambda r: float(r["t_contact"]))
    reference = sorted(rows.get("sports2d", []), key=lambda r: float(r["t_contact"]))
    candidates = []
    for i, a in enumerate(browser):
        for j, b in enumerate(reference):
            apart = abs(float(a["t_contact"]) - float(b["t_contact"]))
            if apart <= PAIR_WINDOW_S:
                candidates.append((apart, i, j, a, b))
    candidates.sort(key=lambda c: c[0])

    used_a: set[int] = set()
    used_b: set[int] = set()
    found = []
    for apart, i, j, a, b in candidates:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        # Only where both committed to an answer. One saying "판정 불가" is a
        # different question — why it declined — and not one a person looking
        # at frames can settle.
        if a["strike"] == b["strike"]:
            continue
        if "unknown" in (a["strike"], b["strike"]):
            continue
        found.append({"apart": apart, "browser": a, "sports2d": b})
    return sorted(found, key=lambda d: float(d["browser"]["t_contact"]))


def strip_for(video: Path, t_contact: float, fps: float) -> "cv2.typing.MatLike | None":
    """A horizontal strip of frames spanning touchdown.

    The crop is a fixed band across the full width rather than a box around the
    foot. A box would have to be centred on a landmark, and the only landmarks
    available come from the two pipelines being adjudicated — so framing the
    evidence with one of their answers. Full width keeps a runner who crosses
    the frame in view without asking either of them where to look.
    """
    capture = cv2.VideoCapture(str(video))
    frame_at = round(t_contact * fps)
    tiles = []
    for offset in range(-BEFORE, AFTER + 1):
        index = max(0, frame_at + offset)
        capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = capture.read()
        if not ok:
            continue
        height, width = frame.shape[:2]
        # Lower half, full width: the feet are there, and a person can find
        # them. A tighter crop needs a landmark and would tie the sheet to one
        # pipeline's idea of where the foot was.
        crop = frame[int(height * CROP_FROM) : height, 0:width]
        scale = STRIP_HEIGHT / crop.shape[0]
        tiles.append(
            cv2.resize(crop, (int(crop.shape[1] * scale), STRIP_HEIGHT), interpolation=cv2.INTER_AREA)
        )
    capture.release()
    if not tiles:
        return None
    # A one-pixel gap so the frames read as separate moments.
    separator = 2
    total = sum(tile.shape[1] for tile in tiles) + separator * (len(tiles) - 1)
    strip = cv2.copyMakeBorder(
        tiles[0], 0, 0, 0, total - tiles[0].shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255)
    )
    x = tiles[0].shape[1]
    for tile in tiles[1:]:
        x += separator
        strip[0 : tile.shape[0], x : x + tile.shape[1]] = tile
        x += tile.shape[1]
    return strip


def write_sheet(ids: list[str]) -> None:
    """A local page for judging the strips.

    Typing verdicts into a CSV while flipping between image files is the kind
    of chore that does not get done, and a half-finished sheet is worth
    nothing. This shows one strip at a time with a key for each answer and
    hands back the CSV at the end.

    It keeps answers in the browser's own storage as they are made, because
    fourteen judgements is long enough that closing the tab by accident should
    not cost them.

    Deliberately does not know the key. The page is handed nothing but ids and
    image names, so it cannot leak what either pipeline said even by mistake.
    """
    options = [
        ("rearfoot", "리어풋", "발꿈치가 먼저 닿음 · 발끝은 아직 들려 있음"),
        ("midfoot", "미드풋", "발 전체가 거의 평평하게 닿음"),
        ("forefoot", "포어풋", "앞꿈치가 먼저 닿음 · 발꿈치는 아직 들려 있음"),
        ("unsure", "판단 불가", "프레임으로 가릴 수 없음"),
    ]
    buttons = "".join(
        f'<button data-value="{value}" title="{hint}">'
        f'<kbd>{i + 1}</kbd> {label}<small>{hint}</small></button>'
        for i, (value, label, hint) in enumerate(options)
    )
    ids_json = "[" + ",".join(f'"{one}"' for one in ids) + "]"

    html = f"""<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<title>착지 판정 시트</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ margin: 0; font: 15px/1.6 system-ui, sans-serif;
         background: #101013; color: #e9e9ee; }}
  header {{ padding: 20px 24px 12px; border-bottom: 1px solid #26262d; }}
  h1 {{ margin: 0 0 6px; font-size: 18px; letter-spacing: -0.01em; }}
  header p {{ margin: 0; color: #9a9aa6; font-size: 13px; }}
  main {{ padding: 24px; }}
  figure {{ margin: 0 0 8px; background: #000; border-radius: 8px; overflow-x: auto; }}
  figure img {{ display: block; height: auto; max-width: none; }}
  .marks {{ display: flex; gap: 0; margin: 0 0 20px; color: #6f6f7a;
            font-size: 11px; letter-spacing: 0.08em; }}
  .marks span {{ flex: 1; text-align: center; }}
  .marks span.now {{ color: #f05a4a; font-weight: 600; }}
  #choices {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
              gap: 10px; }}
  button {{ display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
           padding: 12px 14px; border: 1px solid #33333c; border-radius: 8px;
           background: #1a1a20; color: inherit; font: inherit; text-align: left;
           cursor: pointer; }}
  button:hover {{ border-color: #f05a4a; }}
  button small {{ color: #8d8d99; font-size: 12px; }}
  kbd {{ display: inline-block; min-width: 18px; padding: 1px 5px; margin-right: 6px;
        border: 1px solid #44444f; border-radius: 4px; background: #26262d;
        font: 600 11px/1.4 ui-monospace, monospace; text-align: center; }}
  footer {{ position: sticky; bottom: 0; display: flex; align-items: center; gap: 14px;
           padding: 14px 24px; border-top: 1px solid #26262d; background: #16161b; }}
  #done {{ color: #9a9aa6; font-size: 13px; }}
  #out {{ width: 100%; min-height: 160px; margin-top: 16px; padding: 12px;
         border: 1px solid #33333c; border-radius: 8px; background: #0b0b0e;
         color: #d7d7e0; font: 12px/1.6 ui-monospace, monospace; }}
  .ghost {{ background: none; border-color: #33333c; padding: 8px 14px; }}
</style>
<header>
  <h1>착지 판정 시트</h1>
  <p>가로 다섯 칸은 <b>접지 전 2 · 접지 · 접지 후 2</b> 프레임입니다.
     발이 지면에 처음 닿는 칸에서 <b>어느 부위가 먼저 닿았는지</b> 고르세요.
     두 분석기가 서로 다르게 본 착지만 모았고, 각각 무엇이라고 했는지는 보여주지 않습니다.</p>
</header>
<main>
  <div id="stage">
    <p id="where"></p>
    <figure><img id="strip" alt=""></figure>
    <div class="marks">
      <span>접지 −2</span><span>−1</span><span class="now">접지</span><span>+1</span><span>+2</span>
    </div>
    <div id="choices">{buttons}</div>
  </div>
  <div id="finish" hidden>
    <p>판정이 끝났습니다. 아래 내용을 <code>labels.csv</code> 에 저장한 뒤
       <code>python tools/sports2d/score-labels.py</code> 를 돌리세요.</p>
    <button class="ghost" id="copy">클립보드로 복사</button>
    <button class="ghost" id="save">labels.csv 로 저장</button>
    <textarea id="out" readonly></textarea>
  </div>
</main>
<footer>
  <button class="ghost" id="back">← 이전</button>
  <span id="done"></span>
  <button class="ghost" id="reset">처음부터</button>
</footer>
<script>
  const ids = {ids_json};
  const KEY = "stride-lab-labels";
  let answers = {{}};
  try {{ answers = JSON.parse(localStorage.getItem(KEY) || "{{}}"); }} catch {{}}
  let at = ids.findIndex((id) => !answers[id]);
  if (at < 0) at = ids.length;

  const el = (id) => document.getElementById(id);
  const csv = () =>
    "id,verdict,confidence,note\\n" +
    ids.map((id) => `${{id}},${{answers[id] || ""}},,`).join("\\n") + "\\n";

  function keep() {{
    try {{ localStorage.setItem(KEY, JSON.stringify(answers)); }} catch {{}}
  }}

  function draw() {{
    const total = ids.length;
    const filled = ids.filter((id) => answers[id]).length;
    el("done").textContent = `${{filled}} / ${{total}} 판정`;
    el("back").disabled = at === 0;
    if (at >= total) {{
      el("stage").hidden = true;
      el("finish").hidden = false;
      el("out").value = csv();
      return;
    }}
    el("stage").hidden = false;
    el("finish").hidden = true;
    el("where").textContent = `${{at + 1}} / ${{total}}`;
    el("strip").src = ids[at] + ".png";
  }}

  function choose(value) {{
    if (at >= ids.length) return;
    answers[ids[at]] = value;
    keep();
    at += 1;
    draw();
  }}

  document.querySelectorAll("#choices button").forEach((button) => {{
    button.addEventListener("click", () => choose(button.dataset.value));
  }});
  el("back").addEventListener("click", () => {{ at = Math.max(0, at - 1); draw(); }});
  el("reset").addEventListener("click", () => {{
    if (!confirm("판정을 모두 지웁니다.")) return;
    answers = {{}}; keep(); at = 0; draw();
  }});
  el("copy").addEventListener("click", async () => {{
    await navigator.clipboard.writeText(csv());
    el("copy").textContent = "복사했습니다";
  }});
  el("save").addEventListener("click", () => {{
    const url = URL.createObjectURL(new Blob([csv()], {{ type: "text/csv" }}));
    const a = document.createElement("a");
    a.href = url; a.download = "labels.csv"; a.click();
    URL.revokeObjectURL(url);
  }});
  addEventListener("keydown", (event) => {{
    const keys = {{ "1": "rearfoot", "2": "midfoot", "3": "forefoot", "4": "unsure" }};
    if (keys[event.key]) {{ choose(keys[event.key]); event.preventDefault(); }}
    if (event.key === "ArrowLeft") {{ at = Math.max(0, at - 1); draw(); }}
  }});
  draw();
</script>
</html>
"""
    (OUT / "sheet.html").write_text(html, encoding="utf-8")


def main() -> int:
    with (HERE / "clips.csv").open(encoding="utf-8-sig", newline="") as handle:
        clips = {row["id"]: row for row in csv.DictReader(handle) if row.get("id")}

    grouped = landings_by_clip()
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.png"):
        stale.unlink()

    # Seeded, so rebuilding the sheet does not reshuffle ids that somebody has
    # already filled in against.
    shuffler = random.Random(20260903)

    items = []
    for run_id, rows in sorted(grouped.items()):
        found = disagreements(rows)
        if not found:
            print(f"[{run_id}] 불일치 없음")
            continue
        clip = clips.get(run_id)
        if not clip:
            print(f"[{run_id}] clips.csv 에 없음")
            continue
        video = (HERE / clip["file"]).resolve()
        if not video.exists():
            print(f"[{run_id}] 클립 없음: {video}")
            continue
        capture = cv2.VideoCapture(str(video))
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        capture.release()

        made = 0
        for pair in found:
            t = float(pair["browser"]["t_contact"])
            strip = strip_for(video, t, fps)
            if strip is None:
                continue
            items.append(
                {
                    "id": "",
                    "clip_id": run_id,
                    "t_contact": round(t, 3),
                    "side": pair["browser"]["side"],
                    "browser": pair["browser"]["strike"],
                    "sports2d": pair["sports2d"]["strike"],
                    "browser_deg": pair["browser"]["strike_angle_deg"],
                    "sports2d_deg": pair["sports2d"]["strike_angle_deg"],
                    "_strip": strip,
                }
            )
            made += 1
        print(f"[{run_id}] 불일치 {len(found)}개 · 시트 {made}개")

    if not items:
        print("\n판정할 불일치가 없습니다")
        return 0

    # Ids assigned after the whole set is known and in shuffled order, so the
    # sequence of files says nothing about clip or time.
    order = list(range(len(items)))
    shuffler.shuffle(order)
    for position, index in enumerate(order, start=1):
        items[index]["id"] = f"L{position:03d}"

    for item in items:
        cv2.imwrite(str(OUT / f"{item['id']}.png"), item.pop("_strip"))

    fields = ["id", "verdict", "confidence", "note"]
    with (OUT / "labels.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in sorted(items, key=lambda i: i["id"]):
            writer.writerow({"id": item["id"], "verdict": "", "confidence": "", "note": ""})

    key_fields = ["id", "clip_id", "t_contact", "side", "browser", "sports2d", "browser_deg", "sports2d_deg"]
    with (OUT / "key.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=key_fields, extrasaction="ignore")
        writer.writeheader()
        for item in sorted(items, key=lambda i: i["id"]):
            writer.writerow(item)

    write_sheet([item["id"] for item in sorted(items, key=lambda i: i["id"])])

    print(f"\n{OUT.relative_to(HERE.parent.parent)} · 스트립 {len(items)}개")
    print(f"  판정: {OUT / 'sheet.html'} 를 브라우저로 열기")
    print("  각 스트립은 접지 전 2프레임 · 접지 · 접지 후 2프레임 입니다")
    print("  key.csv 는 판정 전에 열지 마세요 — 두 파이프라인의 답이 들어 있습니다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
