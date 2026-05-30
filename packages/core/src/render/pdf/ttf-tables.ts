// Generic sfnt (TrueType / OpenType) table-directory manipulation. No
// knowledge of any specific table is encoded here -- the helpers just parse
// the directory, compute the standard table checksum (sum of uint32 BE over
// zero-padded data), and rebuild a font with one new table inserted in
// alphabetical position. The caller supplies the new table's bytes and tag.
//
// Used by ttf-cmap.ts to inject a cmap table into pdf-lib's subset TTF
// output so macOS Preview can load it. See font-postprocess.ts for context.

export interface TableEntry {
  tag: string;
  checksum: number;
  offset: number;
  length: number;
}

export interface ParsedFont {
  // 4-byte scaler ("\x00\x01\x00\x00" = standard sfnt, "true" = Apple,
  // "OTTO" = CFF/OpenType). Preserved verbatim in the rebuilt font.
  scaler: Uint8Array;
  entries: TableEntry[];
}

// Read the 12-byte offset table + N 16-byte table records. Throws when the
// header doesn't look like an sfnt at all (caller is expected to pre-screen).
export function parseFont(ttf: Uint8Array): ParsedFont {
  if (ttf.length < 12) throw new Error("ttf too small");
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const numTables = dv.getUint16(4);
  if (12 + numTables * 16 > ttf.length) throw new Error("ttf header truncated");
  const entries: TableEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    entries.push({
      tag: String.fromCharCode(ttf[off], ttf[off + 1], ttf[off + 2], ttf[off + 3]),
      checksum: dv.getUint32(off + 4),
      offset: dv.getUint32(off + 8),
      length: dv.getUint32(off + 12),
    });
  }
  return { scaler: ttf.slice(0, 4), entries };
}

