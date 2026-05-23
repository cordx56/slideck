import type { BaseHir, SlideHir, HirElement } from "../ir/hir";
import type { LoadedDeck } from "../load/resolve-refs";
import { PipelineError } from "../lib/error";

export interface AppliedBase {
  id: string;
  base: BaseHir;
}

// Normalize use into an array (unspecified means empty array = always bases only).
export function normalizeUse(use: string | string[] | undefined): string[] {
  if (use === undefined) return [];
  return Array.isArray(use) ? use : [use];
}

// Determine the ordered bases applied to a slide.
// Stack the use group (in given order) after the always:true group (in declaration order).
export function resolveAppliedBases(
  loaded: LoadedDeck,
  slide: SlideHir,
  errors: PipelineError[],
): AppliedBase[] {
  const alwaysIds = loaded.deck.bases.filter((b) => b.always).map((b) => b.id);
  const useIds = normalizeUse(slide.use);

  // Double application via always and use is allowed but warned.
  for (const id of useIds) {
    if (alwaysIds.includes(id)) {
      errors.push(
        new PipelineError(
          `base "${id}" is applied twice via always and use (slide "${slide.id ?? "(id unspecified)"}")`,
        ),
      );
    }
  }

  const applied: AppliedBase[] = [];
  for (const id of [...alwaysIds, ...useIds]) {
    const base = loaded.basesById.get(id);
    if (!base) {
      errors.push(new PipelineError(`unknown base id: "${id}"`));
      continue;
    }
    applied.push({ id, base });
  }
  return applied;
}

// Stack layout elements by z-order (bases -> slide.elements).
export function composeLayers(applied: AppliedBase[], slide: SlideHir): HirElement[] {
  const out: HirElement[] = [];
  for (const { base } of applied) out.push(...(base.layout ?? []));
  out.push(...(slide.elements ?? []));
  return out;
}

// Merge colors of the applied bases (last wins). Injected as variables.
export function mergeColors(applied: AppliedBase[]): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const { base } of applied) Object.assign(colors, base.colors);
  return colors;
}

// Merge the fonts key -> family of the applied bases (last wins).
export function mergeFontKeys(applied: AppliedBase[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const { base } of applied) {
    for (const [key, decl] of Object.entries(base.fonts ?? {})) {
      m.set(key, decl.family);
    }
  }
  return m;
}

// Take the background of the applied bases with last wins (frontmost base preferred).
export function pickBackground(applied: AppliedBase[]): string | undefined {
  let bg: string | undefined;
  for (const { base } of applied) if (base.background) bg = base.background;
  return bg;
}
