import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["src", "README.md"];
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".md"]);

const FORBIDDEN = [
  "피로골절",
  "족저근막",
  "인대 손상",
  "부상 확률",
  "부상 위험",
  "부상 예측",
  "진단",
  "처방",
];

const DISCLAIMER =
  /아닙니다|아니며|수는 없습니다|것은 아닙니다|지표는 아닙니다/;

type Hit = { file: string; line: number; text: string };

function isViolation(sentence: string): boolean {
  const trimmed = sentence.replace(/\s+/g, " ").trim();
  if (!trimmed) return false;
  if (!FORBIDDEN.some((term) => trimmed.includes(term))) return false;
  return !DISCLAIMER.test(trimmed);
}

function findHits(source: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isViolation(line)) continue;
    hits.push({ file, line: i + 1, text: line.trim() });
  }
  return hits;
}

function walk(path: string, files: string[]) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    if (path.includes("node_modules") || path.includes("/mediapipe/")) return;
    for (const name of readdirSync(path)) walk(join(path, name), files);
    return;
  }
  if (TEXT_EXT.has(extname(path))) files.push(path);
}

function selfTest() {
  const allowed = [
    "특정 부상 확률이나 진단이 아닙니다.",
    "의료 진단이나 훈련 처방이 아닙니다.",
    "이 영상만으로 피로골절이나 족저근막 손상을 예측할 수는 없습니다.",
    "무릎 통증이나 인대 손상을 진단하는 지표는 아닙니다.",
    "통증이 없다는 뜻이나 부상 위험이 0이라는 뜻은 아닙니다.",
    "부담 부위는 부상 예측이나 진단이 아니며 전문가 평가가 우선입니다.",
  ];
  const banned = [
    "이 착지는 피로골절입니다.",
    "무릎 인대 손상으로 진단됩니다.",
  ];

  const leaked = allowed.filter(isViolation);
  const missed = banned.filter((sentence) => !isViolation(sentence));
  if (leaked.length || missed.length) {
    console.error("check:language self-test failed");
    for (const sentence of leaked) {
      console.error(`  disclaimer flagged: ${sentence}`);
    }
    for (const sentence of missed) {
      console.error(`  violation missed: ${sentence}`);
    }
    process.exit(1);
  }
  if (banned.filter(isViolation).length !== 2) {
    console.error("check:language expected exactly two fixture violations");
    process.exit(1);
  }
}

selfTest();

const files: string[] = [];
for (const entry of SCAN_DIRS) {
  walk(join(ROOT, entry), files);
}

const hits = files.flatMap((file) =>
  findHits(readFileSync(file, "utf8"), relative(ROOT, file)),
);

if (hits.length) {
  console.error(`check:language found ${hits.length} claim(s):\n`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}`);
    console.error(`    ${hit.text}`);
  }
  process.exit(1);
}

console.log(
  "check:language ok — disclaimers kept, two fixture violations caught, no product copy claims",
);
