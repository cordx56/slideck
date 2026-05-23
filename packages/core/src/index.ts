// @slideck/core — browser-independent slide compile/render pipeline.
// (PDF renderer pulls in the heavy pdf-lib, so it lives in "@slideck/core/pdf")

// Pipeline
export * from "./pipeline";

// Load/resolve
export * from "./load/assets";
export * from "./load/parse";
export * from "./load/references";
export * from "./load/resolve-refs";
export * from "./load/prepare";
export * from "./load/ttc";

// Schema / IR types
export * from "./schema";
export type * from "./ir";

// lower (position resolution/layout/shaping) and metrics
export { lower } from "./lower";
export * from "./lower/metrics";
export * from "./lower/fontkit-metrics";
export type * from "./lower/context";

// SVG renderer
export * from "./render/svg";

// Utilities
export * from "./lib/color";
export * from "./lib/error";
export * from "./lib/debounce";
export * from "./lib/event-bus";
export * from "./lib/base64";
export * from "./lib/mime";
export * from "./lib/image-size";
export * from "./lib/inline-math";
export * from "./lib/richtext";
export * from "./lib/math";

// YAML AST editing
export * from "./edit/ast";

// Path / VFS abstraction
export * from "./path";
export type * from "./vfs";
export * from "./vfs-http";
