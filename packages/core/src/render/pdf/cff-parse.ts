// Minimal CFF parser. Reads just the bits ot-wrap.ts needs to synthesise the
// OpenType wrapper around a raw CFF blob: numGlyphs (CharStrings INDEX count)
// and FontBBox (Top DICT op 5).
//
// CFF reference: Adobe Technical Note #5176. The format is a CFF header,
// followed by a series of INDEX structures (Name, Top DICT, String, Global
// Subr) and offset-addressed sub-tables (CharStrings, charset, FDArray, etc.).
// Top DICT is a stream of operand-operator pairs encoded with one of several
// integer/real number formats; we only need to recognise FontBBox (op 5,
// preceded by four numbers) and CharStrings (op 17, preceded by an offset
// pointing to the CharStrings INDEX so we can read its count).

export interface CffInfo {
  numGlyphs: number;
  fontBBox: [number, number, number, number];
}

const OP_FONT_BBOX = 5;
const OP_CHAR_STRINGS = 17;

export function parseCff(bytes: Uint8Array): CffInfo {
  if (bytes.length < 4 || bytes[0] !== 0x01 || bytes[1] !== 0x00) {
    throw new Error("not a CFF blob");
  }
  const hdrSize = bytes[2];
  let p = hdrSize;

  // Walk past the Name INDEX (we don't need its contents).
  p = skipIndex(bytes, p);

  // Top DICT INDEX -- there is exactly one Top DICT per CFF program. Read its
  // bytes; the operators we care about are CharStrings (offset) and FontBBox
  // (four numbers).
  const topIdx = readIndex(bytes, p);
  if (topIdx.items.length === 0) throw new Error("CFF Top DICT missing");
  const topDict = topIdx.items[0];
  const { fontBBox, charStringsOffset } = decodeTopDict(topDict);

  // Read CharStrings INDEX to get numGlyphs (count includes .notdef at GID 0).
  const csCount = (bytes[charStringsOffset] << 8) | bytes[charStringsOffset + 1];

  return { numGlyphs: csCount, fontBBox };
}

// Walk an INDEX and return start/end positions plus its items as byte slices.
// CFF INDEX layout: count u16, offSize u8, offsets[count+1] (each `offSize`
// bytes, 1-based), then concatenated item data. Returns end = byte offset of
// the first byte AFTER the INDEX so callers can chain.
function readIndex(
  bytes: Uint8Array,
  pos: number,
): { items: Uint8Array[]; end: number } {
  let p = pos;
  const count = (bytes[p] << 8) | bytes[p + 1];
  p += 2;
  if (count === 0) return { items: [], end: p };
  const offSize = bytes[p++];
  const offs: number[] = [];
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = (v << 8) | bytes[p++];
    offs.push(v);
  }
  const dataStart = p;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    items.push(bytes.subarray(dataStart + offs[i] - 1, dataStart + offs[i + 1] - 1));
  }
  return { items, end: dataStart + offs[count] - 1 };
}

function skipIndex(bytes: Uint8Array, pos: number): number {
  return readIndex(bytes, pos).end;
}

interface TopDictBits {
  fontBBox: [number, number, number, number];
  charStringsOffset: number;
}

// Decode the Top DICT bytes, looking for FontBBox (op 5) and CharStrings
// (op 17). Other operators are walked over -- we don't need their values.
function decodeTopDict(dict: Uint8Array): TopDictBits {
  let bbox: [number, number, number, number] = [0, 0, 1000, 1000];
  let csOff = -1;
  const operands: number[] = [];

  let p = 0;
  while (p < dict.length) {
    const b0 = dict[p];
    if (b0 <= 21) {
      // Operator: 1 byte, or 2 bytes when prefixed with 12.
      let op = b0;
      p++;
      if (b0 === 12) op = 1200 + dict[p++];
      if (op === OP_FONT_BBOX && operands.length >= 4) {
        bbox = [operands[0], operands[1], operands[2], operands[3]] as [
          number,
          number,
          number,
          number,
        ];
      } else if (op === OP_CHAR_STRINGS && operands.length >= 1) {
        csOff = operands[0];
      }
      operands.length = 0;
    } else if (b0 === 28) {
      operands.push((dict[p + 1] << 8) | dict[p + 2]);
      p += 3;
    } else if (b0 === 29) {
      operands.push(
        (dict[p + 1] << 24) | (dict[p + 2] << 16) | (dict[p + 3] << 8) | dict[p + 4],
      );
      p += 5;
    } else if (b0 === 30) {
      // BCD-encoded real number. We don't need the value but must skip the
      // right number of bytes (every nibble is a digit until the terminator).
      p++;
      while (p < dict.length) {
        const b = dict[p++];
        if ((b & 0x0f) === 0x0f || (b >> 4) === 0x0f) break;
      }
      operands.push(0); // placeholder
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      p++;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + dict[p + 1] + 108);
      p += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - dict[p + 1] - 108);
      p += 2;
    } else {
      // 22..27, 31, 255 are reserved -- skip one byte and continue.
      p++;
    }
  }

  if (csOff < 0) throw new Error("CFF Top DICT missing CharStrings operator");
  return { fontBBox: bbox, charStringsOffset: csOff };
}
