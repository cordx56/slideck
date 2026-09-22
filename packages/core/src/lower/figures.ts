import type { Primitive, Stroke, TextRun } from "../ir/lir";
import type { FigureLabel, MirArrow, MirCircle, MirLine, MirPath, MirRect } from "../ir/mir";
import type { LowerCtx } from "./context";
import { type Box, toPx } from "./position";
import { shapeText } from "./text-shaping";

export interface LineEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function lineEndpoints(el: MirLine | MirArrow, box: Box): LineEndpoints {
  return {
    x1: box.x + toPx(el.from.x, box.w),
    y1: box.y + toPx(el.from.y, box.h),
    x2: box.x + toPx(el.to.x, box.w),
    y2: box.y + toPx(el.to.y, box.h),
  };
}

export function emitRect(el: MirRect, box: Box, ctx: LowerCtx, out: Primitive[]): void {
  out.push({
    kind: "rect",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fill: el.fill,
    stroke: makeStroke(el.stroke, el.strokeWidth),
    rx: el.rx || undefined,
  });
  // Label sits on top of the rect fill, so no extra backing rect is needed.
  if (el.label) {
    emitFigureLabel(box.x + box.w / 2, box.y + box.h / 2, el.label, undefined, ctx, out);
  }
}

export function emitCircle(el: MirCircle, box: Box, ctx: LowerCtx, out: Primitive[]): void {
  // Inscribed: centred in the box, r = min(w, h) / 2.
  out.push({
    kind: "circle",
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    r: Math.min(box.w, box.h) / 2,
    fill: el.fill,
    stroke: makeStroke(el.stroke, el.strokeWidth),
  });
  if (el.label) {
    emitFigureLabel(box.x + box.w / 2, box.y + box.h / 2, el.label, undefined, ctx, out);
  }
}

export function emitLine(el: MirLine, box: Box, ctx: LowerCtx, out: Primitive[]): void {
  const { x1, y1, x2, y2 } = lineEndpoints(el, box);
  out.push({
    kind: "line",
    x1,
    y1,
    x2,
    y2,
    stroke: { color: el.stroke, width: el.strokeWidth },
  });
  if (el.label) emitFigureLabel((x1 + x2) / 2, (y1 + y2) / 2, el.label, el.fill, ctx, out);
}

export function emitArrow(el: MirArrow, box: Box, ctx: LowerCtx, out: Primitive[]): void {
  const { x1, y1, x2, y2 } = lineEndpoints(el, box);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return;

  // Unit vector along the line and its perpendicular.
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const a = el.arrowSize;
  // Shorten the line so its end sits at the arrowhead's base.
  const baseX = x2 - ux * a;
  const baseY = y2 - uy * a;
  out.push({
    kind: "line",
    x1,
    y1,
    x2: baseX,
    y2: baseY,
    stroke: { color: el.stroke, width: el.strokeWidth },
  });
  // Filled-triangle arrowhead at the tip (fill = stroke color).
  const s1x = baseX + px * (a / 2);
  const s1y = baseY + py * (a / 2);
  const s2x = baseX - px * (a / 2);
  const s2y = baseY - py * (a / 2);
  out.push({
    kind: "path",
    d: `M ${x2} ${y2} L ${s1x} ${s1y} L ${s2x} ${s2y} Z`,
    fill: el.stroke,
  });
  // Label midpoint = middle of the visible line (from -> arrowhead base),
  // so it stays clear of the arrowhead even for short arrows.
  if (el.label) {
    emitFigureLabel((x1 + baseX) / 2, (y1 + baseY) / 2, el.label, el.fill, ctx, out);
  }
}

export function emitPath(el: MirPath, out: Primitive[]): void {
  out.push({
    kind: "path",
    d: el.d,
    fill: el.fill,
    stroke: makeStroke(el.stroke, el.strokeWidth),
  });
}

export function makeStroke(color: string | undefined, width: number): Stroke | undefined {
  if (!color || width <= 0) return undefined;
  return { color, width };
}

// Emit a label centred on (cx, cy). For rect/circle the figure fill already
// provides the background, so bgFill is undefined and no backing rect is drawn.
// For line/arrow, when bgFill is set, a rect sized to the text + padding is
// drawn under the text so the line is visually interrupted at the label.
// Multi-line labels split on "\n" -- no wrapping, since figures don't expose
// a label width; users break manually when needed.
export function emitFigureLabel(
  cx: number,
  cy: number,
  label: FigureLabel,
  bgFill: string | undefined,
  ctx: LowerCtx,
  out: Primitive[],
): void {
  // Use a fixed line-height of 1.2 -- labels don't share the text-defaults
  // lineHeight (which is tuned for body text wrapping decisions) and a tight
  // value reads better inside a shape.
  const lineHeight = 1.2;
  const shape = shapeText(
    label.content,
    {
      font: label.font,
      size: label.size,
      align: "left",
      lineHeight,
      letterSpacing: 0,
    },
    Infinity,
    ctx.metrics,
  );
  if (shape.lines.length === 0) return;
  const lineBox = label.size * lineHeight;
  const ascent = label.size * ctx.metrics.ascentRatio(label.font);
  const totalH = shape.lines.length * lineBox;
  const top = cy - totalH / 2;

  if (bgFill) {
    out.push({
      kind: "rect",
      x: cx - shape.width / 2 - label.padding,
      y: top - label.padding,
      w: shape.width + 2 * label.padding,
      h: totalH + 2 * label.padding,
      fill: bgFill,
    });
  }

  const runs: TextRun[] = shape.lines.map((line, i) => ({
    text: line.text,
    font: { family: label.font },
    size: label.size,
    color: label.color,
    x: cx - line.width / 2,
    y: top + i * lineBox + ascent,
  }));
  out.push({ kind: "text", x: cx, y: top, runs, align: "center" });
}
