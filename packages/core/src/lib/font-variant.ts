// Composite key for one font variant: family + weight + style. Lets the font
// registry, metrics, and PDF embed table store multiple variants per family
// (e.g. NotoSans regular + bold) and look up by exact variant.

export const FONT_REGULAR = 400;
export type FontStyle = "normal" | "italic";

export function fontVariantKey(family: string, weight?: number, style?: FontStyle): string {
  return `${family}|${weight ?? FONT_REGULAR}|${style ?? "normal"}`;
}
