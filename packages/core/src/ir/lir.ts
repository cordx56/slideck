// LIR: レンダリングプリミティブの平坦リスト。
// グループ展開済み、絶対座標 (px, スライド左上原点)、テキストはシェイプ済み。
import type { Align, RichStyle } from "./hir";

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
      // インライン数式 ($...$) を含むテキスト。SVG は KaTeX を foreignObject で
      // 描画、PDF は runs (素テキスト) を描画する。
      kind: "richtext";
      x: number;
      y: number;
      w: number;
      h: number;
      raw: string; // $...$ を含む元テキスト
      runs: TextRun[]; // 素テキストをシェイプ済み (PDF/フォールバック用)
      align: Align;
      font: FontRef;
      size: number;
      color: string;
      lineHeight: number;
      rich: RichStyle; // リンク/コードのスタイル
    }
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
