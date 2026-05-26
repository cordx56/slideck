import { type PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";
import type { LoadedFont } from "../../lower/context";
import { PipelineError } from "../../lib/error";
import { fontVariantKey } from "../../lib/font-variant";

export interface EmbeddedFonts {
  // (family|weight|style) -> embedded PDFFont. Same compositing as in prepare.
  byKey: Map<string, PDFFont>;
  // ASCII fallback (for families with no embedded font)
  fallback: PDFFont;
  // Monospace fallback (for an unembedded "monospace" family, e.g. inline code).
  monoFallback: PDFFont;
}

// Embed fonts as subsets. TTF(glyf) as-is; on failure, fall back to
// full embed (avoids CFF/OTF subset bugs).
export async function embedFonts(
  pdf: PDFDocument,
  fonts: Map<string, LoadedFont>,
  errors: PipelineError[] = [],
): Promise<EmbeddedFonts> {
  const byKey = new Map<string, PDFFont>();
  for (const [key, lf] of fonts) {
    const embedded = await embedOne(pdf, lf, errors);
    if (embedded) byKey.set(key, embedded);
  }
  const fallback = await pdf.embedFont(StandardFonts.Helvetica);
  const monoFallback = await pdf.embedFont(StandardFonts.Courier);
  return { byKey, fallback, monoFallback };
}

// Pick the embedded variant for a run; missing variant falls back to the
// family's regular variant; missing family falls back to the generic.
export function pickFont(
  fonts: EmbeddedFonts,
  family: string,
  weight?: number,
  style?: string,
): PDFFont {
  return (
    fonts.byKey.get(fontVariantKey(family, weight, style as "normal" | "italic" | undefined)) ??
    fonts.byKey.get(fontVariantKey(family)) ??
    (/mono/i.test(family) ? fonts.monoFallback : fonts.fallback)
  );
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
      errors.push(new PipelineError(`Font embed failed: ${lf.family} (${String(e)})`));
      return undefined;
    }
  }
}
