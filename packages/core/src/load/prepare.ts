import type { MirDeck, MirElement, MirText } from "../ir/mir";
import type { AssetResolver } from "./assets";
import { FontkitMetrics, createFkFont, type FkFont } from "../lower/fontkit-metrics";
import type { FontMetrics } from "../lower/metrics";
import { ApproximateMetrics } from "../lower/metrics";
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

// Both the LoadedFont map (used by the web FontFace API + PDF embedding) and
// the fontkit map (used by metrics + PDF font lookup) are keyed by the same
// composite variant key (family|weight|style), so the lookups line up.
async function loadFonts(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[],
): Promise<Map<string, LoadedFont>> {
  const fonts = new Map<string, LoadedFont>();
  for (const [key, decl] of deck.fonts) {
    if (!decl.path) continue;
    try {
      let bytes = await resolver.readBytes(decl.path);
      // .ttc expands the font at the given index into a standalone SFNT.
      if (isTtc(bytes)) bytes = extractFontFromTtc(bytes, decl.index ?? 0);
      fonts.set(key, {
        family: decl.family,
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

// Build the fontkit map and detect a default mono family in a single pass.
function buildFkAndMono(fonts: Map<string, LoadedFont>): {
  fk: Map<string, FkFont>;
  defaultMono: string;
} {
  const fk = new Map<string, FkFont>();
  let defaultMono = "";
  for (const [key, lf] of fonts) {
    const f = createFkFont(lf.bytes);
    if (!f) continue;
    fk.set(key, f);
    if (!defaultMono && f.isFixedPitch) defaultMono = lf.family;
  }
  return { fk, defaultMono };
}

function buildMetrics(fk: Map<string, FkFont>): FontMetrics {
  return fk.size > 0 ? new FontkitMetrics(fk) : new ApproximateMetrics();
}

function walkTextElements(els: MirElement[], visit: (t: MirText) => void): void {
  for (const el of els) {
    if (el.type === "text") visit(el);
    else if (el.type === "group") walkTextElements(el.children, visit);
    else if (el.type === "ul" || el.type === "ol") walkTextElements(el.items, visit);
  }
}

// Asynchronously assemble the resources (images, fonts, metrics) passed to lower.
export async function prepare(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[] = [],
): Promise<PreparedAssets> {
  const fonts = await loadFonts(deck, resolver, errors);
  const { fk, defaultMono } = buildFkAndMono(fonts);
  const metrics = buildMetrics(fk);

  // If any registered font is monospace, adopt it as the default for inline code
  // (only where the deck/theme did not explicitly declare defaults.mono.family).
  if (defaultMono) {
    for (const s of deck.slides) {
      walkTextElements(s.elements, (t) => {
        if (t.rich && t.rich.monoFamily === "") t.rich.monoFamily = defaultMono;
      });
    }
  }

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

  const slide = { width: deck.slide.width, height: deck.slide.height };
  return { ctx: { metrics, images, slide }, fonts };
}
