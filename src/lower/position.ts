import type { Dimension, Position } from "../schema/position";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Dimension を親 extent に対する px 長に解決する (center は別扱い)。
export function toPx(dim: Dimension, parentExtent: number): number {
  if (dim.kind === "percent") return (parentExtent * dim.value) / 100;
  if (dim.kind === "px") return dim.value;
  return 0; // center は長さとしては 0 扱い (配置側で別途処理)
}

interface AxisResult {
  pos: number;
  size: number;
}

// 1軸の配置を解決する。
// start: left/top (center 可), end: right/bottom, size: width/height。
// 指定不足時はゆるくフォールバック (start=0 / 親いっぱい / intrinsic)。
export function resolveAxis(
  start: Dimension | undefined,
  end: Dimension | undefined,
  size: Dimension | undefined,
  parentOrigin: number,
  parentExtent: number,
  intrinsic?: number,
): AxisResult {
  const isCenter = start?.kind === "center";
  const startPx =
    start && !isCenter ? toPx(start, parentExtent) : undefined;
  const endPx = end ? toPx(end, parentExtent) : undefined;
  const sizePx = size ? toPx(size, parentExtent) : undefined;

  // サイズ確定済み
  if (sizePx !== undefined) {
    return { pos: parentOrigin + place(startPx, endPx, isCenter, sizePx, parentExtent), size: sizePx };
  }
  // start + end → サイズが決まる
  if (startPx !== undefined && endPx !== undefined) {
    return { pos: parentOrigin + startPx, size: parentExtent - startPx - endPx };
  }
  // サイズ不明: intrinsic または親いっぱい
  const resolved =
    intrinsic ?? parentExtent - (startPx ?? 0) - (endPx ?? 0);
  return {
    pos: parentOrigin + place(startPx, endPx, isCenter, resolved, parentExtent),
    size: resolved,
  };
}

// サイズ確定後の開始位置を決める。
function place(
  startPx: number | undefined,
  endPx: number | undefined,
  isCenter: boolean,
  size: number,
  parentExtent: number,
): number {
  if (isCenter) return (parentExtent - size) / 2;
  if (startPx !== undefined) return startPx;
  if (endPx !== undefined) return parentExtent - endPx - size;
  return 0;
}

export interface Intrinsic {
  w?: number;
  h?: number;
}

// position 全体を親 Box に対する絶対 Box に解決する。
export function resolveBox(
  position: Position | undefined,
  parent: Box,
  intrinsic?: Intrinsic,
): Box {
  const p = position ?? {};
  const hx = resolveAxis(p.left, p.right, p.width, parent.x, parent.w, intrinsic?.w);
  const vy = resolveAxis(p.top, p.bottom, p.height, parent.y, parent.h, intrinsic?.h);
  return { x: hx.pos, y: vy.pos, w: hx.size, h: vy.size };
}
