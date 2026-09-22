import type { AssetResolver } from "./assets";
import { parseAndValidate } from "./parse";
import { DeckSchema, BaseSchema } from "../schema";
import type { DeckHir, BaseHir, HirElement } from "../ir/hir";
import { walkElements } from "../ir/walk";
import { PipelineError } from "../lib/error";
import { resolvePath } from "../path";

// Resolve asset references (image.src / font.path) to an absolute path (root-relative),
// treating them as relative to the declaring file. Those with ${...} are deferred to
// after variable expansion.
function resolveRef(ref: string, fromFile: string): string {
  return ref.includes("${") ? ref : resolvePath(ref, fromFile);
}

// Walk the element tree and resolve image.src relative to fromFile.
function resolveElementPaths(elements: HirElement[], fromFile: string): void {
  walkElements(elements, (el) => {
    if (el.type === "image") el.src = resolveRef(el.src, fromFile);
  });
}

export interface LoadedDeck {
  deck: DeckHir;
  // base id -> resolved base (after applying extends). Order/always refer to deck.bases.
  basesById: Map<string, BaseHir>;
}

export interface LoadResult {
  loaded?: LoadedDeck;
  errors: PipelineError[];
}

// Merge base extends. derived overrides base.
function mergeBase(base: BaseHir, derived: BaseHir): BaseHir {
  return {
    name: derived.name ?? base.name,
    fonts: { ...base.fonts, ...derived.fonts },
    colors: { ...base.colors, ...derived.colors },
    slide: derived.slide ?? base.slide,
    background: derived.background ?? base.background,
    defaults: {
      text: { ...base.defaults?.text, ...derived.defaults?.text },
      link: { ...base.defaults?.link, ...derived.defaults?.link },
      mono: { ...base.defaults?.mono, ...derived.defaults?.mono },
    },
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
    errors.push(new PipelineError(`detected circular base extends: ${path}`));
    return undefined;
  }
  seen.add(path);

  let text: string;
  try {
    text = await resolver.readText(path);
  } catch (e) {
    errors.push(new PipelineError(`failed to load base: ${path} (${String(e)})`));
    return undefined;
  }

  const parsed = parseAndValidate(text, BaseSchema, path);
  if (!parsed.value) {
    errors.push(...parsed.errors);
    return undefined;
  }
  const base = parsed.value;

  // Resolve font paths and images in the layout relative to this base file.
  for (const decl of Object.values(base.fonts ?? {})) {
    decl.path = resolveRef(decl.path, path);
  }
  if (base.layout) resolveElementPaths(base.layout, path);

  if (base.extends) {
    const parentPath = resolvePath(base.extends, path);
    const parent = await loadBaseFile(resolver, parentPath, seen, errors);
    if (!parent) return undefined;
    return mergeBase(parent, base);
  }
  return base;
}

export async function loadDeck(resolver: AssetResolver, entry = "/deck.yaml"): Promise<LoadResult> {
  const errors: PipelineError[] = [];

  let deckText: string;
  try {
    deckText = await resolver.readText(entry);
  } catch (e) {
    return {
      errors: [new PipelineError(`failed to load deck: ${entry} (${String(e)})`)],
    };
  }

  const parsedDeck = parseAndValidate(deckText, DeckSchema, entry);
  if (!parsedDeck.value) return { errors: parsedDeck.errors };
  const deck = parsedDeck.value;

  // Resolve images in slide elements relative to deck.yaml.
  for (const slide of deck.slides) {
    if (slide.elements) resolveElementPaths(slide.elements, entry);
  }

  // Load each base file and map them by id.
  const basesById = new Map<string, BaseHir>();
  for (const ref of deck.bases) {
    const path = resolvePath(ref.file, entry);
    const base = await loadBaseFile(resolver, path, new Set(), errors);
    if (base) basesById.set(ref.id, base);
  }

  if (errors.length > 0) return { errors };

  return { loaded: { deck, basesById }, errors: [] };
}
