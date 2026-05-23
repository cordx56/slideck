// Coordinate transforms. LIR origin is top-left, Y down; PDF origin is bottom-left, Y up.

// Rect with top y (LIR) and height h -> PDF bottom y.
export function rectY(yTop: number, h: number, pageHeight: number): number {
  return pageHeight - yTop - h;
}

// Flip LIR y (from top) to PDF y (from bottom).
// Text is baseline-based, so this transform alone is enough.
export function flipY(y: number, pageHeight: number): number {
  return pageHeight - y;
}
