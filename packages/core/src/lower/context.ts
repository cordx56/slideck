import type { FontMetrics } from "./metrics";

// Preloaded resources needed during lower.
// Image bytes and font metrics are gathered asynchronously in the prepare phase,
// keeping lower itself a sync, pure function (for testability).
export interface LoadedImage {
  data: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface LowerCtx {
  metrics: FontMetrics;
  images: Map<string, LoadedImage>;
  // Slide (drawing area) size. Percentage gap/padding resolve against this:
  // horizontal lengths against the width, vertical lengths against the height.
  slide: { width: number; height: number };
}

// Loaded font bytes used for PDF embedding and SVG preview registration.
export interface LoadedFont {
  family: string;
  bytes: Uint8Array;
  weight?: number;
  style?: "normal" | "italic";
}
