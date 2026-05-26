import type { LoadedDeck } from "../load/resolve-refs";
import type { HirElement, TextDefaults, RichStyle } from "../ir/hir";
import type { MirDeck, MirElement, MirFont, MirSlide } from "../ir/mir";
import { PipelineError } from "../lib/error";
import { normalizeHex } from "../lib/color";
import { buildVarContext, expandString, type VarContext } from "./variables";
import {
  resolveAppliedBases,
  composeLayers,
  mergeColors,
  mergeFontKeys,
  pickBackground,
} from "./bases";
import { mergeSchemas } from "./schema-merge";
import { mergeDefaults, type MergedDefaults } from "./defaults-merge";
import { buildSystemVars } from "./system-vars";
import {
  DEFAULT_SLIDE,
  DEFAULT_FIT,
  DEFAULT_STROKE_WIDTH,
  GROUP_FALLBACK,
  resolveTextDefaults,
  type ResolvedTextDefaults,
} from "./defaults";

export interface NormalizeResult {
  deck?: MirDeck;
  errors: PipelineError[];
}

interface ConvertCtx {
  vars: VarContext;
  fontKeyToFamily: Map<string, string>;
  textDefaults: ResolvedTextDefaults;
  rich: RichStyle;
  errors: PipelineError[];
}

export function normalize(loaded: LoadedDeck): NormalizeResult {
  const errors: PipelineError[] = [];

  const fonts = buildFontRegistry(loaded);
  const slideSize = pickSlideSize(loaded);
  const slideCount = loaded.deck.slides.length;

  const slides: MirSlide[] = loaded.deck.slides.map((slide, i) => {
    const slideId = slide.id ?? `slide-${i + 1}`;
    const applied = resolveAppliedBases(loaded, slide, errors);

    const mergedVars = mergeSchemas(applied, errors);
    const mergedDefaults = mergeDefaults(applied);
    const colors = mergeColors(applied);
    const fontKeyToFamily = mergeFontKeys(applied);

    const systemVars = buildSystemVars({
      slideId,
      slideNumber: i + 1,
      slideCount,
      baseIds: applied.map((a) => a.id),
    });
    const vars = buildVarContext(
      mergedVars,
      systemVars,
      colors,
      loaded.deck.vars,
      slide.vars,
      errors,
    );

    const textDefaults = resolveTextDefaultsFor(mergedDefaults.text, fontKeyToFamily, vars, errors);
    const rich = resolveRichStyle(mergedDefaults, textDefaults, fontKeyToFamily, vars, errors);
    const ctx: ConvertCtx = {
      vars,
      fontKeyToFamily,
      textDefaults,
      rich,
      errors,
    };

    const composed = composeLayers(applied, slide);
    const elements = composed.map((el) => convertElement(el, ctx));

    const bgRaw = slide.background ?? pickBackground(applied);
    const background = bgRaw ? resolveColorLiteral(expandString(bgRaw, vars, errors)) : undefined;

    // id is optional. When unspecified, assign an index-derived id
    // (duplicate validation is already done in DeckSchema).
    return { id: slideId, background, elements };
  });

  return {
    deck: { slide: slideSize, fonts, slides },
    errors,
  };
}

// Aggregate font declarations from all bases. One entry per declared face,
// keyed by family (later declarations override earlier ones for the same
// family). Bold/italic faces are separate families and referenced from
// defaults.text.bold / .italic / .boldItalic.
function buildFontRegistry(loaded: LoadedDeck): Map<string, MirFont> {
  const registry = new Map<string, MirFont>();
  for (const base of loaded.basesById.values()) {
    for (const decl of Object.values(base.fonts ?? {})) {
      registry.set(decl.family, {
        family: decl.family,
        path: decl.path,
        index: decl.index,
      });
    }
  }
  return registry;
}

// Take the slide size from the first base with a slide, in deck.bases declaration order.
function pickSlideSize(loaded: LoadedDeck): { width: number; height: number } {
  for (const ref of loaded.deck.bases) {
    const base = loaded.basesById.get(ref.id);
    if (base?.slide) return base.slide;
  }
  return DEFAULT_SLIDE;
}

function resolveTextDefaultsFor(
  text: TextDefaults,
  fontKeyToFamily: Map<string, string>,
  vars: VarContext,
  errors: PipelineError[],
): ResolvedTextDefaults {
  const raw = resolveTextDefaults(text);
  return {
    ...raw,
    family: fontKeyToFamily.get(raw.family) ?? raw.family,
    color: resolveColorLiteral(expandString(raw.color, vars, errors)),
  };
}

// Final resolution of color fields: normalize hex, pass others (CSS names etc.) through.
// Palette key resolution is removed. Colors are specified by variable (${...}) or literal string.
function resolveColorLiteral(value: string): string {
  return normalizeHex(value) ?? value;
}

