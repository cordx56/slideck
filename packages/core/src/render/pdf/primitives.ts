import { type PDFDocument, type PDFPage, type PDFImage, rgb, type Color, PDFString } from "pdf-lib";
import type { Primitive } from "../../ir/lir";
import { hexToRgb01 } from "../../lib/color";
import { rectY, flipY } from "./coords";
import { type EmbeddedFonts, pickFont } from "./fonts";
import { PipelineError } from "../../lib/error";

function toColor(hex: string): Color {
  const { r, g, b } = hexToRgb01(hex);
  return rgb(r, g, b);
}

// Embed each image only once per data reference.
async function embedImage(
  pdf: PDFDocument,
  data: Uint8Array,
  mime: string,
  cache: Map<Uint8Array, PDFImage>,
): Promise<PDFImage | undefined> {
  const cached = cache.get(data);
  if (cached) return cached;
  let img: PDFImage | undefined;
  const bytes = data as ArrayBuffer & Uint8Array;
  if (mime === "image/png") img = await pdf.embedPng(bytes);
  else if (mime === "image/jpeg") img = await pdf.embedJpg(bytes);
  if (img) cache.set(data, img);
  return img;
}

// Draw a single LIR primitive onto a PDF page.
export async function drawPrimitive(
  pdf: PDFDocument,
  page: PDFPage,
  prim: Primitive,
  fonts: EmbeddedFonts,
  images: Map<Uint8Array, PDFImage>,
  errors: PipelineError[],
): Promise<void> {
  const ph = page.getHeight();
  switch (prim.kind) {
    case "text": {
      for (const run of prim.runs) {
        const font = pickFont(fonts, run.font.family);
        try {
          page.drawText(run.text, {
            x: run.x,
            y: flipY(run.y, ph),
            size: run.size,
            font,
            color: toColor(run.color),
          });
        } catch (e) {
          // Font missing a glyph, etc. Skip this line and continue.
          errors.push(new PipelineError(`PDF text draw failed: "${run.text}" (${String(e)})`));
        }
      }
      break;
    }
    case "rect":
      page.drawRectangle({
        x: prim.x,
        y: rectY(prim.y, prim.h, ph),
        width: prim.w,
        height: prim.h,
        color: prim.fill ? toColor(prim.fill) : undefined,
        borderColor: prim.stroke ? toColor(prim.stroke.color) : undefined,
        borderWidth: prim.stroke?.width ?? 0,
      });
      break;
    case "line":
      page.drawLine({
        start: { x: prim.x1, y: flipY(prim.y1, ph) },
        end: { x: prim.x2, y: flipY(prim.y2, ph) },
        thickness: prim.stroke.width,
        color: toColor(prim.stroke.color),
      });
      break;
    case "circle":
      page.drawCircle({
        x: prim.cx,
        y: flipY(prim.cy, ph),
        size: prim.r,
        color: prim.fill ? toColor(prim.fill) : undefined,
        borderColor: prim.stroke ? toColor(prim.stroke.color) : undefined,
        borderWidth: prim.stroke?.width ?? 0,
      });
      break;
    case "path":
      // drawSvgPath draws SVG coords (y down) from (x,y) as origin.
      // Using the page top (y=ph) as origin matches slide absolute coords.
      page.drawSvgPath(prim.d, {
        x: 0,
        y: ph,
        color: prim.fill ? toColor(prim.fill) : undefined,
        borderColor: prim.stroke ? toColor(prim.stroke.color) : undefined,
        borderWidth: prim.stroke?.width ?? 0,
      });
      break;
    case "link": {
      // Clickable link annotation. Rect is converted to PDF coords (y up).
      const annot = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [prim.x, ph - (prim.y + prim.h), prim.x + prim.w, ph - prim.y],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(prim.href) },
      });
      page.node.addAnnot(pdf.context.register(annot));
      break;
    }
    case "image": {
      const img = await embedImage(pdf, prim.data, prim.mime, images);
      if (!img) {
        errors.push(new PipelineError(`PDF image embed: unsupported format: ${prim.mime}`));
        break;
      }
      page.drawImage(img, {
        x: prim.x,
        y: rectY(prim.y, prim.h, ph),
        width: prim.w,
        height: prim.h,
      });
      break;
    }
  }
}
