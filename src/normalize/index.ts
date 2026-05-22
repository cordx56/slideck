import type { LoadedDeck } from "../load/resolve-refs";
import type { ThemeHir, HirElement } from "../ir/hir";
import type {
  MirDeck,
  MirElement,
  MirFont,
  MirSlide,
} from "../ir/mir";
import { PipelineError } from "../lib/error";
import { resolveColor } from "../lib/color";
import { buildVarContext, expandString, type VarContext } from "./variables";
import { pickTheme, composeSlideElements } from "./theme-apply";
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
  palette: Record<string, string>;
  fontKeyToFamily: Map<string, string>;
  textDefaults: ResolvedTextDefaults;
  errors: PipelineError[];
}

export function normalize(loaded: LoadedDeck): NormalizeResult {
  const errors: PipelineError[] = [];

  const fonts = buildFontRegistry(loaded.themes);
  const mainTheme = loaded.themes.get(loaded.defaultThemeName);
  const slideSize = mainTheme?.slide ?? DEFAULT_SLIDE;

  const slides: MirSlide[] = loaded.deck.slides.map((slide) => {
    const theme = pickTheme(loaded, slide, errors);
    const fontKeyToFamily = fontKeyMap(theme);
    const palette = theme.colors ?? {};
    const vars = buildVarContext(theme, loaded.deck.vars, slide.vars, errors);

    const textDefaults = resolveTextDefaultsFor(theme, fontKeyToFamily, palette);
    const ctx: ConvertCtx = {
      vars,
      palette,
      fontKeyToFamily,
      textDefaults,
      errors,
    };

    const composed = composeSlideElements(theme, slide, loaded.overlays);
    const elements = composed.map((el) => convertElement(el, ctx));

    const bgRaw = slide.background ?? theme.background;
    const background = bgRaw
      ? resolveColorLenient(expandString(bgRaw, vars, errors), palette)
      : undefined;

    return { id: slide.id, background, elements };
  });

  return {
    deck: { slide: slideSize, fonts, slides },
    errors,
  };
}

// 全テーマのフォント宣言を family 名で集約。
function buildFontRegistry(themes: Map<string, ThemeHir>): Map<string, MirFont> {
  const registry = new Map<string, MirFont>();
  for (const theme of themes.values()) {
    for (const decl of Object.values(theme.fonts ?? {})) {
      registry.set(decl.family, {
        family: decl.family,
        path: decl.path,
        weight: decl.weight,
        style: decl.style,
      });
    }
  }
  return registry;
}

// あるテーマの font キー -> family 名。
function fontKeyMap(theme: ThemeHir): Map<string, string> {
  const m = new Map<string, string>();
  for (const [key, decl] of Object.entries(theme.fonts ?? {})) {
    m.set(key, decl.family);
  }
  return m;
}

function resolveTextDefaultsFor(
  theme: ThemeHir,
  fontKeyToFamily: Map<string, string>,
  palette: Record<string, string>,
): ResolvedTextDefaults {
  const raw = resolveTextDefaults(theme.defaults?.text);
  return {
    ...raw,
    family: fontKeyToFamily.get(raw.family) ?? raw.family,
    color: resolveColorLenient(raw.color, palette),
  };
}

// 解決不能な色はそのまま通す (CSS 名や rgb() の可能性)。SVG では描画できる。
function resolveColorLenient(
  value: string,
  palette: Record<string, string>,
): string {
  return resolveColor(value, palette) ?? value;
}

function convertElement(hir: HirElement, ctx: ConvertCtx): MirElement {
  const exp = (s: string) => expandString(s, ctx.vars, ctx.errors);
  const color = (s: string) => resolveColorLenient(exp(s), ctx.palette);
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
  }
}
