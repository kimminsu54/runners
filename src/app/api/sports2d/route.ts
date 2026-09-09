/**
 * Serves the offline Sports2D results to the page, in development only.
 *
 * Picking two files out of tools/sports2d/out/<id>/<clip>_Sports2D/ meant
 * knowing the path and which two of the folder's files mattered, and that was
 * enough friction to stop the thing being used at all. The results already sit
 * inside this repository, so the dev server can just read them: the page asks
 * what runs exist and then asks for one, and loading it is a single click.
 *
 * This route does not ship. It reads from disk by construction, which is
 * exactly what the product must never do — the promise on the front page is
 * that video is processed in the browser and never uploaded — so it answers
 * 404 outside development, and the page's button is behind the same condition.
 * A single guard in one of those two places would be a route that reads local
 * files in production the day somebody flips the other.
 *
 *     GET /api/sports2d          → { runs: [{ id, clip, frames, rate }] }
 *     GET /api/sports2d?id=02    → { name, trc, calib }
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { parseTrc, trackedFrameCount } from "@/lib/sports2d";

const DEVELOPMENT = process.env.NODE_ENV === "development";

/** Where run.py writes. Resolved from the server's cwd, which is the repo. */
const ROOT = join(process.cwd(), "tools", "sports2d", "out");
/** Where the clips are described, which is the same place run.py reads them. */
const CLIPS_CSV = join(process.cwd(), "tools", "sports2d", "clips.csv");

const notFound = () => new NextResponse("Not found", { status: 404 });

/**
 * The id comes from the query string, so it is checked rather than trusted:
 * only the names run.py creates, which are the ids in clips.csv. Anything else
 * — a separator, a dot, a drive letter — is refused before it reaches a path
 * join, because `..` there would read any file the dev server can.
 */
const isRunId = (id: string) => /^[A-Za-z0-9_-]{1,32}$/.test(id);

type Found = {
  trc: string;
  calib: string;
  name: string;
  manifest: string | null;
  /** How many people Sports2D tracked, so choosing among them is visible. */
  people: number;
};

/** The two files worth reading, from anywhere under a run's directory. */
async function findFiles(dir: string): Promise<Found | null> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const trcPaths: string[] = [];
  let calibAt: string | null = null;
  let manifestAt: string | null = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // parentPath is where the entry actually lives, which for a recursive read
    // is not the directory the walk started from.
    const path = join(entry.parentPath ?? dir, entry.name);
    if (/_px_.*\.trc$/i.test(entry.name)) trcPaths.push(path);
    else if (/_calib\.toml$/i.test(entry.name)) calibAt = path;
    else if (entry.name.toLowerCase() === "stride-lab.json") manifestAt = path;
  }
  if (!trcPaths.length || !calibAt) return null;

  // Sports2D writes one file per person it tracked, and its default ordering is
  // `on_click` — which decides nothing in a run nobody watched. So person00 is
  // not the runner by construction: on a clip filmed at a race there were
  // thirteen people and the first file found was a spectator. The subject of a
  // running clip is on screen throughout while a bystander crosses it, so the
  // one tracked in the most frames is the one to read.
  const people = await Promise.all(
    trcPaths.map(async (path) => {
      const text = await readFile(path, "utf8");
      try {
        return { path, text, tracked: trackedFrameCount(parseTrc(text)) };
      } catch {
        // A half-written file during a Sports2D pass is not a candidate.
        return { path, text, tracked: -1 };
      }
    }),
  );
  people.sort((a, b) => b.tracked - a.tracked);
  const chosen = people[0];
  if (chosen.tracked < 0) return null;
  const trcAt = chosen.path;
  const [trc, calib] = [chosen.text, await readFile(calibAt, "utf8")];
  // A run from before the manifest existed is still worth serving; the client
  // then does not claim to know which clip it belongs to.
  const manifest = manifestAt ? await readFile(manifestAt, "utf8").catch(() => null) : null;
  return {
    trc,
    calib,
    manifest,
    people: trcPaths.length,
    name: trcAt.split(/[\\/]/).pop() ?? "result.trc",
  };
}

/** What a clip is for, and what it looks like. */
type ClipDescription = { label: string; scene: string };

