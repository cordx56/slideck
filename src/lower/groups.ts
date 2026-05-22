import type { Dimension } from "../schema/position";
import { type Box, toPx } from "./position";

// グループの padding を適用した内側ボックスを返す。
// padding は左右に box.w 基準、上下に box.h 基準の % として展開する。
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
