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
  // Subset to keep the PDF small. pdf-lib's subsetter strips cmap from the
  // output (PDF doesn't need it for CIDFontType2), but macOS Preview rejects
  // cmap-less embeds and falls back to a system font. font-postprocess.ts
  // patches the saved PDF afterwards: a minimal cmap is added back so every
  // viewer can load the font program -- see ttf-cmap.ts for the format.
  // BaseFont uses the spec-mandated "AAAAAA+PSName" form for subset fonts.
  const psName = readPostscriptName(bytes) ?? lf.family;
  try {
    return await pdf.embedFont(bytes, {
      subset: true,
      customName: `${subsetTag(lf.family, bytes)}+${sanitizePsName(psName)}`,
    });
  } catch {
    try {
      // Some CFF subsets fail in pdf-lib; fall back to full embed (no tag --
      // the "+" prefix is reserved for subsets per PDF 9.6.4).
      return await pdf.embedFont(bytes, {
        subset: false,
        customName: sanitizePsName(psName),
      });
    } catch (e) {
      errors.push(new PipelineError(`Font embed failed: ${lf.family} (${String(e)})`));
      return undefined;
    }
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

// PDF 9.6.4: six uppercase letters acting as a unique subset tag. Deterministic
// per (family, font header bytes) so the same input yields the same tag, which
// keeps PDF diffs between runs stable.
function subsetTag(family: string, bytes: Uint8Array): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < family.length; i++) {
    h ^= family.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const sampleEnd = Math.min(64, bytes.length);
  for (let i = 0; i < sampleEnd; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  let tag = "";
  let v = h >>> 0;
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (v % 26));
    v = Math.floor(v / 26);
  }
  return tag;
}
