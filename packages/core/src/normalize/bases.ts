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
// Bases are applied in their declaration order (in deck.bases); a base is included
// when it is always:true or selected via use. use is only a switch, so it never
// reorders the bases (a use'd base keeps its declared position).
export function resolveAppliedBases(
  loaded: LoadedDeck,
  slide: SlideHir,
  errors: PipelineError[],
): AppliedBase[] {
  const useIds = normalizeUse(slide.use);

  // Double application via always and use is allowed but warned.
  for (const b of loaded.deck.bases) {
    if (b.always && useIds.includes(b.id)) {
      errors.push(
        new PipelineError(
          `base "${b.id}" is applied twice via always and use (slide "${slide.id ?? "(id unspecified)"}")`,
        ),
      );
    }
  }

  // Error on use ids that do not refer to a declared base.
  for (const id of useIds) {
    if (!loaded.basesById.has(id)) {
      errors.push(new PipelineError(`unknown base id: "${id}"`));
    }
  }

  const applied: AppliedBase[] = [];
  for (const b of loaded.deck.bases) {
    if (!(b.always || useIds.includes(b.id))) continue;
    const base = loaded.basesById.get(b.id);
    if (base) applied.push({ id: b.id, base });
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
