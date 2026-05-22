import type { ThemeHir, SlideHir, HirElement } from "../ir/hir";
import type { LoadedDeck } from "../load/resolve-refs";
import { PipelineError } from "../lib/error";
import { appendOverlays } from "./overlays";

// スライドが使うテーマを決める。slide.use 未指定ならメインテーマ。
export function pickTheme(
  loaded: LoadedDeck,
  slide: SlideHir,
  errors: PipelineError[],
): ThemeHir {
  const name = slide.use ?? loaded.defaultThemeName;
  const theme = loaded.themes.get(name);
  if (theme) return theme;
  errors.push(
    new PipelineError(
      `スライド "${slide.id}" が未知のテーマ "${name}" を参照しています`,
    ),
  );
  // フォールバック: メインテーマ
  return (
    loaded.themes.get(loaded.defaultThemeName) ?? { name: loaded.defaultThemeName }
  );
}

// テーマ layout を下敷きに、スライド要素・オーバーレイを重畳する。
// 配列末尾ほど前面 (z-order)。
export function composeSlideElements(
  theme: ThemeHir,
  slide: SlideHir,
  overlays: HirElement[],
): HirElement[] {
  const base = [...(theme.layout ?? []), ...(slide.elements ?? [])];
  return appendOverlays(base, overlays);
}
