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
export function renderSvgString(
  lir: SlideLir,
  options: SvgRenderOptions = {},
): string {
  const { width, height } = lir;
  const defs = fontFaceStyle(options.fontFaces);
  const bg = lir.background
    ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(
        lir.background,
      )}"/>`
    : "";
  const body = lir.primitives.map(renderPrimitive).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">${defs}${bg}${body}</svg>`
  );
}

function fontFaceStyle(faces: FontFace[] | undefined): string {
  if (!faces || faces.length === 0) return "";
  const rules = faces
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";` +
        `${f.weight ? `font-weight:${f.weight};` : ""}` +
        `${f.style ? `font-style:${f.style};` : ""}` +
        `src:url(${f.dataUrl})${f.format ? ` format("${f.format}")` : ""};}`,
    )
    .join("");
  return `<defs><style>${rules}</style></defs>`;
}

// For browsers: parse the SVG string into an SVGElement and return it.
export function renderSvgElement(
  lir: SlideLir,
  options: SvgRenderOptions = {},
): SVGSVGElement {
  const str = renderSvgString(lir, options);
  const doc = new DOMParser().parseFromString(str, "image/svg+xml");
  return doc.documentElement as unknown as SVGSVGElement;
}
