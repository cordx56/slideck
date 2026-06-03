import type { LoadedDeck } from "../load/resolve-refs";
import type { FigureElement, HirElement, TextDefaults, RichStyle } from "../ir/hir";
import type { FigureLabel, MirDeck, MirElement, MirFont, MirSlide } from "../ir/mir";
import { PipelineError } from "../lib/error";
import { toHex } from "../lib/color";
import { buildVarContext, expandString, resolveNumber, type VarContext } from "./variables";
import { resolveAppliedBases, composeLayers, mergeColors, pickBackground } from "./bases";
import { mergeSchemas } from "./schema-merge";
import { mergeDefaults, type MergedDefaults } from "./defaults-merge";
import { buildSystemVars } from "./system-vars";
import {
  DEFAULT_SLIDE,
  DEFAULT_FIT,
  DEFAULT_STROKE_WIDTH,
  GROUP_FALLBACK,
  TEXT_FALLBACK,
  mergeTextDefaults,
  type ResolvedTextDefaults,
} from "./defaults";

export interface NormalizeResult {
  deck?: MirDeck;
  errors: PipelineError[];
}

interface ConvertCtx {
  vars: VarContext;
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

    const textDefaults = resolveTextDefaultsFor(mergedDefaults.text, vars, errors);
    const rich = resolveRichStyle(mergedDefaults, textDefaults, vars, errors);
    const ctx: ConvertCtx = {
      vars,
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
    for (const [key, decl] of Object.entries(base.fonts ?? {})) {
      // The YAML key IS the CSS family. defaults.text.family / .bold etc.
      // reference the same key. Last declaration wins for a given key.
      registry.set(key, { family: key, path: decl.path, index: decl.index });
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
  vars: VarContext,
  errors: PipelineError[],
): ResolvedTextDefaults {
  const m = mergeTextDefaults(text);
  // size / lineHeight / letterSpacing may be "${var}" -- expand them now so
  // the rest of normalize sees a plain number. The fallback step in the
  // merge guarantees a non-undefined input, so resolveNumber's ?? branch
  // here only matters if the variable expansion itself failed.
  return {
    family: m.family,
    // family is the fonts: key (= CSS family) as-is. No key->family translation.
    color: resolveColorLiteral(expandString(m.color, vars, errors)),
    align: m.align,
    size:
      resolveNumber(m.size, vars, errors, { field: "defaults.text.size", positive: true }) ??
      TEXT_FALLBACK.size,
    lineHeight:
      resolveNumber(m.lineHeight, vars, errors, {
        field: "defaults.text.lineHeight",
        positive: true,
      }) ?? TEXT_FALLBACK.lineHeight,
    letterSpacing:
      resolveNumber(m.letterSpacing, vars, errors, { field: "defaults.text.letterSpacing" }) ??
      TEXT_FALLBACK.letterSpacing,
  };
}

// Final resolution of color fields: normalize hex, pass others (CSS names etc.) through.
// Palette key resolution is removed. Colors are specified by variable (${...}) or literal string.
// Normalize hex / CSS named colors to canonical "#rrggbb" so renderers
// (especially PDF, which only takes rgb) always get a hex. Unknown strings
// pass through unchanged (the SVG renderer will still try its luck).
function resolveColorLiteral(value: string): string {
  return toHex(value) ?? value;
}

// Resolve the render style for links and code from defaults.link / defaults.mono.
function resolveRichStyle(
  d: MergedDefaults,
  td: ResolvedTextDefaults,
  vars: VarContext,
  errors: PipelineError[],
): RichStyle {
  const col = (s: string | undefined, fallback: string) =>
    s ? resolveColorLiteral(expandString(s, vars, errors)) : fallback;
  // Each role family is "" when not explicitly declared. prepare will back-fill
  // any empty role with an auto-detected face (post.isFixedPitch / OS-2 weight /
  // italicAngle); if nothing matches, the role keeps "" and the run renders in
  // the surrounding text font so the measured width matches the render.
  const fam = (s: string | undefined): string => (s ? expandString(s, vars, errors) : "");
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

// Resolve a figure's label fields against ctx.textDefaults. Returns undefined
// when no `text` is set, so the label is opt-in per figure.
function buildFigureLabel(
  hir: FigureElement,
  ctx: ConvertCtx,
  exp: (s: string) => string,
  color: (s: string) => string,
  resolveFont: (raw: string) => string,
): FigureLabel | undefined {
  if (hir.text === undefined) return undefined;
  const size =
    resolveNumber(hir.textSize, ctx.vars, ctx.errors, { field: "textSize", positive: true }) ??
    ctx.textDefaults.size;
  const padding =
    resolveNumber(hir.textPadding, ctx.vars, ctx.errors, {
      field: "textPadding",
      nonnegative: true,
    }) ?? size * 0.4;
  return {
    content: exp(hir.text),
    font: hir.textFont ? resolveFont(exp(hir.textFont)) : ctx.textDefaults.family,
    size,
    color: hir.textColor ? color(hir.textColor) : ctx.textDefaults.color,
    // Sensible default proportional to size; user can override for tighter or
    // looser breaks around the text when it sits on a line/arrow.
    padding,
  };
}

function convertElement(hir: HirElement, ctx: ConvertCtx): MirElement {
  const exp = (s: string) => expandString(s, ctx.vars, ctx.errors);
  const color = (s: string) => resolveColorLiteral(exp(s));
  // Font references in elements are CSS family names (= fonts: keys), no translation.
  const resolveFont = (raw: string) => raw;
  // Compact wrapper around resolveNumber for the common per-field idiom; the
  // field name is purely for error messages so users can locate the culprit.
  const num = (
    v: number | string | undefined,
    field: string,
    opts?: { positive?: boolean; nonnegative?: boolean; integer?: boolean },
  ) => resolveNumber(v, ctx.vars, ctx.errors, { field, ...opts });
  const flex = (v: number | string | undefined) => num(v, "flex");

  switch (hir.type) {
    case "text": {
      const td = ctx.textDefaults;
      return {
        type: "text",
        position: hir.position,
        flex: flex(hir.flex),
        text: exp(hir.text),
        font: hir.font ? resolveFont(exp(hir.font)) : td.family,
        size: num(hir.size, "size", { positive: true }) ?? td.size,
        color: hir.color ? color(hir.color) : td.color,
        align: hir.align ?? td.align,
        lineHeight: num(hir.lineHeight, "lineHeight", { positive: true }) ?? td.lineHeight,
        letterSpacing: num(hir.letterSpacing, "letterSpacing") ?? td.letterSpacing,
        rich: ctx.rich,
      };
    }
    case "image":
      return {
        type: "image",
        position: hir.position,
        flex: flex(hir.flex),
        src: exp(hir.src),
        fit: hir.fit ?? DEFAULT_FIT,
      };
    case "figure": {
      // One HIR shape primitive -> a specific MIR variant per shape.
      const stroke = hir.stroke ? color(hir.stroke) : undefined;
      const strokeW =
        num(hir.strokeWidth, "strokeWidth", { nonnegative: true }) ??
        (stroke ? DEFAULT_STROKE_WIDTH : 0);
      const lineStroke = () => (hir.stroke ? color(hir.stroke) : ctx.textDefaults.color);
      const lineW = num(hir.strokeWidth, "strokeWidth", { nonnegative: true }) ?? DEFAULT_STROKE_WIDTH;
      const label = buildFigureLabel(hir, ctx, exp, color, resolveFont);
      switch (hir.shape) {
        case "rect":
          return {
            type: "rect",
            position: hir.position,
            flex: flex(hir.flex),
            fill: hir.fill ? color(hir.fill) : undefined,
            stroke,
            strokeWidth: strokeW,
            rx: num(hir.rx, "rx", { nonnegative: true }) ?? 0,
            label,
          };
        case "circle":
          return {
            type: "circle",
            position: hir.position,
            flex: flex(hir.flex),
            fill: hir.fill ? color(hir.fill) : undefined,
            stroke,
            strokeWidth: strokeW,
            label,
          };
        case "line":
          return {
            type: "line",
            flex: flex(hir.flex),
            from: hir.from ?? {
              x: { kind: "percent", value: 0 },
              y: { kind: "percent", value: 0 },
            },
            to: hir.to ?? {
              x: { kind: "percent", value: 100 },
              y: { kind: "percent", value: 100 },
            },
            stroke: lineStroke(),
            strokeWidth: lineW,
            fill: hir.fill ? color(hir.fill) : undefined,
            label,
          };
        case "arrow":
          return {
            type: "arrow",
            flex: flex(hir.flex),
            from: hir.from ?? {
              x: { kind: "percent", value: 0 },
              y: { kind: "percent", value: 0 },
            },
            to: hir.to ?? {
              x: { kind: "percent", value: 100 },
              y: { kind: "percent", value: 100 },
            },
            stroke: lineStroke(),
            strokeWidth: lineW,
            arrowSize:
              num(hir.arrowSize, "arrowSize", { positive: true }) ?? 3 * lineW,
            fill: hir.fill ? color(hir.fill) : undefined,
            label,
          };
      }
    }
    case "path": {
      const stroke = hir.stroke ? color(hir.stroke) : undefined;
      return {
        type: "path",
        position: hir.position,
        d: exp(hir.d),
        fill: hir.fill ? color(hir.fill) : undefined,
        stroke,
        strokeWidth:
          num(hir.strokeWidth, "strokeWidth", { nonnegative: true }) ??
          (stroke ? DEFAULT_STROKE_WIDTH : 0),
      };
    }
    case "group":
      return {
        type: "group",
        position: hir.position,
        flex: flex(hir.flex),
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
      const size = num(hir.size, "size", { positive: true }) ?? td.size;
      // A list's size becomes the default text size for its items (overridable per item).
      const itemCtx: ConvertCtx =
        hir.size !== undefined ? { ...ctx, textDefaults: { ...td, size } } : ctx;
      return {
        type: hir.type,
        position: hir.position,
        flex: flex(hir.flex),
        items: hir.items.map((c) => convertElement(c, itemCtx)),
        gap: hir.gap ?? { kind: "percent", value: 0 },
        align: hir.align ?? GROUP_FALLBACK.align,
        padding: hir.padding ?? { kind: "percent", value: 0 },
        font: hir.font ? resolveFont(exp(hir.font)) : td.family,
        size,
        color: hir.color ? color(hir.color) : td.color,
        start: num(hir.start, "start", { integer: true }) ?? 1,
      };
    }
  }
}
