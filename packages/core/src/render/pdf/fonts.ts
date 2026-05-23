import { type PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";
import type { LoadedFont } from "../../lower/context";
import { PipelineError } from "../../lib/error";

export interface EmbeddedFonts {
  // family -> embedded PDFFont
  byFamily: Map<string, PDFFont>;
  // ASCII fallback (for families with no embedded font)
  fallback: PDFFont;
}

// Embed fonts as subsets. TTF(glyf) as-is; on failure, fall back to
// full embed (avoids CFF/OTF subset bugs).
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
      // Fonts that fail subsetting (some CFF) get full embed.
      return await pdf.embedFont(lf.bytes as ArrayBuffer & Uint8Array, {
        subset: false,
      });
    } catch (e) {
      errors.push(
        new PipelineError(`Font embed failed: ${lf.family} (${String(e)})`),
      );
      return undefined;
    }
  }
}
