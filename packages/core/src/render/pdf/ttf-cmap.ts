// Minimal cmap injection for TrueType subsets that lack one.
//
// PDF 1.7 9.6.6.4 ("A CIDFontType2 font program is identical to a TrueType
// font program with one exception: It need not contain a cmap subtable.")
// allows cmap-less embeds, and pdf-lib's subsetter (via fontkit's TTFSubset)
// takes advantage of that to keep subset size minimal. macOS Preview is
// stricter though: a font program without cmap fails its sfnt loader and
// Preview falls back to a system font, rendering the document's raw CIDs as
// Unicode codepoints -- typically the consecutive ASCII "+,-./0123..." you
// get when the first N glyphs of a system font happen to be those.
//
// We don't need a useful cmap for rendering (the PDF still consults its own
// CIDToGIDMap). We just need the table to *exist* so Preview's loader is
// happy. A single Format 4 segment covering the entire BMP and mapping
// everything to .notdef (GID 0) is the smallest valid subtable that does
// the job; 44 bytes total once wrapped in the cmap-table header.

import { addTable, parseFont } from "./ttf-tables";

const CMAP_TAG = "cmap";

// Total length of the bytes returned by buildMinimalCmap, exposed so tests
// can sanity-check the size without re-parsing the structure.
export const MINIMAL_CMAP_LENGTH = 36;

// Build the cmap table data (table-header + one encoding record + one
// Format 4 subtable). The subtable maps the full 0x0000-0xFFFF range to
// GID 0 via a single segment (endCode/startCode = 0xFFFF, idDelta = 1).
export function buildMinimalCmap(): Uint8Array {
  // Format 4 subtable body. See OpenType "cmap" subtable format 4.
  // segCount = 1 -> segCountX2 = 2, searchRange = 2*1 = 2,
  // entrySelector = log2(1) = 0, rangeShift = 0.
  // Body size = 14 (fixed) + 8 (four 2-byte arrays of length 1) + 2 reservedPad
  //           = 24 bytes
  const subtableLen = 24;
  const subtable = new Uint8Array(subtableLen);
  const sdv = new DataView(subtable.buffer);
  sdv.setUint16(0, 4); // format
  sdv.setUint16(2, subtableLen); // length
  sdv.setUint16(4, 0); // language
  sdv.setUint16(6, 2); // segCountX2
  sdv.setUint16(8, 2); // searchRange
  sdv.setUint16(10, 0); // entrySelector
  sdv.setUint16(12, 0); // rangeShift
  sdv.setUint16(14, 0xffff); // endCode[0] -- sentinel covering all codes
  sdv.setUint16(16, 0); // reservedPad
  sdv.setUint16(18, 0xffff); // startCode[0]
  sdv.setInt16(20, 1); // idDelta[0]  (0xFFFF + 1 mod 65536 = 0 = .notdef)
  sdv.setUint16(22, 0); // idRangeOffset[0]

  // cmap table header: 4 bytes (version + numTables) + one encoding record.
  // Encoding record = platformID (Microsoft=3) + encodingID (Unicode BMP=1)
  // + offset (4 bytes). Then the subtable.
  const headerLen = 4 + 8;
  const out = new Uint8Array(headerLen + subtableLen);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0); // version
  dv.setUint16(2, 1); // numTables
  dv.setUint16(4, 3); // platformID = Microsoft
  dv.setUint16(6, 1); // encodingID = Unicode BMP
  dv.setUint32(8, headerLen); // offset
  out.set(subtable, headerLen);
  return out;
}

// Add a minimal cmap to a TTF when it doesn't already have one. Returns the
// original bytes (by reference) when no work is needed -- callers use that to
// skip rewriting the PDF stream.
export function ensureCmap(ttf: Uint8Array): Uint8Array {
  const parsed = parseFont(ttf);
  if (parsed.entries.some((e) => e.tag === CMAP_TAG)) return ttf;
  return addTable(ttf, parsed, CMAP_TAG, buildMinimalCmap());
}
