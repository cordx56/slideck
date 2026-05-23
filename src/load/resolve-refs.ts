import type { AssetResolver } from "./assets";
import { resolveFrom } from "./assets";
import { parseAndValidate } from "./parse";
import { DeckSchema, BaseSchema } from "../schema";
import type { DeckHir, BaseHir, HirElement } from "../ir/hir";
import { PipelineError } from "../lib/error";

// アセット参照 (image.src / font.path) を「宣言したファイルからの相対」で
// 絶対パス (root 相対) に解決する。${...} を含むものは変数展開後に委ねる。
function resolveRef(ref: string, fromFile: string): string {
  return ref.includes("${") ? ref : resolveFrom(fromFile, ref);
}

// 要素ツリーを走査して image.src を fromFile 基準に解決する (group 再帰)。
function resolveElementPaths(elements: HirElement[], fromFile: string): void {
  for (const el of elements) {
    if (el.type === "image") el.src = resolveRef(el.src, fromFile);
    else if (el.type === "group") resolveElementPaths(el.children, fromFile);
    else if (el.type === "ul" || el.type === "ol") resolveElementPaths(el.items, fromFile);
  }
}

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

  // フォントパス・レイアウト内画像をこの base ファイル基準で解決する。
  for (const decl of Object.values(base.fonts ?? {})) {
    decl.path = resolveRef(decl.path, path);
  }
  if (base.layout) resolveElementPaths(base.layout, path);

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

  // スライド要素内の画像を deck.yaml 基準で解決する。
  for (const slide of deck.slides) {
    if (slide.elements) resolveElementPaths(slide.elements, entry);
  }

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
