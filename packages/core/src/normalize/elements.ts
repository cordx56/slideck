import type { FigureElement, HirElement } from "../ir/hir";
import type { FigureLabel, MirElement, RichStyle } from "../ir/mir";
import type { PipelineError } from "../lib/error";
import type { NumericValue } from "../schema/numeric";
import { percent, ZERO_LENGTH, type Point } from "../schema/position";
import {
  DEFAULT_FIT,
  DEFAULT_STROKE_WIDTH,
  GROUP_FALLBACK,
  type ResolvedTextDefaults,
} from "./defaults";
import { resolveColorLiteral } from "./text-style";
import { expandString, resolveNumber, type VarContext } from "./variables";

export const LINE_FROM_DEFAULT: Point = {
  x: ZERO_LENGTH,
  y: ZERO_LENGTH,
};

export const LINE_TO_DEFAULT: Point = {
  x: percent(100),
  y: percent(100),
};

export class SlideScope {
  constructor(
    readonly vars: VarContext,
    readonly textDefaults: ResolvedTextDefaults,
    readonly rich: RichStyle,
    readonly errors: PipelineError[],
  ) {}

  expand(value: string): string {
    return expandString(value, this.vars, this.errors);
  }

  color(value: string): string {
    return resolveColorLiteral(this.expand(value));
  }

  number(
    value: NumericValue | undefined,
    field: string,
    opts?: { positive?: boolean; nonnegative?: boolean; integer?: boolean },
  ): number | undefined {
    return resolveNumber(value, this.vars, this.errors, { field, ...opts });
  }
}

// Resolve a figure's label fields against scope.textDefaults. Returns undefined
// when no `text` is set, so the label is opt-in per figure.
export function buildFigureLabel(hir: FigureElement, scope: SlideScope): FigureLabel | undefined {
  if (hir.text === undefined) return undefined;
  const size =
    scope.number(hir.textSize, "textSize", { positive: true }) ?? scope.textDefaults.size;
  const padding = scope.number(hir.textPadding, "textPadding", { nonnegative: true }) ?? size * 0.4;
  return {
    content: scope.expand(hir.text),
    font: hir.textFont ? scope.expand(hir.textFont) : scope.textDefaults.family,
    size,
    color: hir.textColor ? scope.color(hir.textColor) : scope.textDefaults.color,
    // Sensible default proportional to size; user can override for tighter or
    // looser breaks around the text when it sits on a line/arrow.
    padding,
  };
}

