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

const DEVELOPMENT = process.env.NODE_ENV === "development";

/** Where run.py writes. Resolved from the server's cwd, which is the repo. */
const ROOT = join(process.cwd(), "tools", "sports2d", "out");

const notFound = () => new NextResponse("Not found", { status: 404 });

/**
 * The id comes from the query string, so it is checked rather than trusted:
 * only the names run.py creates, which are the ids in clips.csv. Anything else
 * — a separator, a dot, a drive letter — is refused before it reaches a path
 * join, because `..` there would read any file the dev server can.
 */
const isRunId = (id: string) => /^[A-Za-z0-9_-]{1,32}$/.test(id);

type Found = { trc: string; calib: string; name: string };

/** The two files worth reading, from anywhere under a run's directory. */
async function findFiles(dir: string): Promise<Found | null> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  let trcAt: string | null = null;
  let calibAt: string | null = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // parentPath is where the entry actually lives, which for a recursive read
    // is not the directory the walk started from.
    const path = join(entry.parentPath ?? dir, entry.name);
    if (/_px_.*\.trc$/i.test(entry.name)) trcAt = path;
    else if (/_calib\.toml$/i.test(entry.name)) calibAt = path;
  }
  if (!trcAt || !calibAt) return null;
  const [trc, calib] = await Promise.all([
    readFile(trcAt, "utf8"),
    readFile(calibAt, "utf8"),
  ]);
  return { trc, calib, name: trcAt.split(/[\\/]/).pop() ?? "result.trc" };
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

  const runs = [];
  for (const runId of ids) {
    try {
      const dir = join(ROOT, runId);
      if (!(await stat(dir)).isDirectory()) continue;
      const found = await findFiles(dir);
      if (!found) continue;
      runs.push({ id: runId, name: found.name, ...summarise(found.trc) });
    } catch {
      // A half-written run during a Sports2D pass is not an error here.
    }
  }
  return NextResponse.json({ runs });
}
