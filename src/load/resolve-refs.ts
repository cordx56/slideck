import { z } from "zod";
import type { AssetResolver } from "./assets";
import { resolveFrom } from "./assets";
import { parseAndValidate } from "./parse";
import { DeckSchema, ThemeSchema, ElementSchema } from "../schema";
import type { DeckHir, ThemeHir, HirElement } from "../ir/hir";
import { PipelineError } from "../lib/error";

export interface LoadedDeck {
  deck: DeckHir;
  // theme.name -> 解決済みテーマ (extends 適用後)
  themes: Map<string, ThemeHir>;
  // deck.theme で指定されたメインテーマ名
  defaultThemeName: string;
  overlays: HirElement[];
  resolver: AssetResolver;
}

export interface LoadResult {
  loaded?: LoadedDeck;
  errors: PipelineError[];
}

// overlay ファイルは要素の配列、または { elements: [...] }。
const OverlaySchema = z.union([
  z.array(ElementSchema),
  z.object({ elements: z.array(ElementSchema) }).strict(),
]);

// テーマの extends マージ。derived が base を上書きする。
function mergeTheme(base: ThemeHir, derived: ThemeHir): ThemeHir {
  return {
    name: derived.name,
    fonts: { ...base.fonts, ...derived.fonts },
    colors: { ...base.colors, ...derived.colors },
    slide: derived.slide ?? base.slide,
    background: derived.background ?? base.background,
    defaults: { text: { ...base.defaults?.text, ...derived.defaults?.text } },
    schema: { vars: { ...base.schema?.vars, ...derived.schema?.vars } },
    layout: derived.layout ?? base.layout,
  };
}

async function loadTheme(
  resolver: AssetResolver,
  path: string,
  seen: Set<string>,
  errors: PipelineError[],
): Promise<ThemeHir | undefined> {
  if (seen.has(path)) {
    errors.push(new PipelineError(`テーマの循環 extends を検出: ${path}`));
    return undefined;
  }
  seen.add(path);

  let text: string;
  try {
    text = await resolver.readText(path);
  } catch (e) {
    errors.push(new PipelineError(`テーマ読込失敗: ${path} (${String(e)})`));
    return undefined;
  }

  const parsed = parseAndValidate(text, ThemeSchema, path);
  if (!parsed.value) {
    errors.push(...parsed.errors);
    return undefined;
  }
  const theme = parsed.value;

  if (theme.extends) {
    const basePath = resolveFrom(path, theme.extends);
    const base = await loadTheme(resolver, basePath, seen, errors);
    if (!base) return undefined;
    return mergeTheme(base, theme);
  }
  return theme;
}

export async function loadDeck(
  resolver: AssetResolver,
  entry = "deck.yaml",
): Promise<LoadResult> {
  const errors: PipelineError[] = [];

  let deckText: string;
  try {
    deckText = await resolver.readText(entry);
  } catch (e) {
    return {
      errors: [new PipelineError(`deck 読込失敗: ${entry} (${String(e)})`)],
    };
  }

  const parsedDeck = parseAndValidate(deckText, DeckSchema, entry);
  if (!parsedDeck.value) return { errors: parsedDeck.errors };
  const deck = parsedDeck.value;

  if (!deck.theme) {
    return { errors: [new PipelineError("deck.theme (メインテーマ) が必要です")] };
  }

  const themes = new Map<string, ThemeHir>();
  const themePaths = [deck.theme, ...(deck.themes ?? [])];
  let defaultThemeName = "";

  for (const tp of themePaths) {
    const path = resolveFrom(entry, tp);
    const theme = await loadTheme(resolver, path, new Set(), errors);
    if (theme) {
      themes.set(theme.name, theme);
      if (tp === deck.theme) defaultThemeName = theme.name;
    }
  }

  const overlays: HirElement[] = [];
  for (const op of deck.overlays ?? []) {
    const path = resolveFrom(entry, op);
    try {
      const text = await resolver.readText(path);
      const parsed = parseAndValidate(text, OverlaySchema, path);
      if (parsed.value) {
        overlays.push(
          ...(Array.isArray(parsed.value) ? parsed.value : parsed.value.elements),
        );
      } else {
        errors.push(...parsed.errors);
      }
    } catch (e) {
      errors.push(new PipelineError(`overlay 読込失敗: ${path} (${String(e)})`));
    }
  }

  if (errors.length > 0) return { errors };

  return {
    loaded: { deck, themes, defaultThemeName, overlays, resolver },
    errors: [],
  };
}
