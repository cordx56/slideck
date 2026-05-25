import type { Dimension } from "../schema/position";
import { type Box, toPx } from "./position";
import type { LowerCtx } from "./context";

// Return the inner box after applying the group padding. Padding is a % of the
// slide size: left/right against the slide width, top/bottom against its height.
export function applyPadding(box: Box, padding: Dimension, ctx: LowerCtx): Box {
  const padX = toPx(padding, ctx.slide.width);
  const padY = toPx(padding, ctx.slide.height);
  return {
    x: box.x + padX,
    y: box.y + padY,
    w: Math.max(0, box.w - padX * 2),
    h: Math.max(0, box.h - padY * 2),
  };
}