// Standard sfnt table checksum: 32-bit big-endian unsigned sum over the data,
// zero-padded to a multiple of 4 bytes. Matches OpenType spec section "Table
// Directory" -- callers in ttf-cmap.ts use it both for the new table's
// checksum entry and for the whole-font checksum used by head.
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const n = data.length;
  const aligned = n & ~3;
  for (let i = 0; i < aligned; i += 4) {
    const w =
      ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
    sum = (sum + w) >>> 0;
  }
  if (n > aligned) {
    let w = 0;
    for (let i = aligned; i < n; i++) w = (w << 8) | data[i];
    w = w << ((4 - (n - aligned)) * 8); // pad with zeros on the right
    sum = (sum + (w >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

// Build a fresh sfnt from scratch given a tag->bytes map. Used by ot-wrap.ts
// to assemble an OpenType (OTTO) wrapper around a raw CFF subset.
//
// Table records are written in alphabetical order per the OpenType spec.
// Checksums are computed for each table; head.checkSumAdjustment is patched
// to close the 0xB1B0AFBA invariant exactly like addTable above.
//
// scaler: 4-byte sfnt scaler. "OTTO" for OpenType+CFF; "\x00\x01\x00\x00"
// (a.k.a. "version 1.0") for TrueType.
export function buildSfnt(scaler: string, tables: Map<string, Uint8Array>): Uint8Array {
  if (scaler.length !== 4) throw new Error("scaler must be 4 chars");

  const sorted = [...tables.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const numTables = sorted.length;
  const headerSize = 12 + numTables * 16;

  // Lay out tables on 4-byte boundaries after the header.
  let cursor = pad4(headerSize);
  const layout: { tag: string; offset: number; length: number; checksum: number; data: Uint8Array }[] = [];
  for (const [tag, data] of sorted) {
    layout.push({
      tag,
      offset: cursor,
      length: data.length,
      checksum: tableChecksum(data),
      data,
    });
    cursor += pad4(data.length);
  }

  const out = new Uint8Array(cursor);
  const dv = new DataView(out.buffer);

  // Header: scaler + numTables + binary-search hint fields.
  for (let i = 0; i < 4; i++) out[i] = scaler.charCodeAt(i);
  dv.setUint16(4, numTables);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = (1 << entrySelector) * 16;
  dv.setUint16(6, searchRange);
  dv.setUint16(8, entrySelector);
  dv.setUint16(10, numTables * 16 - searchRange);

  // Directory entries + table bytes.
  for (let i = 0; i < layout.length; i++) {
    const e = layout[i];
    const off = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[off + k] = e.tag.charCodeAt(k);
    dv.setUint32(off + 4, e.checksum);
    dv.setUint32(off + 8, e.offset);
    dv.setUint32(off + 12, e.length);
    out.set(e.data, e.offset);
  }

  // Patch head.checkSumAdjustment so the full-font checksum equals the magic
  // constant 0xB1B0AFBA. The directory entry's stored head checksum was
  // computed with the adjustment as zero (it is still zero in the buffer);
  // overwriting just the adjustment doesn't invalidate it because head's
  // 4-byte slot moves the post-adjustment checksum by the same delta.
  const head = layout.find((e) => e.tag === "head");
  if (head) {
    const fontSum = tableChecksum(out);
    dv.setUint32(head.offset + 8, (0xb1b0afba - fontSum) >>> 0);
  }

  return out;
}

// Rebuild the font with one extra table added. The new table slots into the
// directory in alphabetical position; existing tables keep their bytes (and
// their original directory checksums -- the table data is copied verbatim).
//
// head.checkSumAdjustment is recomputed: the OpenType spec says it must be
// 0xB1B0AFBA minus the sum of all uint32 in the entire (zero-adjustment) font.
// Without this, viewers that verify font integrity will reject the embed.
export function addTable(
  ttf: Uint8Array,
  parsed: ParsedFont,
  newTag: string,
  newTableBytes: Uint8Array,
): Uint8Array {
  if (newTag.length !== 4) throw new Error("table tag must be 4 chars");

  // Remember the original (source) offsets before the loop below mutates the
  // directory entries -- they're the same objects we'll lay out at new
  // positions, and we still need the source positions to copy table bytes.
  const sourceOffset = new Map(parsed.entries.map((e) => [e.tag, e.offset] as const));

  // Build the final directory: existing entries (sorted alphabetically by
  // spec; pdf-lib's subset output already is, but sort to be safe) with the
  // new tag spliced in. We clone the entries so layout mutation doesn't leak
  // back into the caller's ParsedFont.
  const sorted = parsed.entries
    .map((e) => ({ ...e }))
    .sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const insertAt = sorted.findIndex((e) => e.tag > newTag);
  const newEntry: TableEntry = {
    tag: newTag,
    checksum: tableChecksum(newTableBytes),
    offset: 0,
    length: newTableBytes.length,
  };
  const directory: TableEntry[] = [
    ...sorted.slice(0, insertAt < 0 ? sorted.length : insertAt),
    newEntry,
    ...(insertAt < 0 ? [] : sorted.slice(insertAt)),
  ];

  // Lay out table data after the new (larger) directory. Each table's data
  // starts on a 4-byte boundary.
  const headerSize = 12 + directory.length * 16;
  let cursor = pad4(headerSize);
  for (const e of directory) {
    e.offset = cursor;
    cursor += pad4(e.length);
  }
  const totalSize = cursor;

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  // Header: copy scaler, set numTables and the binary-search hint fields.
  out.set(parsed.scaler, 0);
  dv.setUint16(4, directory.length);
  const entrySelector = Math.floor(Math.log2(directory.length));
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = directory.length * 16 - searchRange;
  dv.setUint16(6, searchRange);
  dv.setUint16(8, entrySelector);
  dv.setUint16(10, rangeShift);

  // Directory entries.
  for (let i = 0; i < directory.length; i++) {
    const e = directory[i];
    const off = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[off + k] = e.tag.charCodeAt(k);
    dv.setUint32(off + 4, e.checksum);
    dv.setUint32(off + 8, e.offset);
    dv.setUint32(off + 12, e.length);
  }

  // Table data: original tables copied verbatim, new table written from input.
  for (const e of directory) {
    if (e.tag === newTag) {
      out.set(newTableBytes, e.offset);
    } else {
      const srcOff = sourceOffset.get(e.tag);
      if (srcOff === undefined) throw new Error(`directory references unknown tag: ${e.tag}`);
      out.set(ttf.subarray(srcOff, srcOff + e.length), e.offset);
    }
  }

  // head.checkSumAdjustment lives at head.offset + 8 (after fontRevision).
  // The convention is to write 0 there, sum the entire font, then store
  // 0xB1B0AFBA - sum so the final sum equals 0xB1B0AFBA. The directory's
  // own head checksum entry was computed with adjustment=0 too, so we don't
  // touch it.
  const head = directory.find((e) => e.tag === "head");
  if (head) {
    const adjustOff = head.offset + 8;
    dv.setUint32(adjustOff, 0);
    const fontSum = tableChecksum(out);
    dv.setUint32(adjustOff, (0xb1b0afba - fontSum) >>> 0);
  }

  return out;
}
