import type { MirDeck, MirElement } from "../ir/mir";
import type { AssetResolver } from "./assets";
import type { FontMetrics } from "../lower/metrics";
import { ApproximateMetrics } from "../lower/metrics";
import { FontkitMetrics, createFkFont } from "../lower/fontkit-metrics";
import type { LoadedImage, LoadedFont, LowerCtx } from "../lower/context";
import { isTtc, extractFontFromTtc } from "./ttc";
import { mimeFromPath } from "../lib/mime";
import { imageSize } from "../lib/image-size";
import { PipelineError } from "../lib/error";

// Resource bundle for lower. fonts are also used for PDF embedding/preview registration.
export interface PreparedAssets {
  ctx: LowerCtx;
  fonts: Map<string, LoadedFont>;
}

// Walk the element tree of all slides and collect image src values.
function collectImageSrcs(deck: MirDeck): Set<string> {
  const srcs = new Set<string>();
  const walk = (els: MirElement[]) => {
    for (const el of els) {
      if (el.type === "image") srcs.add(el.src);
      else if (el.type === "group") walk(el.children);
      else if (el.type === "ul" || el.type === "ol") walk(el.items);
    }
  };
  for (const s of deck.slides) walk(s.elements);
  return srcs;
}

async function loadFonts(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[],
): Promise<Map<string, LoadedFont>> {
  const fonts = new Map<string, LoadedFont>();
  for (const [family, decl] of deck.fonts) {
    if (!decl.path) continue;
    try {
      let bytes = await resolver.readBytes(decl.path);
      // .ttc expands the font at the given index into a standalone SFNT.
      if (isTtc(bytes)) bytes = extractFontFromTtc(bytes, decl.index ?? 0);
      fonts.set(family, {
        family,
        bytes,
        weight: decl.weight,
        style: decl.style,
      });
    } catch (e) {
      errors.push(new PipelineError(`failed to load font: ${decl.path} (${String(e)})`));
    }
  }
  return fonts;
}

function buildMetrics(fonts: Map<string, LoadedFont>): FontMetrics {
  if (fonts.size === 0) return new ApproximateMetrics();
  const fk = new Map();
  for (const [family, lf] of fonts) {
    const font = createFkFont(lf.bytes);
    if (font) fk.set(family, font);
  }
  return fk.size > 0 ? new FontkitMetrics(fk) : new ApproximateMetrics();
}

// Asynchronously assemble the resources (images, fonts, metrics) passed to lower.
export async function prepare(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[] = [],
): Promise<PreparedAssets> {
  const fonts = await loadFonts(deck, resolver, errors);
  const metrics = buildMetrics(fonts);

  const images = new Map<string, LoadedImage>();
  for (const src of collectImageSrcs(deck)) {
    try {
      const data = await resolver.readBytes(src);
      const mime = mimeFromPath(src);
      const { width, height } = imageSize(data);
      images.set(src, { data, mime, width, height });
    } catch (e) {
      errors.push(new PipelineError(`failed to load image: ${src} (${String(e)})`));
    }
  }

  return { ctx: { metrics, images }, fonts };
}
