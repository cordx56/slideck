import type { AssetResolver } from "./assets";
import { resolveFrom } from "./assets";
import { parseAndValidate } from "./parse";
import { DeckSchema, BaseSchema } from "../schema";
import type { DeckHir, BaseHir } from "../ir/hir";
import { PipelineError } from "../lib/error";

export interface LoadedDeck {
  deck: DeckHir;
  // base id -> 解決済み base (extends 適用後)。順序/always は deck.bases を参照。
  basesById: Map<string, BaseHir>;
  resolver: AssetResolver;
}

export interface LoadResult {
  loaded?: LoadedDeck;
  errors: PipelineError[];
}

// base の extends マージ。derived が base を上書きする。
function mergeBase(base: BaseHir, derived: BaseHir): BaseHir {
  return {
    name: derived.name ?? base.name,
    fonts: { ...base.fonts, ...derived.fonts },
    colors: { ...base.colors, ...derived.colors },
    slide: derived.slide ?? base.slide,
    background: derived.background ?? base.background,
    defaults: { text: { ...base.defaults?.text, ...derived.defaults?.text } },
    schema: { vars: { ...base.schema?.vars, ...derived.schema?.vars } },
    layout: derived.layout ?? base.layout,
  };
}

async function loadBaseFile(
  resolver: AssetResolver,
  path: string,
  seen: Set<string>,
  errors: PipelineError[],
): Promise<BaseHir | undefined> {
  if (seen.has(path)) {
    errors.push(new PipelineError(`base の循環 extends を検出: ${path}`));
    return undefined;
  }
  seen.add(path);

  let text: string;
  try {
    text = await resolver.readText(path);
  } catch (e) {
    errors.push(new PipelineError(`base 読込失敗: ${path} (${String(e)})`));
    return undefined;
  }

  const parsed = parseAndValidate(text, BaseSchema, path);
  if (!parsed.value) {
    errors.push(...parsed.errors);
    return undefined;
  }
  const base = parsed.value;

  if (base.extends) {
    const parentPath = resolveFrom(path, base.extends);
    const parent = await loadBaseFile(resolver, parentPath, seen, errors);
    if (!parent) return undefined;
    return mergeBase(parent, base);
  }
  return base;
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

  // 各 base ファイルを読み込み id でマップ化する。
  const basesById = new Map<string, BaseHir>();
  for (const ref of deck.bases) {
    const path = resolveFrom(entry, ref.file);
    const base = await loadBaseFile(resolver, path, new Set(), errors);
    if (base) basesById.set(ref.id, base);
  }

  if (errors.length > 0) return { errors };

  return { loaded: { deck, basesById, resolver }, errors: [] };
}
