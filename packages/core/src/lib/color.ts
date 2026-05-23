// Color normalization and theme palette key resolution.
// A color value is a "#rrggbb" / "#rgb" literal, or a theme.colors key.

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(s: string): boolean {
  return HEX_RE.test(s);
}

// "#abc" -> "#aabbcc", lowercased. Returns null if invalid.
export function normalizeHex(s: string): string | null {
  if (!HEX_RE.test(s)) return null;
  let hex = s.slice(1).toLowerCase();
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex}`;
}

// Resolve a color value to a concrete hex via the palette.
// A hex literal is normalized as-is; a key is looked up in the palette.
export function resolveColor(value: string, palette: Record<string, string>): string | null {
  const direct = normalizeHex(value);
  if (direct) return direct;
  const fromPalette = palette[value];
  if (fromPalette) {
    return normalizeHex(fromPalette) ?? fromPalette;
  }
  return null;
}

// #rrggbb -> {r,g,b} (0..1). For pdf-lib's rgb().
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHex(hex) ?? "#000000";
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  return { r, g, b };
}
