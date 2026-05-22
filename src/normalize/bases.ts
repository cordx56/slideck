import type { BaseHir, SlideHir, HirElement } from "../ir/hir";
import type { LoadedDeck } from "../load/resolve-refs";
import { PipelineError } from "../lib/error";

export interface AppliedBase {
  id: string;
  base: BaseHir;
}

// use を配列に正規化する (未指定は空配列 = always base のみ)。
export function normalizeUse(use: string | string[] | undefined): string[] {
  if (use === undefined) return [];
  return Array.isArray(use) ? use : [use];
}

// スライドに適用される base を順序付きで決める。
// always:true 群 (宣言順) の後ろに use 群 (指定順) を積む。
export function resolveAppliedBases(
  loaded: LoadedDeck,
  slide: SlideHir,
  errors: PipelineError[],
): AppliedBase[] {
  const alwaysIds = loaded.deck.bases.filter((b) => b.always).map((b) => b.id);
  const useIds = normalizeUse(slide.use);

  // always と use の二重適用は許容するが警告する。
  for (const id of useIds) {
    if (alwaysIds.includes(id)) {
      errors.push(
        new PipelineError(
          `base "${id}" が always と use で二重適用されています (スライド "${slide.id ?? "(id 未指定)"}")`,
        ),
      );
    }
  }

  const applied: AppliedBase[] = [];
  for (const id of [...alwaysIds, ...useIds]) {
    const base = loaded.basesById.get(id);
    if (!base) {
      errors.push(new PipelineError(`未知の base id: "${id}"`));
      continue;
    }
    applied.push({ id, base });
  }
  return applied;
}

// z-order に従って layout 要素を積む (base 群 -> slide.elements)。
export function composeLayers(
  applied: AppliedBase[],
  slide: SlideHir,
): HirElement[] {
  const out: HirElement[] = [];
  for (const { base } of applied) out.push(...(base.layout ?? []));
  out.push(...(slide.elements ?? []));
  return out;
}

// 適用 base の colors をマージ (後勝ち)。
export function mergePalette(applied: AppliedBase[]): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const { base } of applied) Object.assign(palette, base.colors);
  return palette;
}

// 適用 base の fonts キー -> family をマージ (後勝ち)。
export function mergeFontKeys(applied: AppliedBase[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const { base } of applied) {
    for (const [key, decl] of Object.entries(base.fonts ?? {})) {
      m.set(key, decl.family);
    }
  }
  return m;
}

// 適用 base の background を後勝ちで採る (最前面 base 優先)。
export function pickBackground(applied: AppliedBase[]): string | undefined {
  let bg: string | undefined;
  for (const { base } of applied) if (base.background) bg = base.background;
  return bg;
}
