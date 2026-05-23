import type { Dimension } from "../schema/position";
import { type Box, toPx } from "./position";

// Return the inner box after applying the group padding.
// Padding expands as a % of box.w left/right and box.h top/bottom.
export function applyPadding(box: Box, padding: Dimension): Box {
  const padX = toPx(padding, box.w);
  const padY = toPx(padding, box.h);
  return {
    x: box.x + padX,
    y: box.y + padY,
    w: Math.max(0, box.w - padX * 2),
    h: Math.max(0, box.h - padY * 2),
  };
}
