// 画像バイト列のヘッダから自然サイズ (px) を読む。ブラウザ非依存なので
// web と cli で同一の結果になり、アスペクト比計算が一致する。
// 判別できない形式は {0,0} (= box に合わせる) を返す。

export function imageSize(data: Uint8Array): { width: number; height: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = data.length;

  // PNG: \x89PNG, IHDR の width/height は offset 16/20 (big-endian)。
  if (len >= 24 && dv.getUint32(0) === 0x89504e47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }

  // GIF: "GIF", logical screen の width/height は offset 6/8 (little-endian)。
  if (len >= 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }

  // BMP: "BM", BITMAPINFOHEADER の width/height は offset 18/22 (little-endian)。
  if (len >= 26 && data[0] === 0x42 && data[1] === 0x4d) {
    return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
  }

  // JPEG: FFD8 から SOF マーカを探し、その offset+5 に height,width (big-endian)。
  if (len >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let off = 2;
    while (off + 9 < len) {
      if (data[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = data[off + 1];
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
      off += 2 + dv.getUint16(off + 2); // セグメント長で次へ
    }
  }

  // WebP: RIFF....WEBP。VP8 (lossy) / VP8L (lossless) / VP8X (extended)。
  if (
    len >= 30 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    const fmt = String.fromCharCode(data[12], data[13], data[14], data[15]);
    if (fmt === "VP8 ") {
      return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
    if (fmt === "VP8L") {
      const b = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fmt === "VP8X") {
      const w = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
      const h = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
      return { width: w, height: h };
    }
  }

  return { width: 0, height: 0 };
}
