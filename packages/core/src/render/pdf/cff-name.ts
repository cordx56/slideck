// Read the CFF Name INDEX entry from a font file.
//
// Background: macOS Preview matches a PDF font's BaseFont against the embedded
// CFF program's Name INDEX (not against the OpenType name table). For .otf /
// .ttc Hiragino-class fonts the two disagree:
//
//     OpenType name table  postscriptName : HiraginoSans-W7
//     CFF "Name INDEX"     first entry    : HiraKakuStdN-W7
//
// pdf-lib's embedFont(customName) writes whatever string we give it as the
// PDF BaseFont. fontkit's font.postscriptName returns the OT name. When we
// hand pdf-lib that OT name, Preview reads the embedded CFF, finds a
// different name, rejects the font, and falls back to a system font --
// rendering subset CIDs 1..N as the first N glyphs of the fallback. That
// produces the consecutive-ASCII garbling pattern the user saw.
//
// Fix: read the CFF Name INDEX up front and use *that* as the PostScript
// name. Then BaseFont matches the embedded font's self-identification, and
// Preview accepts the embed. TrueType sources have no CFF and return
// undefined here, so the caller falls back to fontkit's postscriptName.
//
// Format references:
// - OpenType: https://docs.microsoft.com/typography/opentype/spec/otff
// - CFF:      Adobe Technical Note #5176 ("The CFF Specification")

const OTTO_MAGIC = 0x4f54544f; // "OTTO"  -- sfnt with CFF outlines
const TTCF_MAGIC = 0x74746366; // "ttcf"  -- TrueType Collection
const CFF_MAJOR = 0x01;        // raw CFF major version byte

// Read the CFF Name INDEX's first entry from a font file. Supports:
//   - raw CFF                (header: 01 00 ...)
//   - OpenType with CFF      (header: "OTTO", look up "CFF " table)
//   - TrueType Collection    (header: "ttcf", recurse into face 0)
//
// Returns undefined for TrueType outline fonts (no CFF table) or any input
// the parser doesn't recognise -- callers handle this by falling back to a
// different name source.
export function readCffName(bytes: Uint8Array): string | undefined {
  if (bytes.length < 4) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0);

  if (bytes[0] === CFF_MAJOR && bytes[1] === 0) {
    return readNameFromCffBlob(bytes, 0);
  }
  if (magic === OTTO_MAGIC) {
    const cffOff = findSfntTable(bytes, 0, "CFF ");
    return cffOff !== undefined ? readNameFromCffBlob(bytes, cffOff) : undefined;
  }
  if (magic === TTCF_MAGIC) {
    // TTC header: ttcf(4) + Version(4) + numFonts(4) + offsets[numFonts](4*N).
    // Use face 0 -- pdf-lib's font reader defaults to the same.
    if (bytes.length < 16) return undefined;
    const face0Off = dv.getUint32(12);
    const cffOff = findSfntTable(bytes, face0Off, "CFF ");
    return cffOff !== undefined ? readNameFromCffBlob(bytes, cffOff) : undefined;
  }
  return undefined; // TTF or unknown
}

// Walk an sfnt-style table directory starting at `sfntOffset` and return the
// absolute file offset of the named table, or undefined.
function findSfntTable(bytes: Uint8Array, sfntOffset: number, tag: string): number | undefined {
  if (sfntOffset + 12 > bytes.length) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = dv.getUint16(sfntOffset + 4);
  const tagCodes = [tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)];
  for (let i = 0; i < numTables; i++) {
    const off = sfntOffset + 12 + i * 16;
    if (off + 16 > bytes.length) return undefined;
    if (
      bytes[off] === tagCodes[0] &&
      bytes[off + 1] === tagCodes[1] &&
      bytes[off + 2] === tagCodes[2] &&
      bytes[off + 3] === tagCodes[3]
    ) {
      return dv.getUint32(off + 8);
    }
  }
  return undefined;
}

// Parse a CFF blob located at `cffOffset` and return the first Name INDEX
// entry. CFF Name INDEX layout: count u16, offSize u8, offsets[count+1] each
// `offSize` bytes (1-based), then the concatenated name bytes. We only need
// the first entry, which spans data[offsets[0]-1 .. offsets[1]-1].
function readNameFromCffBlob(bytes: Uint8Array, cffOffset: number): string | undefined {
  if (cffOffset + 4 > bytes.length) return undefined;
  const hdrSize = bytes[cffOffset + 2];
  if (hdrSize < 4 || cffOffset + hdrSize + 3 > bytes.length) return undefined;

  let p = cffOffset + hdrSize;
  const count = (bytes[p] << 8) | bytes[p + 1];
  p += 2;
  if (count === 0) return undefined;
  const offSize = bytes[p++];
  if (offSize < 1 || offSize > 4) return undefined;

  // Need at least two offsets (start of name 0, start of name 1) to slice the
  // first name out. The whole offsets table is (count+1)*offSize bytes.
  if (p + (count + 1) * offSize > bytes.length) return undefined;
  const off0 = readUInt(bytes, p, offSize);
  const off1 = readUInt(bytes, p + offSize, offSize);
  const dataStart = p + (count + 1) * offSize;

  // Offsets are 1-based per CFF spec ("zero" means missing).
  if (off0 < 1 || off1 < off0) return undefined;
  const start = dataStart + off0 - 1;
  const end = dataStart + off1 - 1;
  if (end > bytes.length) return undefined;
  return new TextDecoder("ascii").decode(bytes.subarray(start, end));
}

function readUInt(bytes: Uint8Array, offset: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = (v << 8) | bytes[offset + i];
  return v >>> 0;
}
