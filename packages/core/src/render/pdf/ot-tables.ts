// Synthesise the standard OpenType tables required for an OpenType+CFF file.
// Used by ot-wrap.ts to wrap pdf-lib's raw CFF subset into an OTTO sfnt so
// macOS Preview accepts the embed.
//
// Every table is the minimum the OpenType spec accepts as well-formed. PDF
// rendering doesn't actually consult most of these values -- /W in the
// CIDFont dict overrides glyph widths, and the FontDescriptor carries the
// ascent/descent/cap-height numbers viewers display. The wrapper just needs
// to be parseable; the CFF inside it does the real work.
//
// References:
//  - OpenType spec: https://docs.microsoft.com/typography/opentype/spec/
//  - The "minimum required for OpenType" set is cmap + head + hhea + hmtx +
//    maxp + name + OS/2 + post (+ CFF for CFF outlines).

interface FontMetrics {
  numGlyphs: number;
  fontBBox: [number, number, number, number]; // xMin, yMin, xMax, yMax
  fontName: string;
  // unitsPerEm = 1000 for CFF (Adobe convention; matches CFF Top DICT default).
}

const UNITS_PER_EM = 1000;

// head: 54 bytes. checkSumAdjustment is left at 0 here; the sfnt assembler
// recomputes it after laying out all tables (per OpenType spec, the value
// must close the equation 0xB1B0AFBA = sum_of_uint32(font) + adjustment).
export function buildHead(m: FontMetrics): Uint8Array {
  const out = new Uint8Array(54);
  const dv = new DataView(out.buffer);
  // version 1.0 (Fixed = u16.u16)
  dv.setUint32(0, 0x00010000);
  // fontRevision 1.0
  dv.setUint32(4, 0x00010000);
  // checkSumAdjustment -- set later by the sfnt assembler
  dv.setUint32(8, 0);
  // magicNumber
  dv.setUint32(12, 0x5f0f3cf5);
  // flags: bit 0 (baseline at y=0), bit 1 (left sidebearing at x=0). Standard.
  dv.setUint16(16, 0x0003);
  dv.setUint16(18, UNITS_PER_EM);
  // created / modified: 64-bit big-endian seconds since 1904-01-01. Zero is fine.
  // dv.setBigInt64 isn't critical here -- leaving zeros means "epoch".
  // (already zeroed by Uint8Array initialisation)
  // xMin / yMin / xMax / yMax: int16 each
  dv.setInt16(36, m.fontBBox[0]);
  dv.setInt16(38, m.fontBBox[1]);
  dv.setInt16(40, m.fontBBox[2]);
  dv.setInt16(42, m.fontBBox[3]);
  // macStyle: 0 (plain)
  dv.setUint16(44, 0);
  // lowestRecPPEM
  dv.setUint16(46, 7);
  // fontDirectionHint: 2 = strongly LTR + neutrals (legacy convention)
  dv.setInt16(48, 2);
  // indexToLocFormat: 0 = short (irrelevant for CFF, but spec requires)
  dv.setInt16(50, 0);
  // glyphDataFormat: 0 (current format)
  dv.setInt16(52, 0);
  return out;
}

// hhea: 36 bytes. ascent/descent/lineGap are advisory for PDF -- viewers use
// the FontDescriptor's /Ascent /Descent. numberOfHMetrics = numGlyphs so
// hmtx has one full record per glyph.
export function buildHhea(m: FontMetrics): Uint8Array {
  const out = new Uint8Array(36);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000); // version 1.0
  dv.setInt16(4, m.fontBBox[3]); // ascender
  dv.setInt16(6, m.fontBBox[1]); // descender (typically negative)
  dv.setInt16(8, 0); // lineGap
  dv.setUint16(10, UNITS_PER_EM); // advanceWidthMax
  dv.setInt16(12, 0); // minLeftSideBearing
  dv.setInt16(14, 0); // minRightSideBearing
  dv.setInt16(16, UNITS_PER_EM); // xMaxExtent
  dv.setInt16(18, 1); // caretSlopeRise
  dv.setInt16(20, 0); // caretSlopeRun
  dv.setInt16(22, 0); // caretOffset
  // reserved x4 (already 0)
  dv.setInt16(32, 0); // metricDataFormat
  dv.setUint16(34, m.numGlyphs); // numberOfHMetrics
  return out;
}

// maxp v0.5: 6 bytes. v0.5 is the CFF-flavoured maxp (only numGlyphs).
// (TrueType uses v1.0 with extra fields; CFF doesn't need them.)
export function buildMaxp(m: FontMetrics): Uint8Array {
  const out = new Uint8Array(6);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00005000); // version 0.5
  dv.setUint16(4, m.numGlyphs);
  return out;
}

