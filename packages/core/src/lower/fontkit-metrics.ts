import fontkit from "@pdf-lib/fontkit";
import { ApproximateMetrics, type FontMetrics } from "./metrics";

// fontkit が返す Font の必要部分のみ型付け。
interface FkFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  layout(s: string): { advanceWidth: number };
}

// バイト列から fontkit Font を生成する。失敗時 (CFF/破損等) は undefined。
export function createFkFont(bytes: Uint8Array): FkFont | undefined {
  try {
    const f = fontkit.create(bytes as unknown as Buffer);
    // FontCollection (.ttc) は対象外。layout を持つ単一 Font のみ。
    if (f && typeof (f as unknown as FkFont).layout === "function") {
      return f as unknown as FkFont;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// 実フォントの glyph advance で計測するメトリクス。SVG と PDF の
// 折り返し結果を一致させるための要。未ロードの family は近似にフォールバック。
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
