import type { Primitive, Stroke } from "../../ir/lir";
import { dataUri } from "../../lib/base64";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function num(n: number): string {
  // Drop unneeded digits to keep the SVG readable.
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

// CSS generic family keywords must stay unquoted to select the browser's generic
// font (a quoted "monospace" is read as a literal family name and falls through
// to the fallback). Named families are quoted with a generic fallback so the
// preview stays readable even if the declared font is unloaded.
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "math",
]);

function fontFamilyWithFallback(family: string): string {
  if (GENERIC_FAMILIES.has(family)) return family;
  const fallback = /mono/i.test(family) ? "monospace" : "sans-serif";
  return `'${family.replace(/'/g, "")}', ${fallback}`;
}

function strokeAttrs(stroke: Stroke | undefined): string {
  if (!stroke) return "";
  return ` stroke="${escapeXml(stroke.color)}" stroke-width="${num(stroke.width)}"`;
}

// CSS / browsers use ~14 deg for synthetic italic; horizontal advance is
// unaffected so the measured layout still matches.
const ITALIC_SKEW = Math.tan((14 * Math.PI) / 180);

// SkewX around the baseline (y = baselineY). The transform sends
// (x, y) -> (x - K*(y - baselineY), y), keeping the baseline fixed and tilting
// the top of the glyph to the right (italic appearance).
function italicSkewAttr(baselineY: number): string {
  return ` transform="matrix(1 0 ${num(-ITALIC_SKEW)} 1 ${num(ITALIC_SKEW * baselineY)} 0)"`;
}

// Turn a single LIR primitive into an SVG markup string.
export function renderPrimitive(p: Primitive): string {
  switch (p.kind) {
    case "text":
      return p.runs
        .map(
          (r) =>
            `<text x="${num(r.x)}" y="${num(r.y)}" font-family="${escapeXml(
              fontFamilyWithFallback(r.font.family),
            )}" font-size="${num(r.size)}" fill="${escapeXml(r.color)}"${
              r.font.italic ? italicSkewAttr(r.y) : ""
            }>${escapeXml(r.text)}</text>`,
        )
        .join("");
    case "image":
      return `<image x="${num(p.x)}" y="${num(p.y)}" width="${num(
        p.w,
      )}" height="${num(p.h)}" preserveAspectRatio="none" href="${dataUri(p.mime, p.data)}"/>`;
    case "rect":
      return `<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(
        p.w,
      )}" height="${num(p.h)}"${p.rx ? ` rx="${num(p.rx)}"` : ""} fill="${
        p.fill ? escapeXml(p.fill) : "none"
      }"${strokeAttrs(p.stroke)}/>`;
    case "line":
      return `<line x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(
        p.x2,
      )}" y2="${num(p.y2)}"${strokeAttrs(p.stroke)}/>`;
    case "path":
      return `<path d="${escapeXml(p.d)}" fill="${
        p.fill ? escapeXml(p.fill) : "none"
      }"${strokeAttrs(p.stroke)}/>`;
    case "circle":
      return `<circle cx="${num(p.cx)}" cy="${num(p.cy)}" r="${num(p.r)}" fill="${
        p.fill ? escapeXml(p.fill) : "none"
      }"${strokeAttrs(p.stroke)}/>`;
    case "link":
      // Click region: a transparent rect wrapped in <a> (for SVG opened in a browser).
      return (
        `<a href="${escapeXml(p.href)}" target="_blank" rel="noopener">` +
        `<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(
          p.h,
        )}" fill="transparent" pointer-events="all"/>` +
        `</a>`
      );
  }
}
