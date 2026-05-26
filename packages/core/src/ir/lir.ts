// LIR: a flat list of render primitives.
// Groups expanded, absolute coordinates (px, origin at slide top-left), text shaped.
// inline markdown/math are expanded to text/line/path in lower (no dedicated primitive).
import type { Align } from "./hir";

// Each face is registered under its own CSS family, so the family alone fully
// identifies which face to render. No weight/style attrs are emitted in SVG.
export interface FontRef {
  family: string;
}

// A shaped text fragment. x,y are absolute coordinates relative to the baseline.
export interface TextRun {
  text: string;
  font: FontRef;
  size: number;
  color: string;
  x: number;
  y: number;
}

export interface Stroke {
  color: string;
  width: number;
}

export type Primitive =
  | { kind: "text"; x: number; y: number; runs: TextRun[]; align: Align }
  | {
      kind: "image";
      x: number;
      y: number;
      w: number;
      h: number;
      data: Uint8Array;
      mime: string;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      stroke?: Stroke;
      rx?: number;
    }
  | { kind: "path"; d: string; fill?: string; stroke?: Stroke }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: Stroke }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: Stroke;
    }
  // Clickable link area (PDF link annotation, SVG <a>). The appearance is
  // handled by text(color) + line(underline), so this is a transparent hotspot.
  | { kind: "link"; x: number; y: number; w: number; h: number; href: string };

export interface SlideLir {
  id: string;
  width: number;
  height: number;
  background?: string;
  primitives: Primitive[];
}
