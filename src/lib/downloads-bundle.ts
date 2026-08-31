/**
 * What /downloads publishes, and how the bundle is written and read back.
 *
 * The page hands out the single implementations of strike classification, brand
 * ranking and the forbidden-word check as files someone can read on their own.
 * Those copies were made by hand and had gone stale: the published
 * Footstrike.ts still carried the confidence grade that was deleted from the
 * app, and Shoeranking.ts was missing parseFlagCell entirely — so /downloads was
 * handing out rules the app no longer follows. `npm run sync:downloads` writes
 * them, run-selftest.ts compares them, and both use this module so the list
 * cannot be right in one place and wrong in the other.
 *
 * Entries are stored uncompressed. The bundle is a few kilobytes, so
 * compression saves nothing worth having, and stored bytes let the self-test
 * verify the archive by reading it rather than having to inflate it.
 */

/** Source of truth → the name it is published under, in bundle order. */
export const DOWNLOAD_FILES: ReadonlyArray<readonly [string, string]> = [
  ["src/lib/Readme.md", "Readme.md"],
  ["src/lib/Footstrike.ts", "Footstrike.ts"],
  ["src/lib/Shoeranking.ts", "Shoeranking.ts"],
  ["src/lib/Footstrike.test.ts", "Footstrike.test.ts"],
  ["src/lib/Shoeranking.test.ts", "Shoeranking.test.ts"],
  ["scripts/check-language.mjs", "check-language.mjs"],
];

export const ZIP_NAME = "stride-lab-rules.zip";

/**
 * The repository checks out CRLF on Windows, so a copy that differs only in
 * line endings would read as drift. Normalise both sides through here.
 */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

/**
 * A fixed timestamp keeps the archive byte-identical across runs, so a rebuild
 * that changed nothing does not show up as a diff. 1980-01-01 is the earliest
 * the DOS date field can express, and 0x0021 is how it encodes.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export type ZipEntry = { name: string; bytes: Uint8Array };

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encode(entry.name);
    const crc = crc32(entry.bytes);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 10, true); // version needed: 1.0, stored
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.bytes.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 10, true); // version made by
    cv.setUint16(6, 10, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true); // stored
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, entry.bytes);
    centrals.push(central);
    offset += local.length + entry.bytes.length;
  }

  const centralBytes = concat(centrals);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_SIG, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralBytes.length, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, centralBytes, end]);
}

/**
 * Reads back the stored entries in bundle order. Only what this writer
 * produces: a compressed entry is reported rather than inflated, because the
 * only reason to read one here is to check it against its source file.
 */
export function readZipEntries(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  while (at + 30 <= zip.length && view.getUint32(at, true) === LOCAL_SIG) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    if (method !== 0) {
      throw new Error(`${ZIP_NAME} entry ${entries.length} is compressed`);
    }
    const nameAt = at + 30;
    const dataAt = nameAt + nameLength + extraLength;
    entries.push({
      name: decoder.decode(zip.subarray(nameAt, nameAt + nameLength)),
      bytes: zip.subarray(dataAt, dataAt + size),
    });
    at = dataAt + size;
  }
  return entries;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
