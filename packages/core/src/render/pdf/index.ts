import { PDFDocument, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { CompiledDeck } from "../../pipeline";
import { lowerSlide } from "../../pipeline";
import { hexToRgb01 } from "../../lib/color";
import { rgb } from "pdf-lib";
import { embedFonts } from "./fonts";
import { drawPrimitive } from "./primitives";
import { PipelineError } from "../../lib/error";

export interface PdfResult {
  bytes: Uint8Array;
  errors: PipelineError[];
}

// コンパイル済みデッキ全体を PDF にレンダリングする。SVG と同じ LIR を消費。
export async function renderPdf(compiled: CompiledDeck): Promise<PdfResult> {
  const errors: PipelineError[] = [];
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const fonts = await embedFonts(pdf, compiled.fonts, errors);
  const imageCache = new Map<Uint8Array, PDFImage>();

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
      await drawPrimitive(pdf, page, prim, fonts, imageCache, errors);
    }
  }

  const bytes = await pdf.save();
  return { bytes, errors };
}
