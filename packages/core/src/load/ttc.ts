// TrueType Collection (.ttc) support.
// Extract one font from the collection as a standalone SFNT (equivalent to .ttf/.otf),
// so later metrics calculation, PDF embedding, and FontFace registration treat it
// like a normal font.

// If the first 4 bytes are 'ttcf', it is a TrueType Collection.
export function isTtc(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x74 && // t
    bytes[1] === 0x74 && // t
    bytes[2] === 0x63 && // c
    bytes[3] === 0x66 // f
  );
}

interface TableRecord {
  tag: number;
  checksum: number;
  offset: number;
  length: number;
}

// Rebuild the font at position index from the TTC as a standalone SFNT byte sequence.
export function extractFontFromTtc(bytes: Uint8Array, index = 0): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numFonts = dv.getUint32(8);
  if (index < 0 || index >= numFonts) {
    throw new Error(`TTC font index ${index} out of range (0..${numFonts - 1})`);
  }

  const dirOffset = dv.getUint32(12 + index * 4);
  const sfntVersion = dv.getUint32(dirOffset);
  const numTables = dv.getUint16(dirOffset + 4);
  if (numTables === 0) throw new Error("TTC: no tables");

  const records: TableRecord[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = dirOffset + 12 + i * 16;
    records.push({
      tag: dv.getUint32(o),
      checksum: dv.getUint32(o + 4),
      offset: dv.getUint32(o + 8),
      length: dv.getUint32(o + 12),
    });
  }

  const align4 = (n: number) => (n + 3) & ~3;
  const headerSize = 12 + numTables * 16;
  const totalSize = headerSize + records.reduce((s, r) => s + align4(r.length), 0);

  const out = new Uint8Array(totalSize);
  const odv = new DataView(out.buffer);

  // SFNT offset table (recompute binary search parameters).
  const maxPow = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** maxPow * 16;
  odv.setUint32(0, sfntVersion);
  odv.setUint16(4, numTables);
  odv.setUint16(6, searchRange);
  odv.setUint16(8, maxPow);
  odv.setUint16(10, numTables * 16 - searchRange);

  // Copy each table while rewriting its offset.
  let dataPos = headerSize;
  for (let i = 0; i < numTables; i++) {
    const r = records[i];
    const ro = 12 + i * 16;
    odv.setUint32(ro, r.tag);
    odv.setUint32(ro + 4, r.checksum);
    odv.setUint32(ro + 8, dataPos);
    odv.setUint32(ro + 12, r.length);
    out.set(bytes.subarray(r.offset, r.offset + r.length), dataPos);
    dataPos += align4(r.length);
  }

  return out;
}
