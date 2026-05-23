// TrueType Collection (.ttc) サポート。
// コレクションから 1 フォントを単独 SFNT (.ttf/.otf 相当) として取り出し、
// 以降のメトリクス計算・PDF 埋め込み・FontFace 登録を通常フォントと同様に扱う。

// 先頭 4 バイトが 'ttcf' なら TrueType Collection。
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

// TTC から index 番目のフォントを単独 SFNT バイト列として再構築する。
export function extractFontFromTtc(bytes: Uint8Array, index = 0): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numFonts = dv.getUint32(8);
  if (index < 0 || index >= numFonts) {
    throw new Error(`TTC のフォント index ${index} は範囲外 (0..${numFonts - 1})`);
  }

  const dirOffset = dv.getUint32(12 + index * 4);
  const sfntVersion = dv.getUint32(dirOffset);
  const numTables = dv.getUint16(dirOffset + 4);
  if (numTables === 0) throw new Error("TTC: テーブルがありません");

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

  // SFNT オフセットテーブル (binary search パラメータを再計算)。
  const maxPow = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** maxPow * 16;
  odv.setUint32(0, sfntVersion);
  odv.setUint16(4, numTables);
  odv.setUint16(6, searchRange);
  odv.setUint16(8, maxPow);
  odv.setUint16(10, numTables * 16 - searchRange);

  // 各テーブルをコピーしつつオフセットを書き直す。
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
