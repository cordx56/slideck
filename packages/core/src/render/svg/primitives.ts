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

// Append sans-serif so previews stay readable even if the declared font is unloaded.
function fontFamilyWithFallback(family: string): string {
  return `'${family.replace(/'/g, "")}', sans-serif`;
}

function strokeAttrs(stroke: Stroke | undefined): string {
  if (!stroke) return "";
  return ` stroke="${escapeXml(stroke.color)}" stroke-width="${num(stroke.width)}"`;
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
              r.font.weight ? ` font-weight="${r.font.weight}"` : ""
            }${
              r.font.style === "italic" ? ` font-style="italic"` : ""
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
