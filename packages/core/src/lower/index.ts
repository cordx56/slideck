import type { FigureLabel, MirDeck, MirElement, MirSlide, MirText } from "../ir/mir";
import type { Primitive, SlideLir, TextRun, Stroke } from "../ir/lir";
import type { Dimension } from "../schema/position";
import { type Box, type Intrinsic, resolveAxis, resolveBox, toPx } from "./position";
import { applyPadding } from "./groups";
import { computeAutoLayout, listGutter, listContentBox, stackedHeight } from "./auto-layout";
import { shapeText } from "./text-shaping";
import { shapeRich, type RichLayout, type RichRun } from "./rich-shaping";
import { hasRichMarkup } from "../lib/richtext";
import { translateMathPath } from "../lib/math";
import type { RichStyle } from "../ir/hir";
import type { LowerCtx } from "./context";

export type { LowerCtx } from "./context";
export type { LoadedImage } from "./context";

// Lower a MIR slide to LIR (a sequence of absolute-coord primitives). Sync, pure function.
export function lower(slide: MirSlide, deck: MirDeck, ctx: LowerCtx): SlideLir {
  const slideBox: Box = {
    x: 0,
    y: 0,
    w: deck.slide.width,
    h: deck.slide.height,
  };
  // Resolve %-lengths (gap/padding) against the current slide size, even if ctx
  // was prepared for a deck whose slide dimensions have since changed.
  const lctx: LowerCtx = { ...ctx, slide: { width: deck.slide.width, height: deck.slide.height } };
  const out: Primitive[] = [];
  for (const el of slide.elements) lowerElement(el, slideBox, lctx, out);
  return {
    id: slide.id,
    width: deck.slide.width,
    height: deck.slide.height,
    background: slide.background,
    primitives: out,
  };
}

// Resolve position relative to the parent box, then place and draw the element.
function lowerElement(el: MirElement, parentBox: Box, ctx: LowerCtx, out: Primitive[]): void {
  if (el.type === "text") {
    placeElement(el, textBox(el, parentBox, ctx), ctx, out);
    return;
  }
  if (el.type === "line") {
    // line interprets from/to relative to the parent box, so box=parent.
    placeElement(el, parentBox, ctx, out);
    return;
  }
  if (el.type === "image") {
    placeElement(el, imageBox(el, parentBox, ctx), ctx, out);
    return;
  }
  // For auto-layout groups (column / row) and lists (ul / ol), compute the
  // intrinsic stacked-content height before resolving the vertical axis so
  // `position: { bottom: 2% }` lands them at their natural size at the bottom.
  // A *no-layout* group is an absolute-positioning canvas: when its parent
  // height isn't pinned, fall back to filling the parent (the default
  // resolveAxis behavior) so children's `%` positions stay measurable.
  if (el.type === "group" || el.type === "ul" || el.type === "ol") {
    const p = el.position;
    const hx = resolveAxis(p?.left, p?.right, p?.width, parentBox.x, parentBox.w);
    const wantsIntrinsic = el.type !== "group" || el.layout !== undefined;
    const intrH = wantsIntrinsic ? stackedHeight(el, hx.size, ctx) : undefined;
    const vy = resolveAxis(p?.top, p?.bottom, p?.height, parentBox.y, parentBox.h, intrH);
    placeElement(el, { x: hx.pos, y: vy.pos, w: hx.size, h: vy.size }, ctx, out);
    return;
  }
  const box = resolveBox("position" in el ? el.position : undefined, parentBox);
  placeElement(el, box, ctx, out);
}

// Explicit px size of an axis (from size, or start+end), else undefined.
function axisSize(
  start: Dimension | undefined,
  end: Dimension | undefined,
  size: Dimension | undefined,
  extent: number,
): number | undefined {
  if (size) return toPx(size, extent);
  if (start && start.kind !== "center" && end) {
    return extent - toPx(start, extent) - toPx(end, extent);
  }
  return undefined;
}

