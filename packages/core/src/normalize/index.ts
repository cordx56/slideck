import type { MirDeck, MirFont, MirSlide } from "../ir/mir";
import type { LoadedDeck } from "../load/resolve-refs";
import { PipelineError } from "../lib/error";
import { composeLayers, mergeColors, pickBackground, resolveAppliedBases } from "./bases";
import { DEFAULT_SLIDE } from "./defaults";
import { mergeDefaults } from "./defaults-merge";
import { convertElement, SlideScope } from "./elements";
import { mergeSchemas } from "./schema-merge";
import { buildSystemVars } from "./system-vars";
import { resolveRichStyle, resolveTextDefaults } from "./text-style";
import { buildVarContext } from "./variables";

export interface NormalizeResult {
  deck?: MirDeck;
  errors: PipelineError[];
}

export function normalize(loaded: LoadedDeck): NormalizeResult {
  const errors: PipelineError[] = [];

  const fonts = buildFontRegistry(loaded);
  const slideSize = pickSlideSize(loaded);
  const slideCount = loaded.deck.slides.length;

  const slides: MirSlide[] = loaded.deck.slides.map((slide, index) => {
    const slideId = slide.id ?? `slide-${index + 1}`;
    const applied = resolveAppliedBases(loaded, slide, errors);

    const mergedVars = mergeSchemas(applied, errors);
    const mergedDefaults = mergeDefaults(applied);
    const colors = mergeColors(applied);

    const systemVars = buildSystemVars({
      slideId,
      slideNumber: index + 1,
      slideCount,
      baseIds: applied.map((base) => base.id),
    });
    const vars = buildVarContext(
      mergedVars,
      systemVars,
      colors,
      loaded.deck.vars,
      slide.vars,
      errors,
    );

    const textDefaults = resolveTextDefaults(mergedDefaults.text, vars, errors);
    const rich = resolveRichStyle(mergedDefaults, textDefaults, vars, errors);
    const scope = new SlideScope(vars, textDefaults, rich, errors);

    const composed = composeLayers(applied, slide);
    const elements = composed.map((element) => convertElement(element, scope));

    const backgroundValue = slide.background ?? pickBackground(applied);
    const background = backgroundValue ? scope.color(backgroundValue) : undefined;

    // id is optional. When unspecified, assign an index-derived id
    // (duplicate validation is already done in DeckSchema).
    return { id: slideId, background, elements };
  });

  return {
    deck: { slide: slideSize, fonts, slides },
    errors,
  };
}

// Aggregate font declarations from all bases. One entry per declared face,
// keyed by family (later declarations override earlier ones for the same
// family). Bold/italic faces are separate families and referenced from
// defaults.text.bold / .italic / .boldItalic.
export function buildFontRegistry(loaded: LoadedDeck): Map<string, MirFont> {
  const registry = new Map<string, MirFont>();
  for (const base of loaded.basesById.values()) {
    for (const [key, declaration] of Object.entries(base.fonts ?? {})) {
      // The YAML key IS the CSS family. defaults.text.family / .bold etc.
      // reference the same key. Last declaration wins for a given key.
      registry.set(key, {
        family: key,
        path: declaration.path,
        index: declaration.index,
      });
    }
  }
  return registry;
}

// Take the slide size from the first base with a slide, in deck.bases declaration order.
export function pickSlideSize(loaded: LoadedDeck): { width: number; height: number } {
  for (const reference of loaded.deck.bases) {
    const base = loaded.basesById.get(reference.id);
    if (base?.slide) return base.slide;
  }
  return DEFAULT_SLIDE;
}
