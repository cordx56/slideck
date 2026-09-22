import type { Primitive, SlideLir } from "../ir/lir";
import type { MirDeck, MirElement, MirSlide } from "../ir/mir";
import { computeAutoLayout, stackedHeight } from "./auto-layout";
import type { LowerCtx } from "./context";
import { emitArrow, emitCircle, emitLine, emitPath, emitRect } from "./figures";
import { applyPadding } from "./groups";
import { emitImage, imageBox } from "./images";
import { placeList } from "./lists";
import { type Box, resolveAxis, resolveBox } from "./position";
import { layoutText, measureTextHeight } from "./text-style";

export type { LoadedImage, LowerCtx } from "./context";

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
    const p = el.position ?? {};
    const hx = resolveAxis(p.left, p.right, p.width, parentBox.x, parentBox.w);
    const height = measureTextHeight(el, hx.size, ctx);
    const vy = resolveAxis(p.top, p.bottom, p.height, parentBox.y, parentBox.h, height);
    placeElement(el, { x: hx.pos, y: vy.pos, w: hx.size, h: vy.size }, ctx, out);
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

// Draw an element into the resolved box (auto-layout passes this box directly).
function placeElement(el: MirElement, box: Box, ctx: LowerCtx, out: Primitive[]): void {
  switch (el.type) {
    case "text":
      out.push(...layoutText(el, box, ctx));
      break;
    case "image":
      emitImage(el, box, ctx, out);
      break;
    case "rect":
      emitRect(el, box, ctx, out);
      break;
    case "line":
      emitLine(el, box, ctx, out);
      break;
    case "circle":
      emitCircle(el, box, ctx, out);
      break;
    case "arrow":
      emitArrow(el, box, ctx, out);
      break;
    case "path":
      emitPath(el, out);
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
      placeList(el, box, ctx, out, placeAtBox);
      break;
  }
}

// Place a child into the box assigned by auto-layout. The main-axis size is
// already decided by the layout (flex/intrinsic), so only the child's cross-
// axis position fields are honored as a sub-box within the assigned cell.
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
