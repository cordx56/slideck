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

// Each LoadedFont is one declared face, keyed by family.
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
      fonts.set(family, { family, bytes });
    } catch (e) {
      errors.push(new PipelineError(`failed to load font: ${decl.path} (${String(e)})`));
    }
  }
  return fonts;
}

interface AutoRoles {
  mono: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

// Build the fontkit map and auto-detect mono / bold / italic / boldItalic role
// faces in a single pass. The first matching face for each role wins; explicit
// defaults.text.* / defaults.mono.family entries override this in normalize.
function buildFkAndRoles(fonts: Map<string, LoadedFont>): {
  fk: Map<string, FkFont>;
  auto: AutoRoles;
} {
  const fk = new Map<string, FkFont>();
  const auto: AutoRoles = { mono: "", bold: "", italic: "", boldItalic: "" };
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
  const { fk, auto } = buildFkAndRoles(fonts);
  const metrics = buildMetrics(fk);

  // Back-fill role families that the theme did not declare with the auto-
  // detected face for that role (mono, bold, italic, boldItalic). Without a
  // matching face the role stays "" and rich-shaping uses the surrounding text
  // font, so the rendered glyphs always match the measured width.
  for (const s of deck.slides) {
    walkTextElements(s.elements, (t) => {
      const r = t.rich;
      if (!r) return;
      if (!r.monoFamily) r.monoFamily = auto.mono;
      if (!r.boldFamily) r.boldFamily = auto.bold;
      if (!r.italicFamily) r.italicFamily = auto.italic;
      if (!r.boldItalicFamily) r.boldItalicFamily = auto.boldItalic;
    });
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
