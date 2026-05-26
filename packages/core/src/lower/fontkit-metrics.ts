import fontkit from "@pdf-lib/fontkit";
import { ApproximateMetrics, type FontMetrics } from "./metrics";

// Type only the parts of fontkit's Font that we need.
export interface FkFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  // True for fonts whose post table declares fixed-pitch (monospace).
  isFixedPitch: boolean;
  layout(s: string): { advanceWidth: number };
}

// Internal: fontkit's font with the post-table fields we read.
interface FkRawFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  post?: { isFixedPitch?: number | boolean };
  layout(s: string): { advanceWidth: number };
}

// Create a fontkit Font from bytes. Returns undefined on failure (CFF/corrupt/etc).
export function createFkFont(bytes: Uint8Array): FkFont | undefined {
  try {
    const f = fontkit.create(bytes as unknown as Buffer) as unknown as FkRawFont;
    // FontCollection (.ttc) is out of scope. Only a single Font with layout.
    if (!f || typeof f.layout !== "function") return undefined;
    return {
      unitsPerEm: f.unitsPerEm,
      ascent: f.ascent,
      descent: f.descent,
      isFixedPitch: !!f.post?.isFixedPitch,
      layout: f.layout.bind(f),
    };
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