/**
 * One CSV row into its cells, respecting quotes.
 *
 * A plain `split(",")` was enough while every described column sat before the
 * one with commas in it. Then a description gained a comma of its own — "트랙,
 * 초보자 조언 영상" — the writer quoted it, and the tooltip showed `"트랙`.
 * Banning commas from the descriptions would have been the smaller change and
 * the wrong one: the file is written by Python's csv module and read here, so
 * this side should read what that side writes.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      // A doubled quote inside a quoted cell is one literal quote.
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/**
 * How each clip is described, keyed by its file name.
 *
 * Read from clips.csv rather than kept here, because that file is already the
 * one place a clip is described and run.py reads the same rows. Keyed by file
 * name and not by run id: a run directory is not always a clip id — the second
 * pass over one clip is `06-balanced` — and the manifest names the file.
 *
 * Two fields because they answer different questions. `label` is what the clip
 * is in the sample for — the condition it carries — and that is what a person
 * choosing between six runs needs. `scene` is what the footage shows, which is
 * worth having but does not help you choose, so it goes in the tooltip.
 *
 * A missing or malformed file costs the descriptions, not the runs.
 */
async function clipDescriptions(): Promise<Map<string, ClipDescription>> {
  const found = new Map<string, ClipDescription>();
  try {
    const text = await readFile(CLIPS_CSV, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = (lines.shift() ?? "").split(",");
    const fileAt = header.indexOf("file");
    const labelAt = header.indexOf("label");
    const sceneAt = header.indexOf("scene");
    if (fileAt < 0 || labelAt < 0) return found;
    for (const line of lines) {
      const cells = splitRow(line);
      const file = (cells[fileAt] ?? "").split(/[\\/]/).pop() ?? "";
      const label = (cells[labelAt] ?? "").trim();
      const scene = sceneAt >= 0 ? (cells[sceneAt] ?? "").trim() : "";
      if (file && label) found.set(file, { label, scene });
    }
  } catch {
    // No clips.csv on this machine: the buttons fall back to the run id.
  }
  return found;
}

/** Frame count and rate straight from the TRC header, for the run list. */
function summarise(trc: string): { frames: number; rate: number } {
  const lines = trc.split(/\r?\n/);
  const values = (lines[2] ?? "").split("\t");
  return { rate: Number(values[0]) || 0, frames: Number(values[2]) || 0 };
}

export async function GET(request: Request) {
  if (!DEVELOPMENT) return notFound();

  const id = new URL(request.url).searchParams.get("id");

  if (id) {
    if (!isRunId(id)) return notFound();
    let found: Found | null = null;
    try {
      found = await findFiles(join(ROOT, id));
    } catch {
      return notFound();
    }
    if (!found) {
      return NextResponse.json(
        { error: `${id} 에 픽셀 TRC와 _calib.toml 이 아직 없습니다.` },
        { status: 404 },
      );
    }
    return NextResponse.json(found);
  }

  // The listing. A run that produced no TRC is left out rather than offered
  // and then refused on click.
  let ids: string[] = [];
  try {
    ids = (await readdir(ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isRunId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return NextResponse.json({ runs: [], note: "tools/sports2d/out 이 아직 없습니다." });
  }

  const described = await clipDescriptions();
  const runs = [];
  for (const runId of ids) {
    try {
      const dir = join(ROOT, runId);
      if (!(await stat(dir)).isDirectory()) continue;
      const found = await findFiles(dir);
      if (!found) continue;
      // The clip name goes in the listing so a button can say which footage
      // it belongs to before it is loaded.
      let clip: string | null = null;
      let mode: string | null = null;
      try {
        const parsed = found.manifest ? JSON.parse(found.manifest) : null;
        if (parsed && typeof parsed.clip === "string") clip = parsed.clip;
        if (parsed && typeof parsed.mode === "string") mode = parsed.mode;
      } catch {
        // A malformed manifest costs the label, not the run.
      }
      runs.push({
        id: runId,
        name: found.name,
        clip,
        // What the clip is for, what it shows, and which pose model read it.
        // The mode earns its place because of the two runs over one clip,
        // where the footage is identical and the model is the whole
        // difference.
        label: clip ? (described.get(clip)?.label ?? null) : null,
        scene: clip ? (described.get(clip)?.scene ?? null) : null,
        mode,
        people: found.people,
        ...summarise(found.trc),
      });
    } catch {
      // A half-written run during a Sports2D pass is not an error here.
    }
  }
  return NextResponse.json({ runs });
}
