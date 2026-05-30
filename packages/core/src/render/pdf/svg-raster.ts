// pdf-lib only embeds raster images (PNG / JPEG), so SVG sources have to be
// rasterized first. The default uses the browser's native SVG support via
// OffscreenCanvas; callers in non-browser environments (Node CLI) can pass
// their own rasterizer (e.g. @resvg/resvg-wasm) to renderPdf.
//
// width / height are the *display* dimensions in slide coords; the rasterizer
// is free to render at a higher pixel density for crisp print/zoom.

export type SvgRasterizer = (
  data: Uint8Array,
  width: number,
  height: number,
) => Promise<Uint8Array | null>;

// Render at displayW * scale to give viewers headroom when they zoom in.
// 2x covers typical document zoom; users wanting more can supply their own.
const DEFAULT_SCALE = 2;

// Browser default. Uses Image + OffscreenCanvas to rasterize an SVG blob and
// re-encode it as PNG. Returns null when the runtime does not have those APIs
// (Node), or when decoding throws (e.g. malformed SVG, CORS-blocked refs).
export const browserSvgRasterizer: SvgRasterizer = async (data, width, height) => {
  if (
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    return null;
  }
  const text = new TextDecoder().decode(data);
  const blob = new Blob([text], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = Math.max(1, Math.round(width * DEFAULT_SCALE));
    const h = Math.max(1, Math.round(height * DEFAULT_SCALE));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await png.arrayBuffer());
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
};
