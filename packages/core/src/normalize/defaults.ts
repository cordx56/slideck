import type { Align, TextDefaults } from "../ir/hir";
import type { NumericValue } from "../schema/numeric";

export const DEFAULT_SLIDE = { width: 1920, height: 1080 };

// Final fallback for text. Applied to items missing from theme.defaults.text.
export const TEXT_FALLBACK = {
  family: "sans-serif",
  size: 36,
  color: "#000000",
  align: "left" as Align,
  lineHeight: 1.2,
  letterSpacing: 0,
};

// Numeric text-defaults can be a "${var}" reference (resolved later) or a
// literal number; the merge step only fills in the fallback when the field
// is *missing*, not based on type. The actual variable resolution is the
// caller's job (see resolveTextDefaultsFor in normalize/index.ts).
export interface MergedTextDefaults {
  family: string;
  size: NumericValue;
  color: string;
  align: Align;
  lineHeight: NumericValue;
  letterSpacing: NumericValue;
}

// Fully-resolved text defaults (after variable expansion). Values are plain
// numbers / strings ready for the rest of normalize.
export interface ResolvedTextDefaults {
  family: string;
  size: number;
  color: string;
  align: Align;
  lineHeight: number;
  letterSpacing: number;
}

// Merge theme.defaults.text with the fallback. ${var} references survive
// unchanged through this step -- they're resolved in resolveTextDefaultsFor.
export function mergeTextDefaults(td: TextDefaults | undefined): MergedTextDefaults {
  return {
    family: td?.family ?? TEXT_FALLBACK.family,
    size: td?.size ?? TEXT_FALLBACK.size,
    color: td?.color ?? TEXT_FALLBACK.color,
    align: td?.align ?? TEXT_FALLBACK.align,
    lineHeight: td?.lineHeight ?? TEXT_FALLBACK.lineHeight,
    letterSpacing: td?.letterSpacing ?? TEXT_FALLBACK.letterSpacing,
  };
}

// Fallback for auto-layout / shapes.
export const GROUP_FALLBACK = {
  align: "stretch" as const,
  justify: "start" as const,
};
export const DEFAULT_FIT = "contain" as const;
export const DEFAULT_STROKE_WIDTH = 1;
