import type { FontMetrics } from "./metrics";

// Preloaded resources needed during lower.
// Image bytes and font metrics are gathered asynchronously in the prepare phase,
// keeping lower itself a sync, pure function (for testability).
export interface LoadedImage {
  data: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

// Faces auto-detected by prepare for the inline richtext roles (from the
// fonts' post / OS-2 / head tables). "" means no face matched. A role declared
// explicitly in defaults (MirText.rich) always takes precedence; see
// resolveRichStyle in ./text-style.
export interface FontRoles {
  mono: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

export const EMPTY_FONT_ROLES: Readonly<FontRoles> = {
  mono: "",
  bold: "",
  italic: "",
  boldItalic: "",
};

export interface LowerCtx {
  metrics: FontMetrics;
  images: Map<string, LoadedImage>;
  roles: Readonly<FontRoles>;
  // Slide (drawing area) size. Percentage gap/padding resolve against this:
  // horizontal lengths against the width, vertical lengths against the height.
  slide: { width: number; height: number };
}

// Loaded font bytes used for PDF embedding and SVG preview registration.
// One LoadedFont per declared face; the family identifies the face uniquely.
export interface LoadedFont {
  family: string;
  bytes: Uint8Array;
}