// Resolve the render style for links and code from defaults.link / defaults.mono.
function resolveRichStyle(
  d: MergedDefaults,
  td: ResolvedTextDefaults,
  fontKeyToFamily: Map<string, string>,
  vars: VarContext,
  errors: PipelineError[],
): RichStyle {
  const col = (s: string | undefined, fallback: string) =>
    s ? resolveColorLiteral(expandString(s, vars, errors)) : fallback;
  // Each role family is "" when not explicitly declared. prepare will back-fill
  // any empty role with an auto-detected face (post.isFixedPitch / OS-2 weight /
  // italicAngle); if nothing matches, the role keeps "" and the run renders in
  // the surrounding text font so the measured width matches the render.
  const fam = (s: string | undefined): string => {
    if (!s) return "";
    const e = expandString(s, vars, errors);
    return fontKeyToFamily.get(e) ?? e;
  };
  return {
    linkColor: col(d.link.color, td.color),
    linkUnderline: d.link.underline ?? true,
    monoFamily: fam(d.mono.family),
    monoColor: col(d.mono.color, td.color),
    boldFamily: fam(d.text.bold),
    italicFamily: fam(d.text.italic),
    boldItalicFamily: fam(d.text.boldItalic),
  };
}

function convertElement(hir: HirElement, ctx: ConvertCtx): MirElement {
  const exp = (s: string) => expandString(s, ctx.vars, ctx.errors);
  const color = (s: string) => resolveColorLiteral(exp(s));
  const resolveFont = (raw: string) => ctx.fontKeyToFamily.get(raw) ?? raw;

  switch (hir.type) {
    case "text": {
      const td = ctx.textDefaults;
      return {
        type: "text",
        position: hir.position,
        flex: hir.flex,
        text: exp(hir.text),
        font: hir.font ? resolveFont(exp(hir.font)) : td.family,
        size: hir.size ?? td.size,
        color: hir.color ? color(hir.color) : td.color,
        align: hir.align ?? td.align,
        lineHeight: hir.lineHeight ?? td.lineHeight,
        letterSpacing: hir.letterSpacing ?? td.letterSpacing,
        rich: ctx.rich,
      };
    }
    case "image":
      return {
        type: "image",
        position: hir.position,
        flex: hir.flex,
        src: exp(hir.src),
        fit: hir.fit ?? DEFAULT_FIT,
      };
    case "rect": {
      const stroke = hir.stroke ? color(hir.stroke) : undefined;
      return {
        type: "rect",
        position: hir.position,
        flex: hir.flex,
        fill: hir.fill ? color(hir.fill) : undefined,
        stroke,
        strokeWidth: hir.strokeWidth ?? (stroke ? DEFAULT_STROKE_WIDTH : 0),
        rx: hir.rx ?? 0,
      };
    }
    case "line":
      return {
        type: "line",
        from: hir.from,
        to: hir.to,
        stroke: hir.stroke ? color(hir.stroke) : ctx.textDefaults.color,
        strokeWidth: hir.strokeWidth ?? DEFAULT_STROKE_WIDTH,
      };
    case "path": {
      const stroke = hir.stroke ? color(hir.stroke) : undefined;
      return {
        type: "path",
        position: hir.position,
        d: exp(hir.d),
        fill: hir.fill ? color(hir.fill) : undefined,
        stroke,
        strokeWidth: hir.strokeWidth ?? (stroke ? DEFAULT_STROKE_WIDTH : 0),
      };
    }
    case "group":
      return {
        type: "group",
        position: hir.position,
        flex: hir.flex,
        children: hir.children.map((c) => convertElement(c, ctx)),
        layout: hir.layout,
        gap: hir.gap ?? { kind: "percent", value: 0 },
        align: hir.align ?? GROUP_FALLBACK.align,
        justify: hir.justify ?? GROUP_FALLBACK.justify,
        padding: hir.padding ?? { kind: "percent", value: 0 },
      };
    case "ul":
    case "ol": {
      const td = ctx.textDefaults;
      const size = hir.size ?? td.size;
      // A list's size becomes the default text size for its items (overridable per item).
      const itemCtx: ConvertCtx =
        hir.size !== undefined ? { ...ctx, textDefaults: { ...td, size } } : ctx;
      return {
        type: hir.type,
        position: hir.position,
        flex: hir.flex,
        items: hir.items.map((c) => convertElement(c, itemCtx)),
        gap: hir.gap ?? { kind: "percent", value: 0 },
        align: hir.align ?? GROUP_FALLBACK.align,
        padding: hir.padding ?? { kind: "percent", value: 0 },
        font: hir.font ? resolveFont(exp(hir.font)) : td.family,
        size,
        color: hir.color ? color(hir.color) : td.color,
        start: hir.start ?? 1,
      };
    }
  }
}
