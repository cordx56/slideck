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

// name table: version 0 with the three nameIDs CoreText (macOS Preview) wants
// to see -- 1 (Family), 4 (Full Name), 6 (PostScript Name). All three carry
// the same string (the CFF Name INDEX entry); CoreText only really cares that
// the records exist and decode without errors. Platform 3 (Microsoft) /
// encoding 1 (Unicode BMP) / language 0x409 (en-US), stored as UTF-16BE.
//
// Layout:
//   u16 version
//   u16 count
//   u16 storageOffset
//   NameRecord[count] -- 12 bytes each: platformID, encodingID, languageID,
//                        nameID, length, offset
//   string storage (concatenated, records point in via offset+length)
export function buildName(m: FontMetrics): Uint8Array {
  const value = utf16beEncode(m.fontName);
  const nameIds = [1, 4, 6]; // family, full name, PostScript name
  const recordCount = nameIds.length;
  const headerLen = 6 + recordCount * 12;
  // All three records share the same string -- one copy in storage, three
  // records pointing at it.
  const out = new Uint8Array(headerLen + value.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0); // version
  dv.setUint16(2, recordCount);
  dv.setUint16(4, headerLen);
  for (let i = 0; i < recordCount; i++) {
    const off = 6 + i * 12;
    dv.setUint16(off, 3); // platformID Microsoft
    dv.setUint16(off + 2, 1); // encodingID Unicode BMP
    dv.setUint16(off + 4, 0x0409); // languageID en-US
    dv.setUint16(off + 6, nameIds[i]);
    dv.setUint16(off + 8, value.length); // length
    dv.setUint16(off + 10, 0); // offset into storage (shared)
  }
  out.set(value, headerLen);
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

// OS/2 v4: 96 bytes. Field offsets follow the OpenType spec strictly --
// previous version of this builder miscounted past PANOSE and shifted
// achVendID / fsSelection / ascender etc. by 6 bytes, which CoreText reads
// as garbage values and uses to reject the font.
//
// Layout (all big-endian; offsets in bytes):
//    0  version u16              30 sFamilyClass i16
//    2  xAvgCharWidth i16        32 PANOSE u8[10]
//    4  usWeightClass u16        42 ulUnicodeRange1 u32
//    6  usWidthClass u16         46 ulUnicodeRange2 u32
//    8  fsType u16               50 ulUnicodeRange3 u32
//   10  ySubscriptXSize i16      54 ulUnicodeRange4 u32
//   12  ySubscriptYSize i16      58 achVendID Tag[4]
//   14  ySubscriptXOffset i16    62 fsSelection u16
//   16  ySubscriptYOffset i16    64 usFirstCharIndex u16
//   18  ySuperscriptXSize i16    66 usLastCharIndex u16
//   20  ySuperscriptYSize i16    68 sTypoAscender i16
//   22  ySuperscriptXOffset i16  70 sTypoDescender i16
//   24  ySuperscriptYOffset i16  72 sTypoLineGap i16
//   26  yStrikeoutSize i16       74 usWinAscent u16
//   28  yStrikeoutPosition i16   76 usWinDescent u16
//                                78 ulCodePageRange1 u32
//                                82 ulCodePageRange2 u32
//                                86 sxHeight i16
//                                88 sCapHeight i16
//                                90 usDefaultChar u16
//                                92 usBreakChar u16
//                                94 usMaxContext u16  (ends at 96)
export function buildOS2(m: FontMetrics): Uint8Array {
  const out = new Uint8Array(96);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 4); // version 4
  dv.setInt16(2, UNITS_PER_EM); // xAvgCharWidth
  dv.setUint16(4, 400); // usWeightClass (Regular)
  dv.setUint16(6, 5); // usWidthClass (Medium)
  dv.setUint16(8, 0); // fsType: installable embedding
  // y subscript / superscript x/y size + offset (8 x i16): typical defaults
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
  // PANOSE (10 bytes, offsets 32..41): all zeros = "Any / Any / Any ..."
  // ulUnicodeRange1..4 (16 bytes, offsets 42..57): zeros = "no claim"
  // achVendID at offset 58 (4 ASCII bytes) -- "XXXX" placeholder
  out[58] = 0x58;
  out[59] = 0x58;
  out[60] = 0x58;
  out[61] = 0x58;
  dv.setUint16(62, 0x0040); // fsSelection: bit 6 (Regular)
  dv.setUint16(64, 0); // usFirstCharIndex
  dv.setUint16(66, 0xffff); // usLastCharIndex
  dv.setInt16(68, m.fontBBox[3]); // sTypoAscender
  dv.setInt16(70, m.fontBBox[1]); // sTypoDescender
  dv.setInt16(72, 0); // sTypoLineGap
  dv.setUint16(74, m.fontBBox[3]); // usWinAscent
  dv.setUint16(76, Math.abs(m.fontBBox[1])); // usWinDescent
  // ulCodePageRange1..2 (8 bytes, offsets 78..85): zeros
  dv.setInt16(86, Math.floor(UNITS_PER_EM * 0.5)); // sxHeight
  dv.setInt16(88, Math.floor(UNITS_PER_EM * 0.7)); // sCapHeight
  // usDefaultChar (90), usBreakChar (92), usMaxContext (94): zeros are fine
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
