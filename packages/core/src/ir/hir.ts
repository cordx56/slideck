// HIR: the user declarations typed as-is.
// Variables (${...}) not expanded, theme not applied, colors/fonts left as keys or literals,
// position left as a % / px / center Dimension.
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
  // main-axis ratio distribution among auto-layout children
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

// ul (bulleted) / ol (numbered) list. A vertical-stack container like group,
// whose children are items. A marker (• / 1.) is drawn before each item.
export interface ListElement extends BaseElement {
  type: "ul" | "ol";
  items: HirElement[];
  gap?: Dimension;
  align?: CrossAlign;
  padding?: Dimension;
  // marker style (defaults to the text defaults when omitted).
  font?: string;
  size?: number;
  color?: string;
  start?: number; // ol start number (default 1)
}

export type HirElement =
  | TextElement
  | ImageElement
  | RectElement
  | LineElement
  | PathElement
  | GroupElement
  | ListElement;

// Theme ------------------------------------------------------------------

export interface FontDecl {
  path: string;
  family: string;
  weight?: number;
  style?: "normal" | "italic";
  index?: number; // font index within a .ttc
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
  values?: string[]; // for enum
}

export interface TextDefaults {
  family?: string;
  size?: number;
  color?: string;
  align?: Align;
  lineHeight?: number;
  letterSpacing?: number;
}

// inline Markdown link/code(mono) styles.
export interface LinkDefaults {
  color?: string;
  underline?: boolean;
}
export interface MonoDefaults {
  family?: string;
  color?: string;
}

// resolved richtext (link/code) styles.
export interface RichStyle {
  linkColor: string;
  linkUnderline: boolean;
  monoFamily: string;
  monoColor: string;
}

// Base: a composable layer merging theme and overlay.
// Same structure as the old theme.yaml. id is assigned on the deck.bases side, so name is optional.
export interface BaseHir {
  name?: string;
  extends?: string;
  fonts?: Record<string, FontDecl>;
  colors?: Record<string, string>;
  slide?: { width: number; height: number };
  background?: string;
  defaults?: { text?: TextDefaults; link?: LinkDefaults; mono?: MonoDefaults };
  schema?: { vars?: Record<string, VarDecl> };
  layout?: HirElement[];
}

// Deck -------------------------------------------------------------------

// base declaration in deck.yaml.
export interface BaseRef {
  id: string;
  always?: boolean; // if true, auto-applied to all slides (equivalent to the old overlay)
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
