// MIR: 正規化済みスライドモデル。
// テーマ適用済み、変数展開済み、デフォルト適用済み、色は hex、フォントは family 名。
// position は依然 Dimension (% / px / center)、グループ階層は保持。
import type { Position, Point, Dimension } from "../schema/position";
import type { Align, Fit, LayoutDir, CrossAlign, Justify } from "./hir";

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

export type MirElement =
  | MirText
  | MirImage
  | MirRect
  | MirLine
  | MirPath
  | MirGroup;

export interface MirFont {
  family: string;
  path?: string;
  weight?: number;
  style?: "normal" | "italic";
  index?: number; // .ttc 内のフォント番号
}

export interface MirSlide {
  id: string;
  background?: string;
  elements: MirElement[];
}

export interface MirDeck {
  slide: { width: number; height: number };
  // family 名 -> フォント宣言
  fonts: Map<string, MirFont>;
  slides: MirSlide[];
}
