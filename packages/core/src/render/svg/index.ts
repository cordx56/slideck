import type { SlideLir } from "../../ir/lir";
import { renderPrimitive, escapeXml } from "./primitives";

export interface FontFace {
  family: string;
  dataUrl: string;
  weight?: number;
  style?: "normal" | "italic";
  format?: string; // e.g. "truetype"
}

export interface SvgRenderOptions {
  // @font-face entries to embed (system fonts if unspecified).
  fontFaces?: FontFace[];
}

// Render an LIR slide to a self-contained SVG string (pure function).
export function renderSvgString(lir: SlideLir, options: SvgRenderOptions = {}): string {
  const { width, height } = lir;
  const defs = fontFaceStyle(options.fontFaces);
  const bg = lir.background
    ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(lir.background)}"/>`
    : "";
  const body = lir.primitives.map(renderPrimitive).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">${defs}${bg}${body}</svg>`
  );
}

// The generated SVG is injected with {@html}, so nothing deck-controlled may
// break out of the CSS string / <style> element. Every value below is either
// validated or escaped before interpolation.
const FONT_FORMATS = new Set(["truetype", "opentype", "woff", "woff2", "svg", "embedded-opentype"]);

// CSS-escape into a quoted string: neutralize the chars that could end the CSS
// string or the surrounding style element (HTML/XML); all other Unicode is kept.
const cssFamily = (name: string): string =>
  `"${name.replace(/[\u0000-\u001f"\\<>&]/g, (c) => "\\" + c.codePointAt(0)!.toString(16) + " ")}"`;

// Accept only a base64 data: URL; reject anything that could contain ")" or
// whitespace and escape the url() context. Returns null to drop the src.
const fontDataUrl = (url: string): string | null =>
  /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]*$/.test(url) ? url : null;

function fontFaceStyle(faces: FontFace[] | undefined): string {
  if (!faces || faces.length === 0) return "";
  const rules = faces
    .map((f) => {
      const url = fontDataUrl(f.dataUrl);
      if (!url) return "";
      const weight =
        typeof f.weight === "number" && Number.isFinite(f.weight) ? `font-weight:${f.weight};` : "";
      const style = f.style === "italic" || f.style === "normal" ? `font-style:${f.style};` : "";
      const fmt = f.format && FONT_FORMATS.has(f.format) ? ` format("${f.format}")` : "";
      return `@font-face{font-family:${cssFamily(f.family)};${weight}${style}src:url(${url})${fmt};}`;
    })
    .filter(Boolean)
    .join("");
  return rules ? `<defs><style>${rules}</style></defs>` : "";
}

// For browsers: parse the SVG string into an SVGElement and return it.
export function renderSvgElement(lir: SlideLir, options: SvgRenderOptions = {}): SVGSVGElement {
  const str = renderSvgString(lir, options);
  const doc = new DOMParser().parseFromString(str, "image/svg+xml");
  return doc.documentElement as unknown as SVGSVGElement;
}
