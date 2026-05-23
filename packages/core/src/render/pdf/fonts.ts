import { type PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";
import type { LoadedFont } from "../../lower/context";
import { PipelineError } from "../../lib/error";

export interface EmbeddedFonts {
  // family -> 埋め込み済み PDFFont
  byFamily: Map<string, PDFFont>;
  // ASCII フォールバック (埋め込みフォントが無い family 用)
  fallback: PDFFont;
}

// フォントを subset 埋め込みする。TTF(glyf) はそのまま、失敗時は
// 全埋め込み (CFF/OTF のサブセットバグ回避) にフォールバック。
export async function embedFonts(
  pdf: PDFDocument,
  fonts: Map<string, LoadedFont>,
  errors: PipelineError[] = [],
): Promise<EmbeddedFonts> {
  const byFamily = new Map<string, PDFFont>();
  for (const [family, lf] of fonts) {
    const embedded = await embedOne(pdf, lf, errors);
    if (embedded) byFamily.set(family, embedded);
  }
  const fallback = await pdf.embedFont(StandardFonts.Helvetica);
  return { byFamily, fallback };
}

async function embedOne(
  pdf: PDFDocument,
  lf: LoadedFont,
  errors: PipelineError[],
): Promise<PDFFont | undefined> {
  try {
    return await pdf.embedFont(lf.bytes as ArrayBuffer & Uint8Array, {
      subset: true,
    });
  } catch {
    try {
      // サブセット化に失敗するフォント (一部 CFF) は全埋め込み。
      return await pdf.embedFont(lf.bytes as ArrayBuffer & Uint8Array, {
        subset: false,
      });
    } catch (e) {
      errors.push(
        new PipelineError(`フォント埋め込み失敗: ${lf.family} (${String(e)})`),
      );
      return undefined;
    }
  }
}
