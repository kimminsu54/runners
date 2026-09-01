import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitShoesJson, parseShoesCsv } from "../src/lib/shoes-source";

const csvPath = join(import.meta.dirname, "../shared/shoes.csv");
const jsonPath = join(import.meta.dirname, "../shared/shoes.json");

const csv = readFileSync(csvPath, "utf8");
writeFileSync(jsonPath, emitShoesJson(csv));
console.log(`wrote ${parseShoesCsv(csv).length} shoes to shared/shoes.json`);
