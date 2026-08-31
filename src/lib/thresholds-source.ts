/**
 * Reads `shared/thresholds.yaml` and renders `thresholds.generated.ts`.
 *
 * Both halves live here, with no filesystem access, so the generator script and
 * the self-test can share them: the test re-renders the module from the YAML in
 * memory and compares it with the file on disk, which is what makes drift fail
 * `npm run test:analysis` instead of shipping.
 *
 * The parser is deliberately tiny and strict rather than a YAML library. The
 * schema is two levels deep with scalar leaves, so a dependency would buy
 * nothing, and anything outside that shape should stop the build rather than be
 * quietly reinterpreted — a mistyped indent that turned one threshold into a
 * field of another would otherwise change a judgement silently.
 */

export const VALIDATION_STATUSES = [
  "literature",
  "derived",
  "convention",
  "internal",
  "withheld",
] as const;

export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export type ThresholdRecord = {
  key: string;
  /** What the number is a boundary for, in the words the screen uses. */
  label: string;
  value: number;
  unit: string;
  appliesTo: string;
  source: string;
  validationStatus: ValidationStatus;
  note: string;
};

const FIELDS = [
  "label",
  "value",
  "unit",
  "applies_to",
  "source",
  "validation_status",
  "note",
] as const;

function fail(line: number, message: string): never {
  throw new Error(`shared/thresholds.yaml:${line} ${message}`);
}

function parseScalar(raw: string, line: number): string | number {
  const text = raw.trim();
  if (!text) fail(line, "empty value");
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) fail(line, "unterminated quoted string");
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  const num = Number(text);
  if (!Number.isFinite(num)) {
    fail(line, `expected a number or a double-quoted string, got ${text}`);
  }
  return num;
}

export function parseThresholdsYaml(text: string): {
  version: number;
  thresholds: ThresholdRecord[];
} {
  let version: number | null = null;
  let inThresholds = false;
  let current: { key: string; line: number; fields: Map<string, string | number> } | null = null;
  const records: ThresholdRecord[] = [];

  const finish = () => {
    if (!current) return;
    for (const field of FIELDS) {
      if (!current.fields.has(field)) {
        fail(current.line, `threshold ${current.key} is missing ${field}`);
      }
    }
    const value = current.fields.get("value");
    if (typeof value !== "number") {
      fail(current.line, `threshold ${current.key} value must be a number`);
    }
    const status = current.fields.get("validation_status");
    if (typeof status !== "string" || !VALIDATION_STATUSES.includes(status as ValidationStatus)) {
      fail(
        current.line,
        `threshold ${current.key} validation_status must be one of ${VALIDATION_STATUSES.join(", ")}`,
      );
    }
    const asText = (field: string): string => {
      const raw = current!.fields.get(field);
      if (typeof raw !== "string") fail(current!.line, `${current!.key}.${field} must be quoted text`);
      return raw;
    };
    records.push({
      key: current.key,
      label: asText("label"),
      value,
      unit: asText("unit"),
      appliesTo: asText("applies_to"),
      source: asText("source"),
      validationStatus: status as ValidationStatus,
      note: asText("note"),
    });
    current = null;
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const body = line.trim();

    if (indent === 0) {
      finish();
      inThresholds = false;
      if (body === "thresholds:") {
        inThresholds = true;
        continue;
      }
      const match = /^([a-z_]+):\s*(.*)$/.exec(body);
      if (!match) fail(lineNo, `expected a top-level key, got ${body}`);
      if (match[1] === "version") version = Number(parseScalar(match[2], lineNo));
      continue;
    }

    if (!inThresholds) fail(lineNo, "indented line outside the thresholds map");

    if (indent === 2) {
      finish();
      const match = /^([a-z0-9_]+):$/.exec(body);
      if (!match) fail(lineNo, `expected a threshold key with no inline value, got ${body}`);
      current = { key: match[1], line: lineNo, fields: new Map() };
      continue;
    }

    if (indent === 4) {
      if (!current) fail(lineNo, "field without a threshold key above it");
      const match = /^([a-z_]+):\s*(.+)$/.exec(body);
      if (!match) fail(lineNo, `expected "field: value", got ${body}`);
      if (!(FIELDS as readonly string[]).includes(match[1])) {
        fail(lineNo, `unknown field ${match[1]}`);
      }
      if (current.fields.has(match[1])) fail(lineNo, `duplicate field ${match[1]}`);
      current.fields.set(match[1], parseScalar(match[2], lineNo));
      continue;
    }

    fail(lineNo, `unexpected indent of ${indent} spaces (expected 0, 2 or 4)`);
  }
  finish();

  if (version === null) fail(1, "missing version");
  if (!records.length) fail(1, "no thresholds defined");
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.key)) throw new Error(`duplicate threshold key ${record.key}`);
    seen.add(record.key);
  }
  return { version, thresholds: records };
}

function quote(text: string): string {
  return JSON.stringify(text);
}

export function emitThresholdsModule(yaml: string): string {
  const { version, thresholds } = parseThresholdsYaml(yaml);
  const keys = thresholds.map((t) => `  | ${quote(t.key)}`).join("\n");
  const entries = thresholds
    .map((t) =>
      [
        `  ${t.key}: {`,
        `    key: ${quote(t.key)},`,
        `    label: ${quote(t.label)},`,
        `    value: ${t.value},`,
        `    unit: ${quote(t.unit)},`,
        `    appliesTo: ${quote(t.appliesTo)},`,
        `    source: ${quote(t.source)},`,
        `    validationStatus: ${quote(t.validationStatus)},`,
        `    note: ${quote(t.note)},`,
        `  },`,
      ].join("\n"),
    )
    .join("\n");

  return `// GENERATED FILE — do not edit.
//
// Source: shared/thresholds.yaml (version ${version})
// Regenerate: npm run emit:thresholds
//
// \`npm run test:analysis\` re-renders this from the YAML and fails if the two
// disagree, so editing it by hand only produces a failing test.

import type { ThresholdRecord, ValidationStatus } from "@/lib/thresholds-source";

export type { ThresholdRecord, ValidationStatus };

export const THRESHOLDS_VERSION = ${version};

export type ThresholdKey =
${keys};

export const THRESHOLDS: Record<ThresholdKey, ThresholdRecord> = {
${entries}
};
`;
}
