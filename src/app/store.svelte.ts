import type { AssetResolver } from "../load/assets";
import { CachingResolver, OverrideResolver, normalizePath } from "../load/assets";
import {
  compileDeck,
  recompileDeck,
  renderSlideSvg,
  type CompiledDeck,
} from "../pipeline";
import type { LowerCtx, LoadedFont } from "../lower/context";
import type { PipelineError } from "../lib/error";
import { debounce } from "../lib/debounce";
import { registerFonts } from "../lib/fonts-register";

// --- リアクティブ状態 (Runes) ---
let yamlText = $state("");
let compiled = $state.raw<CompiledDeck | null>(null); // 最後に成功した結果
let errors = $state.raw<PipelineError[]>([]);
let currentSlide = $state(0);
let ready = $state(false);
let entry = $state("deck.yaml");

// --- 非リアクティブな保持物 ---
let baseResolver: AssetResolver | null = null;
// フォント/画像は編集中に変わらない前提でキャッシュし、編集時は再ロードしない。
let cachedCtx: LowerCtx | null = null;
let cachedFonts: Map<string, LoadedFont> | null = null;

function overrideResolver(): AssetResolver {
  if (!baseResolver) throw new Error("store 未初期化");
  return new OverrideResolver(
    baseResolver,
    new Map([[normalizePath(entry), yamlText]]),
  );
}

function clampSlide() {
  const n = compiled ? compiled.deck.slides.length : 0;
  if (currentSlide >= n) currentSlide = Math.max(0, n - 1);
}

// 初回の完全コンパイル (フォント/画像ロードを含む)。
async function fullCompile() {
  const resolver = overrideResolver();
  const result = await compileDeck(resolver, { entry });
  errors = result.errors;
  if (result.compiled) {
    compiled = result.compiled;
    cachedCtx = result.compiled.ctx;
    cachedFonts = result.compiled.fonts;
    clampSlide();
    await registerFonts(result.compiled.fonts);
  }
}

// 編集時の軽量再コンパイル: parse + normalize のみ、ctx/fonts は再利用。
// 失敗時は前回成功した compiled を保持し、errors のみ更新する。
async function liveRecompile() {
  if (!cachedCtx || !cachedFonts) {
    await fullCompile();
    return;
  }
  const result = await recompileDeck(overrideResolver(), entry);
  errors = result.errors;
  if (result.deck) {
    compiled = { deck: result.deck, ctx: cachedCtx, fonts: cachedFonts };
    clampSlide();
  }
}

const scheduleRecompile = debounce(() => {
  void liveRecompile();
}, 200);

export const store = {
  get yamlText() {
    return yamlText;
  },
  get compiled() {
    return compiled;
  },
  get errors() {
    return errors;
  },
  get currentSlide() {
    return currentSlide;
  },
  set currentSlide(v: number) {
    currentSlide = v;
  },
  get ready() {
    return ready;
  },
  get entry() {
    return entry;
  },
  get slideCount() {
    return compiled ? compiled.deck.slides.length : 0;
  },

  async init(resolver: AssetResolver, entryPath = "deck.yaml") {
    baseResolver = new CachingResolver(resolver);
    entry = entryPath;
    yamlText = await baseResolver.readText(entryPath);
    cachedCtx = null;
    cachedFonts = null;
    await fullCompile();
    ready = true;
  },

  // エディタからのテキスト更新。即座に状態反映し、再コンパイルはデバウンス。
  setYaml(text: string) {
    yamlText = text;
    scheduleRecompile();
  },

  goSlide(i: number) {
    currentSlide = Math.max(0, Math.min(this.slideCount - 1, i));
  },
  next() {
    this.goSlide(currentSlide + 1);
  },
  prev() {
    this.goSlide(currentSlide - 1);
  },

  // 現在/指定スライドの SVG 文字列。
  renderSvg(index = currentSlide): string {
    if (!compiled) return "";
    return renderSlideSvg(compiled, index) ?? "";
  },
};
