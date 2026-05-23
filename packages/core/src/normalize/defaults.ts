import type { Align, TextDefaults } from "../ir/hir";

export const DEFAULT_SLIDE = { width: 1920, height: 1080 };

// テキスト系の最終フォールバック。theme.defaults.text が無い項目に適用する。
export const TEXT_FALLBACK = {
  family: "sans-serif",
  size: 36,
  color: "#000000",
  align: "left" as Align,
  lineHeight: 1.2,
  letterSpacing: 0,
};

export interface ResolvedTextDefaults {
  family: string;
  size: number;
  color: string;
  align: Align;
  lineHeight: number;
  letterSpacing: number;
}

// theme.defaults.text とフォールバックをマージした、欠落のないデフォルト。
// family/color はまだキーの可能性がある (font/color 解決は呼び出し側)。
export function resolveTextDefaults(
  td: TextDefaults | undefined,
): ResolvedTextDefaults {
  return {
    family: td?.family ?? TEXT_FALLBACK.family,
    size: td?.size ?? TEXT_FALLBACK.size,
    color: td?.color ?? TEXT_FALLBACK.color,
    align: td?.align ?? TEXT_FALLBACK.align,
    lineHeight: td?.lineHeight ?? TEXT_FALLBACK.lineHeight,
    letterSpacing: td?.letterSpacing ?? TEXT_FALLBACK.letterSpacing,
  };
}

// auto-layout / 図形のフォールバック。
export const GROUP_FALLBACK = {
  align: "stretch" as const,
  justify: "start" as const,
};
export const DEFAULT_FIT = "contain" as const;
export const DEFAULT_STROKE_WIDTH = 1;
