// @slideck/core — ブラウザ非依存のスライドコンパイル/レンダリングパイプライン。
// (PDF レンダラは重い pdf-lib を含むため "@slideck/core/pdf" に分離している)

// パイプライン
export * from "./pipeline";

// ロード/解決
export * from "./load/assets";
export * from "./load/parse";
export * from "./load/references";
export * from "./load/resolve-refs";
export * from "./load/prepare";
export * from "./load/ttc";

// スキーマ / IR 型
export * from "./schema";
export type * from "./ir";

// lower (位置解決/レイアウト/シェイピング) とメトリクス
export { lower } from "./lower";
export * from "./lower/metrics";
export * from "./lower/fontkit-metrics";
export type * from "./lower/context";

// SVG レンダラ
export * from "./render/svg";

// ユーティリティ
export * from "./lib/color";
export * from "./lib/error";
export * from "./lib/debounce";
export * from "./lib/base64";
export * from "./lib/mime";
export * from "./lib/inline-math";
export * from "./lib/richtext";

// YAML AST 編集
export * from "./edit/ast";

// パス / VFS 抽象
export * from "./path";
export type * from "./vfs";
