// Ties together the steps from YAML project to a renderable deck.
// parse/normalize/lower are synchronous and pure; only prepare does async IO.
import type { AssetResolver } from "./load/assets";
import type { MirDeck } from "./ir/mir";
import type { SlideLir } from "./ir/lir";
import type { LowerCtx, LoadedFont } from "./lower/context";
import { loadDeck } from "./load/resolve-refs";
import { normalize } from "./normalize";
import { prepare } from "./load/prepare";
import { lower } from "./lower";
import { renderSvgString, type SvgRenderOptions } from "./render/svg";
import { PipelineError } from "./lib/error";

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

// Load the project and build MIR plus the resources needed for lower.
export async function compileDeck(
  resolver: AssetResolver,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const loaded = await loadDeck(resolver, options.entry ?? "deck.yaml");
  if (!loaded.loaded) return { errors: loaded.errors };

  const normalized = normalize(loaded.loaded);
  if (!normalized.deck) return { errors: normalized.errors };

  const errors = [...normalized.errors];
  const { ctx, fonts } = await prepare(normalized.deck, resolver, errors);

  return { compiled: { deck: normalized.deck, ctx, fonts }, errors };
}

export interface RecompileResult {
  deck?: MirDeck;
  errors: PipelineError[];
}

// Lightweight recompile for deck text edits. Skips prepare (font/image loading)
// and does only parse + normalize. The caller reuses the existing ctx/fonts.
export async function recompileDeck(
  resolver: AssetResolver,
  entry = "deck.yaml",
): Promise<RecompileResult> {
  const loaded = await loadDeck(resolver, entry);
  if (!loaded.loaded) return { errors: loaded.errors };
  const normalized = normalize(loaded.loaded);
  if (!normalized.deck) return { errors: normalized.errors };
  return { deck: normalized.deck, errors: normalized.errors };
}

// Lower the given slide to LIR.
export function lowerSlide(compiled: CompiledDeck, index: number): SlideLir | undefined {
  const slide = compiled.deck.slides[index];
  if (!slide) return undefined;
  return lower(slide, compiled.deck, compiled.ctx);
}

// Render the given slide to an SVG string.
export function renderSlideSvg(
  compiled: CompiledDeck,
  index: number,
  svgOptions?: SvgRenderOptions,
): string | undefined {
  const lir = lowerSlide(compiled, index);
  if (!lir) return undefined;
  return renderSvgString(lir, svgOptions);
}
