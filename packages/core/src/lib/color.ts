// 色の正規化と、テーマパレットキー解決。
// 色の値は "#rrggbb" / "#rgb" のリテラル、または theme.colors のキー。

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(s: string): boolean {
  return HEX_RE.test(s);
}

// "#abc" -> "#aabbcc"、小文字化。妥当でない場合は null。
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

// 色の値をパレット経由で具体的な hex に解決する。
// hex リテラルならそのまま正規化、キーならパレットを引く。
export function resolveColor(
  value: string,
  palette: Record<string, string>,
): string | null {
  const direct = normalizeHex(value);
  if (direct) return direct;
  const fromPalette = palette[value];
  if (fromPalette) {
    return normalizeHex(fromPalette) ?? fromPalette;
  }
  return null;
}

// #rrggbb -> {r,g,b} (0..1)。pdf-lib の rgb() 用。
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHex(hex) ?? "#000000";
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  return { r, g, b };
}
