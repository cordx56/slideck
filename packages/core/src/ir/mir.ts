// MIR: the normalized slide model.
// Theme applied, variables expanded, defaults applied; colors are hex, fonts are family names.
// position is still a Dimension (% / px / center), group hierarchy is preserved.
import type { Position, Point, Dimension } from "../schema/position";
import type { Align, Fit, LayoutDir, CrossAlign, Justify, RichStyle } from "./hir";

export interface MirText {
  type: "text";
  position?: Position;
  flex?: number;
  text: string;
  font: string;
  size: number;
  color: string;
  align: Align;
  lineHeight: number;
  letterSpacing: number;
  // inline Markdown link/code styles (for richtext).
  rich?: RichStyle;
}

export interface MirImage {
  type: "image";
  position?: Position;
  flex?: number;
  src: string;
  fit: Fit;
}

export interface MirRect {
  type: "rect";
  position?: Position;
  flex?: number;
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  rx: number;
}

export interface MirLine {
  type: "line";
  flex?: number;
  from: Point;
  to: Point;
  stroke: string;
  strokeWidth: number;
}

export interface MirPath {
  type: "path";
  position?: Position;
  flex?: number;
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth: number;
}

// Circle inscribed in the position box (centred, r = min(w, h) / 2).
export interface MirCircle {
  type: "circle";
  position?: Position;
  flex?: number;
  fill?: string;
  stroke?: string;
  strokeWidth: number;
}

// Line with a filled-triangle arrowhead at `to`.
export interface MirArrow {
  type: "arrow";
  flex?: number;
  from: Point;
  to: Point;
  stroke: string;
  strokeWidth: number;
  arrowSize: number;
}

export interface MirGroup {
  type: "group";
  position?: Position;
  flex?: number;
  children: MirElement[];
  layout?: LayoutDir;
  gap: Dimension;
  align: CrossAlign;
  justify: Justify;
  padding: Dimension;
}

export interface MirList {
  type: "ul" | "ol";
  position?: Position;
  flex?: number;
  items: MirElement[];
  gap: Dimension;
  align: CrossAlign;
  padding: Dimension;
  // marker (• / number) render style.
  font: string;
  size: number;
  color: string;
  start: number;
}

export type MirElement =
  | MirText
  | MirImage
  | MirRect
  | MirLine
  | MirCircle
  | MirArrow
  | MirPath
  | MirGroup
  | MirList;

export interface MirFont {
  family: string;
  path?: string;
  index?: number; // font index within a .ttc
}

export interface MirSlide {
  id: string;
  background?: string;
  elements: MirElement[];
}

export interface MirDeck {
  slide: { width: number; height: number };
  // family name -> font declaration
  fonts: Map<string, MirFont>;
  slides: MirSlide[];
}