// Resolve an image's box. When only one of width/height is constrained, derive
// the other from the image's aspect ratio so it is anchored at its position
// rather than centered in the leftover space. Unknown intrinsic size (e.g. SVG)
// keeps the generic box behavior.
function imageBox(el: Extract<MirElement, { type: "image" }>, parent: Box, ctx: LowerCtx): Box {
  const img = ctx.images.get(el.src);
  const aspect = img && img.height > 0 ? img.width / img.height : undefined;
  if (aspect === undefined) return resolveBox(el.position, parent);
  const p = el.position ?? {};
  const explicitW = axisSize(p.left, p.right, p.width, parent.w);
  const explicitH = axisSize(p.top, p.bottom, p.height, parent.h);
  const intrinsic: Intrinsic = {
    w: explicitH !== undefined ? explicitH * aspect : undefined,
    h: explicitW !== undefined ? explicitW / aspect : undefined,
  };
  return resolveBox(el.position, parent, intrinsic);
}

// Link/code style for a text element. Uses el.rich if already normalized.
function richStyleOf(el: MirText): RichStyle {
  return (
    el.rich ?? {
      linkColor: el.color,
      linkUnderline: true,
      monoFamily: "",
      monoColor: el.color,
      // empty: bold/italic/boldItalic fall back to the element's own font
      boldFamily: "",
      italicFamily: "",
      boldItalicFamily: "",
    }
  );
}

// Text position resolution: fix width first, shape to get height, then resolve vertical.
function textBox(el: MirText, parent: Box, ctx: LowerCtx): Box {
  const p = el.position ?? {};
  const hx = resolveAxis(p.left, p.right, p.width, parent.x, parent.w);
  const height = hasRichMarkup(el.text)
    ? shapeRich(
        el.text,
        el.font,
        el.size,
        hx.size,
        el.align,
        el.lineHeight,
        el.letterSpacing,
        ctx.metrics,
        richStyleOf(el),
        el.color,
      ).height
    : shapeText(
        el.text,
        el.font,
        el.size,
        hx.size,
        el.align,
        el.lineHeight,
        el.letterSpacing,
        ctx.metrics,
      ).height;
  const vy = resolveAxis(p.top, p.bottom, p.height, parent.y, parent.h, height);
  return { x: hx.pos, y: vy.pos, w: hx.size, h: vy.size };
}

