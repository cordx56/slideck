// YAML プロジェクト -> レンダリング可能なデッキ、までの一連を束ねる。
// parse/normalize/lower は同期純粋、prepare のみ非同期 IO。
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
  // family -> ロード済みフォント (PDF 埋め込み / プレビュー登録用)
  fonts: Map<string, LoadedFont>;
}

export interface CompileResult {
  compiled?: CompiledDeck;
  errors: PipelineError[];
}

export interface CompileOptions {
  entry?: string;
}

// プロジェクトを読み込み、MIR + lower 用リソースまで構築する。
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

// 指定スライドを LIR に下ろす。
export function lowerSlide(compiled: CompiledDeck, index: number): SlideLir | undefined {
  const slide = compiled.deck.slides[index];
  if (!slide) return undefined;
  return lower(slide, compiled.deck, compiled.ctx);
}

// 指定スライドを SVG 文字列にする。
export function renderSlideSvg(
  compiled: CompiledDeck,
  index: number,
  svgOptions?: SvgRenderOptions,
): string | undefined {
  const lir = lowerSlide(compiled, index);
  if (!lir) return undefined;
  return renderSvgString(lir, svgOptions);
}
