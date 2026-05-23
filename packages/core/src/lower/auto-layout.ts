import type { MirElement, MirGroup } from "../ir/mir";
import type { LayoutDir } from "../ir/hir";
import { type Box, toPx } from "./position";
import { shapeText } from "./text-shaping";
import type { LowerCtx } from "./context";

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
export function computeAutoLayout(
  group: MirGroup,
  inner: Box,
  ctx: LowerCtx,
): PlacedChild[] {
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
  const fixedMain = items
    .filter((i) => i.flex === 0)
    .reduce((s, i) => s + i.main, 0);
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
