// Font measurement abstraction. To get the same shaping result in SVG and PDF,
// lower uses this interface without depending on a concrete font backend.
// Phase 1 uses approximate metrics; Phase 2 can swap in a real-font (fontkit) version.

export interface FontMetrics {
  // advance width (px) when text is drawn at font/size.
  // weight/style select the exact variant; missing variant falls back to regular.
  measure(text: string, font: string, size: number, weight?: number, style?: FontStyle): number;
  // ratio by which the baseline drops from the text line box top (px = ratio * size).
  ascentRatio(font: string): number;
  // True iff the exact variant is loaded (no fallback). Used by rich-shaping to
  // decide whether to emit bold/italic on a run (only when an exact face exists,
  // so the measured width matches the rendered glyphs).
  has(font: string, weight?: number, style?: FontStyle): boolean;
}

export type FontStyle = "normal" | "italic";

function isCJK(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x30ff) || // punctuation, hiragana, katakana
    (code >= 0x3400 && code <= 0x9fff) || // CJK unified ideographs (incl. ext A)
    (code >= 0xf900 && code <= 0xfaff) || // compatibility ideographs
    (code >= 0xff00 && code <= 0xffef) // fullwidth alphanumerics and symbols
  );
}

// Approximate metrics without a font file. fullwidth=1em, ASCII uses per-class
// estimated widths. Makes wrapping work where no real font exists (tests/initial preview).
export class ApproximateMetrics implements FontMetrics {
  measure(text: string, font: string, size: number): number {
    // Monospace fonts advance every glyph equally; model that so the measured
    // width matches what the browser/PDF renders for a generic monospace font
    // (otherwise text after inline code is mispositioned and overlaps it).
    const mono = /mono/i.test(font);
    let w = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      w += (mono ? monoWidthRatio(code) : charWidthRatio(ch, code)) * size;
    }
    return w;
  }

  ascentRatio(): number {
    return 0.8;
  }

  // No fonts are loaded for the approximate path -> no exact variant exists.
  has(): boolean {
    return false;
  }
}

// Fixed advance for monospace: ~0.6em per glyph (typical), fullwidth = 2 cells.
function monoWidthRatio(code: number): number {
  return isCJK(code) ? 1.2 : 0.6;
}

function charWidthRatio(ch: string, code: number): number {
  if (isCJK(code)) return 1.0;
  if (ch === " ") return 0.28;
  if (ch === "\t") return 1.0;
  if (/[iIl.,:;'!|]/.test(ch)) return 0.28;
  if (/[mwMW]/.test(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.65;
  if (/[0-9]/.test(ch)) return 0.55;
  return 0.5;
}

export { isCJK };
