import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseFlagCell,
  parseNumericCell,
  parseStrikeCell,
} from "../src/lib/Shoeranking";

const csvPath = join(import.meta.dirname, "../src/data/shoes.csv");
const jsonPath = join(import.meta.dirname, "../src/data/shoes.json");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value.length)) rows.push(row);
  }
  return rows;
}

// Every column below is read by position, so a header check on the first cell
// alone would let an inserted column shift drop and weight one place to the
// right in silence. Hold the whole header instead.
const HEADER = [
  "Brand",
  "Model_Name",
  "Type",
  "Recommended_Strike",
  "Heel_Drop_mm",
  "Weight_g",
  "Super_Trainer",
  "Biomechanical_Features",
];

const [header, ...rows] = parseCsv(readFileSync(csvPath, "utf8"));
if (header.join() !== HEADER.join()) {
  throw new Error(
    `unexpected header:
  got      ${header.join(",")}
  expected ${HEADER.join(",")}`,
  );
}

const shoes = rows.map((cols) => {
  const strikes = parseStrikeCell(cols[3]);
  return {
    brand: cols[0],
    model: cols[1],
    category: cols[2],
    recommendedStrike: strikes.includes("any")
      ? "any"
      : strikes[0] ?? "unspecified",
    recommendedStrikes: strikes,
    heelDropMm: parseNumericCell(cols[4]),
    weightG: parseNumericCell(cols[5]),
    superTrainer: parseFlagCell(cols[6]),
    features: cols[7] ?? "",
  };
});

writeFileSync(jsonPath, `${JSON.stringify(shoes, null, 2)}\n`);
console.log(`wrote ${shoes.length} shoes to src/data/shoes.json`);
