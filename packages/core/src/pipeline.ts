// Ties together the steps from YAML project to a renderable deck.
// parse/normalize/lower are synchronous and pure; only prepare does async IO.
import type { AssetResolver } from "./load/assets";
import type { MirDeck } from "./ir/mir";
import type { SlideLir } from "./ir/lir";
import type { LowerCtx, LoadedFont } from "./lower/context";
import { loadDeck } from "./load/resolve-refs";
import { normalize, type NormalizeResult } from "./normalize";
import { prepare } from "./load/prepare";
import { lower } from "./lower";
import { renderSvgString, type SvgRenderOptions } from "./render/svg";
import { PipelineError } from "./lib/error";
import { dataUri } from "./lib/base64";

export interface CompiledDeck {
  deck: MirDeck;
  ctx: LowerCtx;
  // family -> loaded font (for PDF embedding / preview registration)
  fonts: Map<string, LoadedFont>;
}

export interface CompileResult {
  compiled?: CompiledDeck;
  errors: PipelineError[];
}

export interface CompileOptions {
  entry?: string;
}

export async function loadAndNormalize(
  resolver: AssetResolver,
  entry = "/deck.yaml",
): Promise<NormalizeResult> {
  const loaded = await loadDeck(resolver, entry);
  if (!loaded.loaded) return { errors: loaded.errors };
  return normalize(loaded.loaded);
}

// Load the project and build MIR plus the resources needed for lower.
export async function compileDeck(
  resolver: AssetResolver,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const normalized = await loadAndNormalize(resolver, options.entry);
  if (!normalized.deck) return { errors: normalized.errors };

  const errors = [...normalized.errors];
  const { ctx, fonts } = await prepare(normalized.deck, resolver, errors);

  return { compiled: { deck: normalized.deck, ctx, fonts }, errors };
}

export interface RenderSlideSvgOptions extends SvgRenderOptions {
  // Include every font used by the slide as a data URL for a standalone SVG.
  embedFonts?: boolean;
}

// Lower the given slide to LIR.
export function lowerSlide(compiled: CompiledDeck, index: number): SlideLir | undefined {
  const slide = compiled.deck.slides[index];
  if (!slide) return undefined;
  return lower(slide, compiled.deck, compiled.ctx);
}

export function lowerAllSlides(compiled: CompiledDeck): SlideLir[] {
  return compiled.deck.slides.map((slide) => lower(slide, compiled.deck, compiled.ctx));
}

export function usedFonts(compiled: CompiledDeck, lirs: SlideLir[]): Map<string, LoadedFont> {
  const usedFamilies = new Set<string>();
  for (const lir of lirs) {
    for (const primitive of lir.primitives) {
      if (primitive.kind !== "text") continue;
      for (const run of primitive.runs) usedFamilies.add(run.font.family);
    }
  }
  return new Map([...compiled.fonts].filter(([family]) => usedFamilies.has(family)));
}

// Render the given slide to an SVG string.
export function renderSlideSvg(
  compiled: CompiledDeck,
  index: number,
  svgOptions: RenderSlideSvgOptions = {},
): string | undefined {
  const lir = lowerSlide(compiled, index);
  if (!lir) return undefined;
  if (!svgOptions.embedFonts || svgOptions.fontFaces) return renderSvgString(lir, svgOptions);

  const fontFaces = [...usedFonts(compiled, [lir]).values()].map((font) => ({
    family: font.family,
    dataUrl: dataUri("font/ttf", font.bytes),
    format: "truetype",
  }));
  return renderSvgString(lir, { ...svgOptions, fontFaces });
}
