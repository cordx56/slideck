import type { MirElement, MirGroup } from "../ir/mir";
import type { LayoutDir } from "../ir/hir";
import { type Box, toPx } from "./position";
import { shapeText } from "./text-shaping";
import { applyPadding } from "./groups";
import type { LowerCtx } from "./context";

type MirList = Extract<MirElement, { type: "ul" | "ol" }>;

// Gutter (marker column) and gap between marker and content for a ul/ol.
// Kept in sync with placeList in ./index.ts.
export function listGutter(el: MirList): number {
  return el.size * (el.type === "ol" ? 1.8 : 1.0);
}
export function listMarkerGap(el: MirList): number {
  return el.size * 0.4;
}
// Content box (where items are laid out) for a list placed in `box`.
export function listContentBox(el: MirList, box: Box): Box {
  const inner = applyPadding(box, el.padding);
  const offset = listGutter(el) + listMarkerGap(el);
  return { x: inner.x + offset, y: inner.y, w: Math.max(0, inner.w - offset), h: inner.h };
}

// Stacked height of an element when placed in a column of the given width.
function stackedHeight(el: MirElement, width: number, ctx: LowerCtx): number {
  switch (el.type) {
    case "text":
      return shapeText(
        el.text,
        el.font,
        el.size,
        width,
        el.align,
        el.lineHeight,
        el.letterSpacing,
        ctx.metrics,
      ).height;
    case "image": {
      const img = ctx.images.get(el.src);
      const aspect = img && img.height > 0 ? img.width / img.height : 16 / 9;
      return width / aspect;
    }
    case "ul":
    case "ol":
      return listHeight(el, width, ctx);
    default: {
      const h = "position" in el ? el.position?.height : undefined;
      return h ? toPx(h, width) : 0;
    }
  }
}

// Total height a ul/ol occupies at the given width (matches placeList geometry).
// Percentage padding/gap are resolved against width here (exact for px/0).
function listHeight(el: MirList, width: number, ctx: LowerCtx): number {
  const pad = toPx(el.padding, width);
  const contentWidth = Math.max(0, width - 2 * pad - listGutter(el) - listMarkerGap(el));
  const gap = toPx(el.gap, width);
  const content = el.items.reduce((s, it) => s + stackedHeight(it, contentWidth, ctx), 0);
  return content + gap * Math.max(0, el.items.length - 1) + 2 * pad;
}

export interface PlacedChild {
  el: MirElement;
  box: Box;
}

interface Measured {
  el: MirElement;
  flex: number;
  main: number;
  cross: number;
}

// Resolve row/column auto-layout and return each child's absolute Box.
// inner is the group's box after padding is applied.
export function computeAutoLayout(group: MirGroup, inner: Box, ctx: LowerCtx): PlacedChild[] {
  const dir = group.layout ?? "column";
  const isRow = dir === "row";
  const mainExtent = isRow ? inner.w : inner.h;
  const crossExtent = isRow ? inner.h : inner.w;
  const gapPx = toPx(group.gap, mainExtent);
  const n = group.children.length;

  const items: Measured[] = group.children.map((el) => {
    const flex = el.flex && el.flex > 0 ? el.flex : 0;
    const intr = childIntrinsic(el, ctx, mainExtent, crossExtent, dir);
    return { el, flex, main: intr.main, cross: intr.cross };
  });

  // flex distribution: split the remainder (after fixed mains and gaps) by ratio.
  const totalGap = gapPx * Math.max(0, n - 1);
  const fixedMain = items.filter((i) => i.flex === 0).reduce((s, i) => s + i.main, 0);
  const flexTotal = items.reduce((s, i) => s + i.flex, 0);
  const remaining = Math.max(0, mainExtent - fixedMain - totalGap);
  for (const i of items) {
    if (i.flex > 0) i.main = flexTotal > 0 ? (remaining * i.flex) / flexTotal : 0;
  }

  const usedMain = items.reduce((s, i) => s + i.main, 0) + totalGap;

  // justify: decide the main-axis start position and spacing between items.
  let cursor = 0;
  let between = gapPx;
  const slack = mainExtent - usedMain;
  switch (group.justify) {
    case "center":
      cursor = slack / 2;
      break;
    case "end":
      cursor = slack;
      break;
    case "space-between":
      if (n > 1) between = gapPx + slack / (n - 1);
      break;
    case "space-around":
      if (n > 0) {
        const unit = slack / n;
        cursor = unit / 2;
        between = gapPx + unit;
      }
      break;
    default:
      break; // start
  }

  const placed: PlacedChild[] = [];
  for (const i of items) {
    let crossSize = i.cross;
    let crossPos = 0;
    switch (group.align) {
      case "stretch":
        crossSize = crossExtent;
        break;
      case "center":
        crossPos = (crossExtent - crossSize) / 2;
        break;
      case "end":
        crossPos = crossExtent - crossSize;
        break;
      default:
        break; // start
    }
    const box: Box = isRow
      ? { x: inner.x + cursor, y: inner.y + crossPos, w: i.main, h: crossSize }
      : { x: inner.x + crossPos, y: inner.y + cursor, w: crossSize, h: i.main };
    placed.push({ el: i.el, box });
    cursor += i.main + between;
  }
  return placed;
}

// Estimate a child's natural size along the main/cross directions.
function childIntrinsic(
  el: MirElement,
  ctx: LowerCtx,
  mainExtent: number,
  crossExtent: number,
  dir: LayoutDir,
): { main: number; cross: number } {
  const isRow = dir === "row";
  // In a column, a ul/ol takes its measured stacked height (avoids overlap with
  // following siblings). In a row, fall through to position-based sizing.
  if (!isRow && (el.type === "ul" || el.type === "ol")) {
    return { main: listHeight(el, crossExtent, ctx), cross: crossExtent };
  }
  switch (el.type) {
    case "text": {
      if (isRow) {
        const nat = shapeText(
          el.text,
          el.font,
          el.size,
          Infinity,
          el.align,
          el.lineHeight,
          el.letterSpacing,
          ctx.metrics,
        );
        const w = Math.min(nat.width, mainExtent);
        const sh = shapeText(
          el.text,
          el.font,
          el.size,
          w,
          el.align,
          el.lineHeight,
          el.letterSpacing,
          ctx.metrics,
        );
        return { main: w, cross: sh.height };
      }
      const sh = shapeText(
        el.text,
        el.font,
        el.size,
        crossExtent,
        el.align,
        el.lineHeight,
        el.letterSpacing,
        ctx.metrics,
      );
      return { main: sh.height, cross: crossExtent };
    }
    case "image": {
      const img = ctx.images.get(el.src);
      const aspect = img && img.height > 0 ? img.width / img.height : 16 / 9;
      const cross = crossExtent;
      return { main: isRow ? cross * aspect : cross / aspect, cross };
    }
    default: {
      const position = "position" in el ? el.position : undefined;
      const mainDim = isRow ? position?.width : position?.height;
      const crossDim = isRow ? position?.height : position?.width;
      return {
        main: mainDim ? toPx(mainDim, mainExtent) : 0,
        cross: crossDim ? toPx(crossDim, crossExtent) : crossExtent,
      };
    }
  }
}
