import type { MirElement, MirList } from "../ir/mir";
import type { LowerCtx } from "./context";
import { applyPadding } from "./groups";
import { type Box, toPx } from "./position";

type ItemHeight = (el: MirElement, width: number, ctx: LowerCtx) => number;

// Gutter (marker column) and gap between marker and content for a ul/ol.
export function listGutter(el: MirList): number {
  return el.size * (el.type === "ol" ? 1.8 : 1.0);
}

export function listMarkerGap(el: MirList): number {
  return el.size * 0.4;
}

// Content box (where items are laid out) for a list placed in `box`.
export function listContentBox(el: MirList, box: Box, ctx: LowerCtx): Box {
  const inner = applyPadding(box, el.padding, ctx);
  const offset = listGutter(el) + listMarkerGap(el);
  return { x: inner.x + offset, y: inner.y, w: Math.max(0, inner.w - offset), h: inner.h };
}

// Total height a ul/ol occupies at the given width.
// Padding/gap resolve against the slide: horizontal->width, vertical->height.
export function listHeight(
  el: MirList,
  width: number,
  ctx: LowerCtx,
  itemHeight: ItemHeight,
): number {
  const padX = toPx(el.padding, ctx.slide.width);
  const padY = toPx(el.padding, ctx.slide.height);
  const contentWidth = Math.max(0, width - 2 * padX - listGutter(el) - listMarkerGap(el));
  const gap = toPx(el.gap, ctx.slide.height);
  const content = el.items.reduce((sum, item) => sum + itemHeight(item, contentWidth, ctx), 0);
  return content + gap * Math.max(0, el.items.length - 1) + 2 * padY;
}
