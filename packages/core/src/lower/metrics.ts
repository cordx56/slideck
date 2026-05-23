// Font measurement abstraction. To get the same shaping result in SVG and PDF,
// lower uses this interface without depending on a concrete font backend.
// Phase 1 uses approximate metrics; Phase 2 can swap in a real-font (fontkit) version.

export interface FontMetrics {
  // advance width (px) when text is drawn at font/size.
  measure(text: string, font: string, size: number): number;
  // ratio by which the baseline drops from the text line box top (px = ratio * size).
  ascentRatio(font: string): number;
}

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
  measure(text: string, _font: string, size: number): number {
    let w = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      w += charWidthRatio(ch, code) * size;
    }
    return w;
  }

  ascentRatio(): number {
    return 0.8;
  }
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
