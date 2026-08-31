import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitThresholdsModule } from "../src/lib/thresholds-source";

const yamlPath = join(import.meta.dirname, "../shared/thresholds.yaml");
const outPath = join(import.meta.dirname, "../src/lib/thresholds.generated.ts");

const rendered = emitThresholdsModule(readFileSync(yamlPath, "utf8"));
writeFileSync(outPath, rendered);
console.log(
  `wrote ${rendered.split("\n").length} lines to src/lib/thresholds.generated.ts`,
);