// Draw an element into the resolved box (auto-layout passes this box directly).
function placeElement(el: MirElement, box: Box, ctx: LowerCtx, out: Primitive[]): void {
  switch (el.type) {
    case "text": {
      if (hasRichMarkup(el.text)) {
        // inline markdown + math: expand into native text/line/path
        // (no foreignObject, so SVG/PDF/web all match).
        const layout = shapeRich(
          el.text,
          el.font,
          el.size,
          box.w,
          el.align,
          el.lineHeight,
          el.letterSpacing,
          ctx.metrics,
          richStyleOf(el),
          el.color,
        );
        emitRich(layout, box, el.color, out);
      } else {
        const shaped = shapeText(
          el.text,
          el.font,
          el.size,
          box.w,
          el.align,
          el.lineHeight,
          el.letterSpacing,
          ctx.metrics,
        );
        const runs: TextRun[] = shaped.lines.map((line) => ({
          text: line.text,
          font: { family: el.font },
          size: el.size,
          color: el.color,
          x: box.x + line.x,
          y: box.y + line.baseline,
        }));
        out.push({ kind: "text", x: box.x, y: box.y, runs, align: el.align });
      }
      break;
    }
    case "image": {
      const img = ctx.images.get(el.src);
      if (!img) break; // skip if unresolved in prepare
      const fitted = fitImage(box, img.width, img.height, el.fit);
      out.push({
        kind: "image",
        x: fitted.x,
        y: fitted.y,
        w: fitted.w,
        h: fitted.h,
        data: img.data,
        mime: img.mime,
      });
      break;
    }
    case "rect":
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
      if (el.label) emitFigureLabel(box.x + box.w / 2, box.y + box.h / 2, el.label, undefined, ctx, out);
      break;
    case "line": {
      const x1 = box.x + toPx(el.from.x, box.w);
      const y1 = box.y + toPx(el.from.y, box.h);
      const x2 = box.x + toPx(el.to.x, box.w);
      const y2 = box.y + toPx(el.to.y, box.h);
      out.push({
        kind: "line",
        x1,
        y1,
        x2,
        y2,
        stroke: { color: el.stroke, width: el.strokeWidth },
      });
      if (el.label) emitFigureLabel((x1 + x2) / 2, (y1 + y2) / 2, el.label, el.fill, ctx, out);
      break;
    }
    case "circle":
      // Inscribed: centred in the box, r = min(w, h) / 2.
      out.push({
        kind: "circle",
        cx: box.x + box.w / 2,
        cy: box.y + box.h / 2,
        r: Math.min(box.w, box.h) / 2,
        fill: el.fill,
        stroke: makeStroke(el.stroke, el.strokeWidth),
      });
      if (el.label) emitFigureLabel(box.x + box.w / 2, box.y + box.h / 2, el.label, undefined, ctx, out);
      break;
    case "arrow": {
      const x1 = box.x + toPx(el.from.x, box.w);
      const y1 = box.y + toPx(el.from.y, box.h);
      const x2 = box.x + toPx(el.to.x, box.w);
      const y2 = box.y + toPx(el.to.y, box.h);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
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
        if (el.label) emitFigureLabel((x1 + baseX) / 2, (y1 + baseY) / 2, el.label, el.fill, ctx, out);
      }
      break;
    }
    case "path":
      out.push({
        kind: "path",
        d: el.d,
        fill: el.fill,
        stroke: makeStroke(el.stroke, el.strokeWidth),
      });
      break;
    case "group": {
      const inner = applyPadding(box, el.padding, ctx);
      if (el.layout) {
        const isRow = el.layout === "row";
        for (const placed of computeAutoLayout(el, inner, ctx)) {
          placeAtBox(placed.el, placed.box, isRow, ctx, out);
        }
      } else {
        for (const child of el.children) lowerElement(child, inner, ctx, out);
      }
      break;
    }
    case "ul":
    case "ol":
      placeList(el, box, ctx, out);
      break;
  }
}

// Expand ul/ol vertically and draw a marker (bullet / number) in the gutter left of each item.
function placeList(
  el: Extract<MirElement, { type: "ul" | "ol" }>,
  box: Box,
  ctx: LowerCtx,
  out: Primitive[],
): void {
  const inner = applyPadding(box, el.padding, ctx);
  const gutter = listGutter(el);
  const contentBox = listContentBox(el, box, ctx);

  // Lay out items with column auto-layout.
  const placed = computeAutoLayout(
    {
      type: "group",
      children: el.items,
      layout: "column",
      gap: el.gap,
      align: el.align,
      justify: "start",
      padding: { kind: "percent", value: 0 },
    },
    contentBox,
    ctx,
  );

  placed.forEach((p, i) => {
    // Align the marker to the item's first line.
    const itemAscent =
      p.el.type === "text"
        ? p.el.size * ctx.metrics.ascentRatio(p.el.font)
        : el.size * ctx.metrics.ascentRatio(el.font);
    const baseline = p.box.y + itemAscent;

    if (el.type === "ul") {
      // Filled circle centered in the gutter, around the line's vertical middle.
      out.push({
        kind: "circle",
        cx: inner.x + gutter / 2,
        cy: baseline - el.size * 0.3,
        r: el.size * 0.13,
        fill: el.color,
      });
    } else {
      const marker = `${el.start + i}.`;
      const shaped = shapeText(marker, el.font, el.size, gutter, "right", 1.2, 0, ctx.metrics);
      out.push({
        kind: "text",
        x: inner.x,
        y: p.box.y,
        align: "right",
        runs: [
          {
            text: marker,
            font: { family: el.font },
            size: el.size,
            color: el.color,
            x: inner.x + shaped.lines[0].x,
            y: baseline,
          },
        ],
      });
    }
    // List items are stacked in a column, so position.left/right/width on an
    // item indents/shrinks it within the list's content box.
    placeAtBox(p.el, p.box, false, ctx, out);
  });
}

