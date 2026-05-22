import type { HirElement } from "../ir/hir";

// オーバーレイ要素を全スライド共通で最前面 (配列末尾) に重ねる。
export function appendOverlays(
  elements: HirElement[],
  overlays: HirElement[],
): HirElement[] {
  if (overlays.length === 0) return elements;
  return [...elements, ...overlays];
}
