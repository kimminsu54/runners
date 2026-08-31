import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildZip,
  DOWNLOAD_FILES,
  normalizeText,
  ZIP_NAME,
  type ZipEntry,
} from "../src/lib/downloads-bundle";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public/downloads");

const entries: ZipEntry[] = DOWNLOAD_FILES.map(([from, name]) => {
  const bytes = new TextEncoder().encode(
    normalizeText(readFileSync(join(ROOT, from), "utf8")),
  );
  writeFileSync(join(OUT, name), bytes);
  return { name, bytes };
});

writeFileSync(join(OUT, ZIP_NAME), buildZip(entries));
console.log(
  `synced ${entries.length} rule files and ${ZIP_NAME} to public/downloads`,
);
