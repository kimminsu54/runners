/**
 * Reads `src/data/shoes.csv` and renders `src/data/shoes.json`.
 *
 * Both halves live here, with no filesystem access, so the generator script and
 * the self-test can share them: the test re-renders the JSON from the CSV in
 * memory and compares it with the file on disk, which is what makes a stale
 * catalog fail `npm run test:analysis` instead of shipping.
 *
 * Before this, the only thing holding the two files together was a comment
 * asking whoever edited the CSV to remember to re-emit. The app reads the JSON,
 * so forgetting meant the catalog on screen quietly stayed one edit behind —
 * the same drift, inside one repository, that splitting the catalog across two
 * projects caused between them.
 */

import {
  parseFlagCell,
  parseNumericCell,
  parseStrikeCell,
} from "@/lib/Shoeranking";

/**
 * Every column below is read by position, so a header check on the first cell
 * alone would let an inserted column shift drop and weight one place to the
 * right in silence. Hold the whole header instead.
 */
export const SHOE_CSV_HEADER = [
  "Brand",
  "Model_Name",
  "Type",
  "Recommended_Strike",
  "Heel_Drop_mm",
  "Weight_g",
  "Super_Trainer",
  "Biomechanical_Features",
] as const;

export function parseCsv(text: string): string[][] {
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

export type CatalogRow = {
  brand: string;
  model: string;
  category: string;
  recommendedStrike: string;
  recommendedStrikes: string[];
  heelDropMm: number | null;
  weightG: number | null;
  superTrainer: boolean;
  features: string;
};

export function parseShoesCsv(text: string): CatalogRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.join() !== SHOE_CSV_HEADER.join()) {
    throw new Error(
      `unexpected header:\n  got      ${header?.join(",")}\n  expected ${SHOE_CSV_HEADER.join(",")}`,
    );
  }
  return rows.map((cols) => {
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
}

/** The exact bytes `src/data/shoes.json` should hold for this CSV. */
export function emitShoesJson(csv: string): string {
  return `${JSON.stringify(parseShoesCsv(csv), null, 2)}\n`;
}
