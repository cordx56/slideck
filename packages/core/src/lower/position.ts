import type { Dimension, Position } from "../schema/position";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Resolve a Dimension to a px length relative to the parent extent (center handled separately).
export function toPx(dim: Dimension, parentExtent: number): number {
  if (dim.kind === "percent") return (parentExtent * dim.value) / 100;
  if (dim.kind === "px") return dim.value;
  return 0; // center counts as length 0 (handled separately by placement)
}

interface AxisResult {
  pos: number;
  size: number;
}

// Resolve placement along one axis.
// start: left/top (center allowed), end: right/bottom, size: width/height.
// Falls back loosely when underspecified (start=0 / full parent / intrinsic).
export function resolveAxis(
  start: Dimension | undefined,
  end: Dimension | undefined,
  size: Dimension | undefined,
  parentOrigin: number,
  parentExtent: number,
  intrinsic?: number,
): AxisResult {
  const isCenter = start?.kind === "center";
  const startPx = start && !isCenter ? toPx(start, parentExtent) : undefined;
  const endPx = end ? toPx(end, parentExtent) : undefined;
  const sizePx = size ? toPx(size, parentExtent) : undefined;

  // size known
  if (sizePx !== undefined) {
    return {
      pos: parentOrigin + place(startPx, endPx, isCenter, sizePx, parentExtent),
      size: sizePx,
    };
  }
  // start + end -> size is determined
  if (startPx !== undefined && endPx !== undefined) {
    return { pos: parentOrigin + startPx, size: parentExtent - startPx - endPx };
  }
  // size unknown: intrinsic or full parent
  const resolved = intrinsic ?? parentExtent - (startPx ?? 0) - (endPx ?? 0);
  return {
    pos: parentOrigin + place(startPx, endPx, isCenter, resolved, parentExtent),
    size: resolved,
  };
}

// Decide the start position once the size is known.
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

// Resolve a full position into an absolute Box relative to the parent Box.
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
