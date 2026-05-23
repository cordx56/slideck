// LIR: レンダリングプリミティブの平坦リスト。
// グループ展開済み、絶対座標 (px, スライド左上原点)、テキストはシェイプ済み。
// inline markdown/数式は lower で text/line/path に展開済み (専用 primitive は持たない)。
import type { Align } from "./hir";

export interface FontRef {
  family: string;
  weight?: number;
  style?: "normal" | "italic";
}

// シェイピング済みテキスト断片。x,y はベースライン基準の絶対座標。
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
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: Stroke;
    };

export interface SlideLir {
  id: string;
  width: number;
  height: number;
  background?: string;
  primitives: Primitive[];
}
