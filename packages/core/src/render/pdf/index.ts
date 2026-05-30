import { PDFDocument, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { CompiledDeck } from "../../pipeline";
import { lowerSlide } from "../../pipeline";
import { hexToRgb01 } from "../../lib/color";
import { rgb } from "pdf-lib";
import { embedFonts } from "./fonts";
import { drawPrimitive } from "./primitives";
import { PipelineError } from "../../lib/error";
import { browserSvgRasterizer, type SvgRasterizer } from "./svg-raster";
import { injectFontCmaps } from "./font-postprocess";

export type { SvgRasterizer } from "./svg-raster";
export { browserSvgRasterizer } from "./svg-raster";

export interface PdfResult {
  bytes: Uint8Array;
  errors: PipelineError[];
}

// PDF render options.
// rasterizeSvg: pdf-lib cannot embed SVG natively, so any image whose mime is
// image/svg+xml is converted to PNG first. Defaults to browserSvgRasterizer
// (uses the runtime's canvas APIs); callers in Node should supply their own
// (e.g. one backed by @resvg/resvg-wasm or @resvg/resvg-js) -- otherwise the
// SVG is skipped with a clear error in PdfResult.errors.
export interface RenderPdfOptions {
  rasterizeSvg?: SvgRasterizer;
}

// Render an entire compiled deck to PDF. Consumes the same LIR as SVG.
export async function renderPdf(
  compiled: CompiledDeck,
  options: RenderPdfOptions = {},
): Promise<PdfResult> {
  const errors: PipelineError[] = [];
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const fonts = await embedFonts(pdf, compiled.fonts, errors);
  const imageCache = new Map<Uint8Array, PDFImage>();
  const rasterizeSvg = options.rasterizeSvg ?? browserSvgRasterizer;

  for (let i = 0; i < compiled.deck.slides.length; i++) {
    const lir = lowerSlide(compiled, i);
    if (!lir) continue;
    const page = pdf.addPage([lir.width, lir.height]);

    if (lir.background) {
      const { r, g, b } = hexToRgb01(lir.background);
      page.drawRectangle({
        x: 0,
        y: 0,
        width: lir.width,
        height: lir.height,
        color: rgb(r, g, b),
      });
    }

    for (const prim of lir.primitives) {
      await drawPrimitive(pdf, page, prim, fonts, imageCache, rasterizeSvg, errors);
    }
  }

  const bytes = await pdf.save();
  // pdf-lib's subset embedder omits the font cmap table, which macOS Preview
  // requires to load embedded TrueType. Patch the saved PDF so every subset
  // FontFile2 has a minimal cmap -- the rendering itself still goes through
  // CIDToGIDMap, the cmap is just there to keep the sfnt loader happy.
  const patched = await injectFontCmaps(bytes);
  return { bytes: patched, errors };
}