// Place a child into the box assigned by auto-layout. The main-axis size is
// already decided by the layout (flex/intrinsic), so only the child's cross-
// axis position fields (left/right/width for column, top/bottom/height for row)
// are honored -- as a sub-box within the assigned cell. This is how you indent
// or shrink a child within an auto-layout group.
function placeAtBox(
  el: MirElement,
  box: Box,
  isRow: boolean,
  ctx: LowerCtx,
  out: Primitive[],
): void {
  placeElement(el, applyCrossPosition(el, box, isRow), ctx, out);
}

function applyCrossPosition(el: MirElement, box: Box, isRow: boolean): Box {
  const p = "position" in el ? el.position : undefined;
  if (!p) return box;
  if (isRow) {
    const r = resolveAxis(p.top, p.bottom, p.height, box.y, box.h);
    return { x: box.x, y: r.pos, w: box.w, h: r.size };
  }
  const r = resolveAxis(p.left, p.right, p.width, box.x, box.w);
  return { x: r.pos, y: box.y, w: r.size, h: box.h };
}

// Expand the shapeRich result into text(runs) + line(underline/strike) + path(math).
function emitRich(layout: RichLayout, box: Box, mathColor: string, out: Primitive[]): void {
  const runs: TextRun[] = layout.runs.map((r) => ({
    text: r.text,
    font: r.font,
    size: r.size,
    color: r.color,
    x: box.x + r.x,
    y: box.y + r.baseline,
  }));
  if (runs.length) out.push({ kind: "text", x: box.x, y: box.y, runs, align: "left" });

  for (const r of layout.runs) {
    if (r.underline) out.push(decoLine(box, r, r.baseline + r.size * 0.12));
    if (r.strike) out.push(decoLine(box, r, r.baseline - r.size * 0.28));
    if (r.href) {
      // Use the run's box as the click region (top edge to below baseline).
      out.push({
        kind: "link",
        x: box.x + r.x,
        y: box.y + r.baseline - r.size * 0.8,
        w: r.width,
        h: r.size,
        href: r.href,
      });
    }
  }

  for (const m of layout.maths) {
    for (const g of m.glyphs) {
      out.push({
        kind: "path",
        d: translateMathPath(g.d, box.x + m.x, box.y + m.baseline),
        fill: mathColor,
      });
    }
  }
}

// Turn a run's underline/strike into a single line primitive.
function decoLine(box: Box, r: RichRun, yRel: number): Primitive {
  const y = box.y + yRel;
  return {
    kind: "line",
    x1: box.x + r.x,
    y1: y,
    x2: box.x + r.x + r.width,
    y2: y,
    stroke: { color: r.color, width: Math.max(1, r.size * 0.05) },
  };
}

function makeStroke(color: string | undefined, width: number): Stroke | undefined {
  if (!color || width <= 0) return undefined;
  return { color, width };
}

// Emit a label centred on (cx, cy). For rect/circle the figure fill already
// provides the background, so bgFill is undefined and no backing rect is drawn.
// For line/arrow, when bgFill is set, a rect sized to the text + padding is
// drawn under the text so the line is visually interrupted at the label.
// Multi-line labels split on "\n" -- no wrapping, since figures don't expose
// a label width; users break manually when needed.
function emitFigureLabel(
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
    label.font,
    label.size,
    Infinity,
    "left",
    lineHeight,
    0,
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

// Fit the image draw rect inside box per fit. cover behaves like fill in Phase 1.
function fitImage(box: Box, iw: number, ih: number, fit: "contain" | "cover" | "fill"): Box {
  if (fit === "fill" || fit === "cover" || iw <= 0 || ih <= 0) {
    return box;
  }
  const scale = Math.min(box.w / iw, box.h / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
