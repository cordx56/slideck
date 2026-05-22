import {
  type PDFDocument,
  type PDFPage,
  type PDFImage,
  rgb,
  type Color,
} from "pdf-lib";
import type { Primitive } from "../../ir/lir";
import { hexToRgb01 } from "../../lib/color";
import { rectY, flipY } from "./coords";
import type { EmbeddedFonts } from "./fonts";
import { PipelineError } from "../../lib/error";

function toColor(hex: string): Color {
  const { r, g, b } = hexToRgb01(hex);
  return rgb(r, g, b);
}

// data 参照ごとに 1 回だけ画像を埋め込む。
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

// 1 つの LIR プリミティブを PDF ページに描画する。
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
        const font = fonts.byFamily.get(run.font.family) ?? fonts.fallback;
        try {
          page.drawText(run.text, {
            x: run.x,
            y: flipY(run.y, ph),
            size: run.size,
            font,
            color: toColor(run.color),
          });
        } catch (e) {
          // フォントにグリフが無い等。1 行スキップして継続。
          errors.push(
            new PipelineError(`PDF テキスト描画失敗: "${run.text}" (${String(e)})`),
          );
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
    case "path":
      // drawSvgPath は SVG 座標 (y 下向き) を (x,y) 起点に描く。
      // ページ上端 (y=ph) を起点にすればスライド絶対座標に一致。
      page.drawSvgPath(prim.d, {
        x: 0,
        y: ph,
        color: prim.fill ? toColor(prim.fill) : undefined,
        borderColor: prim.stroke ? toColor(prim.stroke.color) : undefined,
        borderWidth: prim.stroke?.width ?? 0,
      });
      break;
    case "image": {
      const img = await embedImage(pdf, prim.data, prim.mime, images);
      if (!img) {
        errors.push(
          new PipelineError(`PDF 画像埋め込み非対応の形式: ${prim.mime}`),
        );
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