export function convertElement(hir: HirElement, scope: SlideScope): MirElement {
  // Font references in elements are CSS family names (= fonts: keys), no translation.
  switch (hir.type) {
    case "text": {
      const textDefaults = scope.textDefaults;
      return {
        type: "text",
        position: hir.position,
        flex: scope.number(hir.flex, "flex"),
        text: scope.expand(hir.text),
        font: hir.font ? scope.expand(hir.font) : textDefaults.family,
        size: scope.number(hir.size, "size", { positive: true }) ?? textDefaults.size,
        color: hir.color ? scope.color(hir.color) : textDefaults.color,
        align: hir.align ?? textDefaults.align,
        lineHeight:
          scope.number(hir.lineHeight, "lineHeight", { positive: true }) ?? textDefaults.lineHeight,
        letterSpacing:
          scope.number(hir.letterSpacing, "letterSpacing") ?? textDefaults.letterSpacing,
        rich: scope.rich,
      };
    }
    case "image":
      return {
        type: "image",
        position: hir.position,
        flex: scope.number(hir.flex, "flex"),
        src: scope.expand(hir.src),
        fit: hir.fit ?? DEFAULT_FIT,
      };
    case "figure": {
      // One HIR shape primitive -> a specific MIR variant per shape.
      const stroke = hir.stroke ? scope.color(hir.stroke) : undefined;
      const strokeWidth =
        scope.number(hir.strokeWidth, "strokeWidth", { nonnegative: true }) ??
        (stroke ? DEFAULT_STROKE_WIDTH : 0);
      const lineWidth =
        scope.number(hir.strokeWidth, "strokeWidth", { nonnegative: true }) ?? DEFAULT_STROKE_WIDTH;
      const label = buildFigureLabel(hir, scope);
      switch (hir.shape) {
        case "rect":
          return {
            type: "rect",
            position: hir.position,
            flex: scope.number(hir.flex, "flex"),
            fill: hir.fill ? scope.color(hir.fill) : undefined,
            stroke,
            strokeWidth,
            rx: scope.number(hir.rx, "rx", { nonnegative: true }) ?? 0,
            label,
          };
        case "circle":
          return {
            type: "circle",
            position: hir.position,
            flex: scope.number(hir.flex, "flex"),
            fill: hir.fill ? scope.color(hir.fill) : undefined,
            stroke,
            strokeWidth,
            label,
          };
        case "line":
          return {
            type: "line",
            flex: scope.number(hir.flex, "flex"),
            from: hir.from ?? LINE_FROM_DEFAULT,
            to: hir.to ?? LINE_TO_DEFAULT,
            stroke: hir.stroke ? scope.color(hir.stroke) : scope.textDefaults.color,
            strokeWidth: lineWidth,
            fill: hir.fill ? scope.color(hir.fill) : undefined,
            label,
          };
        case "arrow":
          return {
            type: "arrow",
            flex: scope.number(hir.flex, "flex"),
            from: hir.from ?? LINE_FROM_DEFAULT,
            to: hir.to ?? LINE_TO_DEFAULT,
            stroke: hir.stroke ? scope.color(hir.stroke) : scope.textDefaults.color,
            strokeWidth: lineWidth,
            arrowSize:
              scope.number(hir.arrowSize, "arrowSize", { positive: true }) ?? 3 * lineWidth,
            fill: hir.fill ? scope.color(hir.fill) : undefined,
            label,
          };
      }
    }
    case "path": {
      const stroke = hir.stroke ? scope.color(hir.stroke) : undefined;
      return {
        type: "path",
        position: hir.position,
        d: scope.expand(hir.d),
        fill: hir.fill ? scope.color(hir.fill) : undefined,
        stroke,
        strokeWidth:
          scope.number(hir.strokeWidth, "strokeWidth", { nonnegative: true }) ??
          (stroke ? DEFAULT_STROKE_WIDTH : 0),
      };
    }
    case "group":
      return {
        type: "group",
        position: hir.position,
        flex: scope.number(hir.flex, "flex"),
        children: hir.children.map((child) => convertElement(child, scope)),
        layout: hir.layout,
        gap: hir.gap ?? ZERO_LENGTH,
        align: hir.align ?? GROUP_FALLBACK.align,
        justify: hir.justify ?? GROUP_FALLBACK.justify,
        padding: hir.padding ?? ZERO_LENGTH,
      };
    case "ul":
    case "ol": {
      const textDefaults = scope.textDefaults;
      const size = scope.number(hir.size, "size", { positive: true }) ?? textDefaults.size;
      // A list's size becomes the default text size for its items (overridable per item).
      const itemScope =
        hir.size !== undefined
          ? new SlideScope(scope.vars, { ...textDefaults, size }, scope.rich, scope.errors)
          : scope;
      return {
        type: hir.type,
        position: hir.position,
        flex: scope.number(hir.flex, "flex"),
        items: hir.items.map((item) => convertElement(item, itemScope)),
        gap: hir.gap ?? ZERO_LENGTH,
        align: hir.align ?? GROUP_FALLBACK.align,
        padding: hir.padding ?? ZERO_LENGTH,
        font: hir.font ? scope.expand(hir.font) : textDefaults.family,
        size,
        color: hir.color ? scope.color(hir.color) : textDefaults.color,
        start: scope.number(hir.start, "start", { integer: true }) ?? 1,
      };
    }
  }
}
