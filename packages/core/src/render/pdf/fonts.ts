import { type PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { LoadedFont } from "../../lower/context";
import { PipelineError } from "../../lib/error";

export interface EmbeddedFonts {
  // CSS family -> embedded PDFFont. Each declared face is its own family.
  byFamily: Map<string, PDFFont>;
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
  const byFamily = new Map<string, PDFFont>();
  for (const [family, lf] of fonts) {
    const embedded = await embedOne(pdf, lf, errors);
    if (embedded) byFamily.set(family, embedded);
  }
  const fallback = await pdf.embedFont(StandardFonts.Helvetica);
  const monoFallback = await pdf.embedFont(StandardFonts.Courier);
  return { byFamily, fallback, monoFallback };
}

// Pick the embedded face for a family; missing family falls back to a generic
// (Courier only for the actual "monospace" CSS keyword, Helvetica otherwise --
// a named family with "mono" in it might not be monospace at all, in which case
// picking Courier here would mismatch the (likely sans-serif) browser render).
export function pickFont(fonts: EmbeddedFonts, family: string): PDFFont {
  return (
    fonts.byFamily.get(family) ?? (family === "monospace" ? fonts.monoFallback : fonts.fallback)
  );
}

async function embedOne(
  pdf: PDFDocument,
  lf: LoadedFont,
  errors: PipelineError[],
): Promise<PDFFont | undefined> {
  const bytes = lf.bytes as ArrayBuffer & Uint8Array;
  // Full embed (subset: false) on purpose: pdf-lib's subsetter (via fontkit's
  // TTFSubset) drops cmap/name/post/OS-2 from the output, leaving only the
  // outline-bearing tables (head/hhea/maxp/loca/glyf/hmtx/cvt/prep/fpgm).
  // The PDF spec allows that for CIDFontType2 with Identity-H -- the renderer
  // is supposed to use CIDToGIDMap, not the font's cmap -- and Chrome/Firefox
  // viewers do the right thing. macOS Preview (Core Graphics) is strict:
  // missing cmap makes it fall back to a system font and render the raw GIDs
  // as Unicode codepoints, producing consecutive ASCII like ",-./0123...".
  // Full embed keeps every table so every viewer renders correctly. The cost
  // is PDF size (one full TTF per face), acceptable for slide decks.
  const psName = readPostscriptName(bytes) ?? lf.family;
  try {
    return await pdf.embedFont(bytes, {
      subset: false,
      customName: sanitizePsName(psName),
    });
  } catch (e) {
    errors.push(new PipelineError(`Font embed failed: ${lf.family} (${String(e)})`));
    return undefined;
  }
}

// Open the font file once via fontkit to read its postscriptName. Returns
// undefined when the file isn't a font fontkit recognises -- the caller falls
// back to the family name, which is good enough for PDF lookup.
function readPostscriptName(bytes: Uint8Array): string | undefined {
  try {
    // Cast through unknown: @pdf-lib/fontkit's typings expose .create
    const f = (fontkit as unknown as { create: (b: Uint8Array) => { postscriptName?: string } }).create(bytes);
    return f.postscriptName ?? undefined;
  } catch {
    return undefined;
  }
}

// PostScript names may not contain whitespace or any of the delimiters used in
// PDF names (#$%(){}[]<>/) -- strip them so the BaseFont remains a valid name.
function sanitizePsName(name: string): string {
  return name.replace(/[\s\0\t\n\f\r#%/()<>[\]{}]/g, "");
}
