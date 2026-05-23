import fontkit from "@pdf-lib/fontkit";
import { ApproximateMetrics, type FontMetrics } from "./metrics";

// Type only the parts of fontkit's Font that we need.
interface FkFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  layout(s: string): { advanceWidth: number };
}

// Create a fontkit Font from bytes. Returns undefined on failure (CFF/corrupt/etc).
export function createFkFont(bytes: Uint8Array): FkFont | undefined {
  try {
    const f = fontkit.create(bytes as unknown as Buffer);
    // FontCollection (.ttc) is out of scope. Only a single Font with layout.
    if (f && typeof (f as unknown as FkFont).layout === "function") {
      return f as unknown as FkFont;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Metrics that measure with real font glyph advances. Key to making SVG and PDF
// wrapping results match. Unloaded families fall back to approximation.
export class FontkitMetrics implements FontMetrics {
  private approx = new ApproximateMetrics();

  constructor(private fonts: Map<string, FkFont>) {}

  measure(text: string, family: string, size: number): number {
    const f = this.fonts.get(family);
    if (!f) return this.approx.measure(text, family, size);
    try {
      return (f.layout(text).advanceWidth / f.unitsPerEm) * size;
    } catch {
      return this.approx.measure(text, family, size);
    }
  }

  ascentRatio(family: string): number {
    const f = this.fonts.get(family);
    if (!f) return this.approx.ascentRatio();
    return f.ascent / f.unitsPerEm;
  }
}
