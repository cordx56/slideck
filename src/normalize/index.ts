import type { LoadedDeck } from "../load/resolve-refs";
import type { HirElement, TextDefaults } from "../ir/hir";
import type {
  MirDeck,
  MirElement,
  MirFont,
  MirSlide,
} from "../ir/mir";
import { PipelineError } from "../lib/error";
import { resolveColor } from "../lib/color";
import { buildVarContext, expandString, type VarContext } from "./variables";
import {
  resolveAppliedBases,
  composeLayers,
  mergePalette,
  mergeFontKeys,
  pickBackground,
} from "./bases";
import { mergeSchemas } from "./schema-merge";
import { mergeDefaults } from "./defaults-merge";
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
  palette: Record<string, string>;
  fontKeyToFamily: Map<string, string>;
  textDefaults: ResolvedTextDefaults;
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
    const palette = mergePalette(applied);
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
      loaded.deck.vars,
      slide.vars,
      palette,
      errors,
    );

    const textDefaults = resolveTextDefaultsFor(
      mergedDefaults.text,
      fontKeyToFamily,
      palette,
    );
    const ctx: ConvertCtx = {
      vars,
      palette,
      fontKeyToFamily,
      textDefaults,
      errors,
    };

    const composed = composeLayers(applied, slide);
    const elements = composed.map((el) => convertElement(el, ctx));

    const bgRaw = slide.background ?? pickBackground(applied);
    const background = bgRaw
      ? resolveColorLenient(expandString(bgRaw, vars, errors), palette)
      : undefined;

    // id は任意。未指定時はインデックス由来の id を割り当てる
    // (重複の検証は DeckSchema で済んでいる)。
    return { id: slideId, background, elements };
  });

  return {
    deck: { slide: slideSize, fonts, slides },
    errors,
  };
}

// 全 base のフォント宣言を family 名で集約 (デッキ全体のフォントレジストリ)。
function buildFontRegistry(loaded: LoadedDeck): Map<string, MirFont> {
  const registry = new Map<string, MirFont>();
  for (const base of loaded.basesById.values()) {
    for (const decl of Object.values(base.fonts ?? {})) {
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

// スライドサイズは deck.bases の宣言順で最初に slide を持つ base から採る。
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
  palette: Record<string, string>,
): ResolvedTextDefaults {
  const raw = resolveTextDefaults(text);
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
