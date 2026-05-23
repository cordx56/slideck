// HIR: ユーザ宣言をそのまま型付けしたもの。
// 変数 (${...}) 未展開、テーマ未適用、色/フォントはキーまたはリテラルのまま、
// position は % / px / center の Dimension のまま。
import type { Dimension, Position, Point } from "../schema/position";

export type Align = "left" | "center" | "right";
export type Fit = "contain" | "cover" | "fill";
export type LayoutDir = "row" | "column";
export type CrossAlign = "start" | "center" | "end" | "stretch";
export type Justify =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around";

export interface BaseElement {
  id?: string;
  position?: Position;
  // auto-layout の子要素における main-axis 比率配分
  flex?: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  font?: string;
  size?: number;
  color?: string;
  align?: Align;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  fit?: Fit;
}

export interface RectElement extends BaseElement {
  type: "rect";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rx?: number;
}

export interface LineElement extends BaseElement {
  type: "line";
  from: Point;
  to: Point;
  stroke?: string;
  strokeWidth?: number;
}

export interface PathElement extends BaseElement {
  type: "path";
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface GroupElement extends BaseElement {
  type: "group";
  children: HirElement[];
  layout?: LayoutDir;
  gap?: Dimension;
  align?: CrossAlign;
  justify?: Justify;
  padding?: Dimension;
  vars?: Record<string, unknown>;
}

export type HirElement =
  | TextElement
  | ImageElement
  | RectElement
  | LineElement
  | PathElement
  | GroupElement;

// テーマ -----------------------------------------------------------------

export interface FontDecl {
  path: string;
  family: string;
  weight?: number;
  style?: "normal" | "italic";
  index?: number; // .ttc 内のフォント番号
}

export type VarType =
  | "string"
  | "number"
  | "boolean"
  | "color"
  | "image"
  | "enum";

export interface VarDecl {
  type: VarType;
  required?: boolean;
  default?: unknown;
  values?: string[]; // enum 用
}

export interface TextDefaults {
  family?: string;
  size?: number;
  color?: string;
  align?: Align;
  lineHeight?: number;
  letterSpacing?: number;
}

// Base: theme と overlay を統合した合成可能レイヤー。
// 旧 theme.yaml と同じ構造。id は deck.bases 側で付与するため name は任意。
export interface BaseHir {
  name?: string;
  extends?: string;
  fonts?: Record<string, FontDecl>;
  colors?: Record<string, string>;
  slide?: { width: number; height: number };
  background?: string;
  defaults?: { text?: TextDefaults };
  schema?: { vars?: Record<string, VarDecl> };
  layout?: HirElement[];
}

// デッキ -----------------------------------------------------------------

// deck.yaml における base の宣言。
export interface BaseRef {
  id: string;
  always?: boolean; // true なら全スライドに自動適用 (旧 overlay 相当)
  file: string;
}

export interface SlideHir {
  id?: string;
  use?: string | string[];
  vars?: Record<string, unknown>;
  background?: string;
  elements?: HirElement[];
}

export interface DeckHir {
  bases: BaseRef[];
  vars?: Record<string, unknown>;
  slides: SlideHir[];
}

export type { Dimension, Position, Point };