// hmtx: 4 bytes per glyph (advanceWidth u16 + lsb i16). PDF's /W overrides
// these for rendering; we just need numberOfHMetrics records, all set to the
// em square width so the OT loader sees consistent values.
export function buildHmtx(m: FontMetrics): Uint8Array {
  const out = new Uint8Array(m.numGlyphs * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < m.numGlyphs; i++) {
    dv.setUint16(i * 4, UNITS_PER_EM);
    dv.setInt16(i * 4 + 2, 0);
  }
  return out;
}

// name table: version 0, single name record for PostScript name (nameID 6),
// platform 3 (Microsoft) / encoding 1 (Unicode BMP) / language 0x409 (en-US),
// stored as UTF-16BE.
//
// Layout:
//   u16 version
//   u16 count
//   u16 storageOffset
//   NameRecord[count] -- each: platformID u16, encodingID u16, languageID u16,
//                        nameID u16, length u16, offset u16
//   string storage
export function buildName(m: FontMetrics): Uint8Array {
  // Encode PSName as UTF-16BE.
  const psBytes = utf16beEncode(m.fontName);
  const recordCount = 1;
  const headerLen = 6 + recordCount * 12;
  const out = new Uint8Array(headerLen + psBytes.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0); // version
  dv.setUint16(2, recordCount);
  dv.setUint16(4, headerLen);
  // Record
  dv.setUint16(6, 3); // platformID Microsoft
  dv.setUint16(8, 1); // encodingID Unicode BMP
  dv.setUint16(10, 0x0409); // languageID en-US
  dv.setUint16(12, 6); // nameID 6 = PostScript name
  dv.setUint16(14, psBytes.length); // length
  dv.setUint16(16, 0); // offset (from start of string storage)
  out.set(psBytes, headerLen);
  return out;
}

// post v3: 32 bytes. v3 explicitly carries no glyph names; viewers fall back
// to the CFF's own glyph naming when they need post-table info.
export function buildPost(): Uint8Array {
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00030000); // version 3.0
  dv.setUint32(4, 0); // italicAngle (Fixed)
  dv.setInt16(8, -100); // underlinePosition
  dv.setInt16(10, 50); // underlineThickness
  dv.setUint32(12, 0); // isFixedPitch
  // memX / minMemX / maxMemX (4x uint32): zeros are fine
  return out;
}

// OS/2 v4: 96 bytes. Most fields are advisory; we fill in the bare minimum
// the OT loader checks for plausibility (xAvgCharWidth, weight, width, type,
// y subscript / superscript offsets, ascender/descender). These match what
// a typical CJK-friendly font reports.
export function buildOS2(m: FontMetrics): Uint8Array {
  const out = new Uint8Array(96);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 4); // version 4
  dv.setInt16(2, UNITS_PER_EM); // xAvgCharWidth
  dv.setUint16(4, 400); // usWeightClass (Regular)
  dv.setUint16(6, 5); // usWidthClass (Medium)
  dv.setUint16(8, 0); // fsType: installable embedding
  // ySubscript/Superscript x/y size + offset (8 x int16): defaults
  dv.setInt16(10, 650);
  dv.setInt16(12, 600);
  dv.setInt16(14, 0);
  dv.setInt16(16, 75);
  dv.setInt16(18, 650);
  dv.setInt16(20, 600);
  dv.setInt16(22, 0);
  dv.setInt16(24, 350);
  dv.setInt16(26, 50); // yStrikeoutSize
  dv.setInt16(28, 300); // yStrikeoutPosition
  dv.setInt16(30, 0); // sFamilyClass
  // panose[10]: zeros (Latin Text / Any / Any / Any ...) -- skipped
  // ulUnicodeRange1..4 (4 x u32): zeros mean "no claim"
  // achVendID: 4 ASCII -- "XXXX" placeholder
  out[64] = 0x58;
  out[65] = 0x58;
  out[66] = 0x58;
  out[67] = 0x58;
  dv.setUint16(68, 0x0040); // fsSelection: bit 6 (Regular)
  dv.setUint16(70, 0); // usFirstCharIndex
  dv.setUint16(72, 0xffff); // usLastCharIndex
  dv.setInt16(74, m.fontBBox[3]); // sTypoAscender
  dv.setInt16(76, m.fontBBox[1]); // sTypoDescender
  dv.setInt16(78, 0); // sTypoLineGap
  dv.setUint16(80, m.fontBBox[3]); // usWinAscent
  dv.setUint16(82, Math.abs(m.fontBBox[1])); // usWinDescent
  // ulCodePageRange1..2 (2 x u32): zeros
  dv.setInt16(92, Math.floor(UNITS_PER_EM * 0.5)); // sxHeight
  dv.setInt16(94, Math.floor(UNITS_PER_EM * 0.7)); // sCapHeight
  return out;
}

function utf16beEncode(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[i * 2] = (code >> 8) & 0xff;
    out[i * 2 + 1] = code & 0xff;
  }
  return out;
}
