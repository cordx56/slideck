import type { MirDeck } from "../ir/mir";
import { walkElements } from "../ir/walk";
import type { AssetResolver } from "./assets";
import { FontkitMetrics, createFkFont, type FkFont } from "../lower/fontkit-metrics";
import type { FontMetrics } from "../lower/metrics";
import { ApproximateMetrics } from "../lower/metrics";
import {
  type LoadedImage,
  type LoadedFont,
  type LowerCtx,
  type FontRoles,
  EMPTY_FONT_ROLES,
} from "../lower/context";
import { isTtc, extractFontFromTtc } from "./ttc";
import { mimeFromPath } from "../lib/mime";
import { imageSize } from "../lib/image-size";
import { PipelineError } from "../lib/error";
import { katexFonts } from "../lib/katex-fonts";

// Resource bundle for lower. fonts are also used for PDF embedding/preview registration.
export interface PreparedAssets {
  ctx: LowerCtx;
  fonts: Map<string, LoadedFont>;
}

// Collect every image src referenced by any slide.
function collectImageSrcs(deck: MirDeck): Set<string> {
  const srcs = new Set<string>();
  for (const slide of deck.slides) {
    walkElements(slide.elements, (el) => {
      if (el.type === "image") srcs.add(el.src);
    });
  }
  return srcs;
}

// Each LoadedFont is one declared face, keyed by family.
async function loadFonts(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[],
): Promise<Map<string, LoadedFont>> {
  const fonts = new Map<string, LoadedFont>();
  for (const [family, decl] of deck.fonts) {
    try {
      let bytes = await resolver.readBytes(decl.path);
      // .ttc expands the font at the given index into a standalone SFNT.
      if (isTtc(bytes)) bytes = extractFontFromTtc(bytes, decl.index ?? 0);
      fonts.set(family, { family, bytes });
    } catch (e) {
      errors.push(new PipelineError(`failed to load font: ${decl.path} (${String(e)})`));
    }
  }
  return fonts;
}

// Build the fontkit map and auto-detect mono / bold / italic / boldItalic role
// faces in a single pass. The first matching face for each role wins; explicit
// defaults.text.* / defaults.mono.family entries override this in lower.
function buildFkAndRoles(fonts: Map<string, LoadedFont>): {
  fk: Map<string, FkFont>;
  auto: FontRoles;
} {
  const fk = new Map<string, FkFont>();
  const auto: FontRoles = { ...EMPTY_FONT_ROLES };
  for (const [family, lf] of fonts) {
    const f = createFkFont(lf.bytes);
    if (!f) continue;
    fk.set(family, f);
    if (!auto.mono && f.isFixedPitch) auto.mono = family;
    if (!auto.boldItalic && f.isBold && f.isItalic) auto.boldItalic = family;
    else if (!auto.bold && f.isBold && !f.isItalic) auto.bold = family;
    else if (!auto.italic && f.isItalic && !f.isBold) auto.italic = family;
  }
  return { fk, auto };
}

function buildMetrics(fk: Map<string, FkFont>): FontMetrics {
  return fk.size > 0 ? new FontkitMetrics(fk) : new ApproximateMetrics();
}

// Asynchronously assemble the resources (images, fonts, metrics) passed to lower.
export async function prepare(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[] = [],
): Promise<PreparedAssets> {
  const fonts = await loadFonts(deck, resolver, errors);
  const { fk, auto } = buildFkAndRoles(fonts);
  const metrics = buildMetrics(fk);

  // KaTeX faces are renderer resources, not candidates for the deck's body,
  // bold, italic, or monospace roles. Add them only after role detection.
  for (const [family, font] of katexFonts()) fonts.set(family, font);

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
  return { ctx: { metrics, images, roles: auto, slide }, fonts };
}
