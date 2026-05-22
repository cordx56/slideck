import type { FontMetrics } from "./metrics";

// lower 時に必要な、事前ロード済みリソース。
// 画像バイトとフォントメトリクスは prepare フェーズで非同期に揃え、
// lower 自体は同期・純粋関数に保つ (テスト容易性のため)。
export interface LoadedImage {
  data: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface LowerCtx {
  metrics: FontMetrics;
  images: Map<string, LoadedImage>;
}

// PDF 埋め込み・SVG プレビュー登録に使う、ロード済みフォントバイト列。
export interface LoadedFont {
  family: string;
  bytes: Uint8Array;
  weight?: number;
  style?: "normal" | "italic";
}
