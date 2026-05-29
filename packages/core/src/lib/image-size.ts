// Read the natural size (px) from an image's header bytes. Being browser-independent,
// web and cli produce identical results, so aspect-ratio calculations match.
// Unrecognized formats return {0,0} (= fit to box).

export function imageSize(data: Uint8Array): { width: number; height: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = data.length;

  // PNG: \x89PNG, IHDR width/height are at offset 16/20 (big-endian).
  if (len >= 24 && dv.getUint32(0) === 0x89504e47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }

  // GIF: "GIF", logical screen width/height are at offset 6/8 (little-endian).
  if (len >= 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }

  // BMP: "BM", BITMAPINFOHEADER width/height are at offset 18/22 (little-endian).
  if (len >= 26 && data[0] === 0x42 && data[1] === 0x4d) {
    return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
  }

  // JPEG: scan from FFD8 for an SOF marker; height,width are at its offset+5 (big-endian).
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
      off += 2 + dv.getUint16(off + 2); // skip ahead by the segment length
    }
  }

  // WebP: RIFF....WEBP. VP8 (lossy) / VP8L (lossless) / VP8X (extended).
  if (
    len >= 30 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
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

  // SVG: text-based; intrinsic size from the root <svg> viewBox or width/height
  // attrs. Returning the SVG's viewBox dimensions lets the deck infer aspect
  // ratio for an image element that only specifies one of width/height.
  const svg = svgSize(data);
  if (svg) return svg;

  return { width: 0, height: 0 };
}

// Parse the first <svg ...> tag. Prefer viewBox; fall back to width/height
// attributes (any absolute unit -- %-width can't form an aspect, so skip).
function svgSize(data: Uint8Array): { width: number; height: number } | null {
  // SVG files start with <?xml ...?> or directly <svg ...>. Sniff the first
  // 2 KiB as UTF-8; if there's no <svg tag, it isn't SVG.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(0, 2048));
  const tag = head.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;

  const viewBox = tag.match(/\bviewBox\s*=\s*"([^"]+)"|\bviewBox\s*=\s*'([^']+)'/i);
  if (viewBox) {
    const parts = (viewBox[1] ?? viewBox[2])
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const wAttr = tag.match(/\bwidth\s*=\s*"([^"]+)"|\bwidth\s*=\s*'([^']+)'/i);
  const hAttr = tag.match(/\bheight\s*=\s*"([^"]+)"|\bheight\s*=\s*'([^']+)'/i);
  const w = wAttr ? parseAbsoluteLength(wAttr[1] ?? wAttr[2]) : null;
  const h = hAttr ? parseAbsoluteLength(hAttr[1] ?? hAttr[2]) : null;
  if (w !== null && h !== null) return { width: w, height: h };
  return null;
}

// Parse "100", "100.5", "100px", "100pt" -> 100. Returns null for "%"-relative
// values or anything that doesn't start with a positive number.
function parseAbsoluteLength(s: string): number | null {
  const t = s.trim();
  if (t.endsWith("%")) return null;
  const v = parseFloat(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}
