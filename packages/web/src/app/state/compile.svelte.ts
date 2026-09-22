import type { AssetResolver, LoadedFont, LowerCtx, MirDeck } from "@slideck/core";
import {
  collectBrokenReferences,
  compileDeck,
  debounce,
  loadAndNormalize,
  OverrideResolver,
  PipelineError,
  renderSlideSvg,
  walkElements,
  type CompiledDeck,
  type Reference,
} from "@slideck/core";
import { registerFonts } from "../../lib/fonts-register";
import * as document from "./document.svelte";
import * as files from "./files.svelte";
import * as project from "./project.svelte";

let compiled = $state.raw<CompiledDeck | null>(null);
let errors = $state.raw<PipelineError[]>([]);
let brokenRefs = $state.raw<Reference[]>([]);
let cachedCtx: LowerCtx | null = null;
let cachedFonts: Map<string, LoadedFont> | null = null;

export function compiledDeck(): CompiledDeck | null {
  return compiled;
}

export function pipelineErrors(): PipelineError[] {
  return errors;
}

export function brokenReferences(): Reference[] {
  return brokenRefs;
}

export function filesWithBrokenRefs(): Set<string> {
  return new Set(brokenRefs.map((reference) => reference.fromFile));
}

export function reportError(error: PipelineError): void {
  errors = [error];
}

function compileResolver(): AssetResolver {
  const base = project.requireVfs();
  if (document.isDirty() && document.isYamlOpen()) {
    return new OverrideResolver(base, new Map([[document.path(), document.text()]]));
  }
  return base;
}

export function clampSlide(): void {
  const count = slideCount();
  if (document.slide() >= count) document.setCurrentSlide(Math.max(0, count - 1));
}

export async function fullCompile(): Promise<void> {
  try {
    const result = await compileDeck(compileResolver(), { entry: project.ENTRY });
    errors = result.errors;
    if (result.compiled) {
      compiled = result.compiled;
      cachedCtx = result.compiled.ctx;
      cachedFonts = result.compiled.fonts;
      clampSlide();
      await registerFonts(result.compiled.fonts);
    }
  } catch (error) {
    reportError(new PipelineError(`compile failed: ${String(error)}`));
  }
}

export async function liveRecompile(): Promise<void> {
  if (!cachedCtx || !cachedFonts) {
    await fullCompile();
    return;
  }
  try {
    const result = await loadAndNormalize(compileResolver(), project.ENTRY);
    errors = result.errors;
    if (!result.deck) return;
    if (hasMissingAssets(result.deck)) {
      await fullCompile();
      return;
    }
    compiled = { deck: result.deck, ctx: cachedCtx, fonts: cachedFonts };
    clampSlide();
  } catch (error) {
    reportError(new PipelineError(`update failed: ${String(error)}`));
  }
}

export function hasMissingAssets(deck: MirDeck): boolean {
  const context = cachedCtx;
  const fonts = cachedFonts;
  if (!context || !fonts) return true;
  for (const key of deck.fonts.keys()) {
    if (!fonts.has(key)) return true;
  }
  let missingImage = false;
  for (const slide of deck.slides) {
    walkElements(slide.elements, (element) => {
      if (element.type === "image" && !context.images.has(element.src)) missingImage = true;
    });
    if (missingImage) return true;
  }
  return false;
}

export async function recomputeRefs(): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  try {
    brokenRefs = await collectBrokenReferences(
      vfs,
      document.path(),
      document.isDirty() ? document.text() : undefined,
    );
  } catch {
    // Transient file operations should not halt the update loop.
  }
}

export const scheduleLive = debounce(() => void liveRecompile(), 200);
export const scheduleFull = debounce(() => void fullCompile(), 200);
const scheduleRefs = debounce(() => void recomputeRefs(), 200);

export function renderSvg(index = document.slide()): string {
  if (!compiled) return "";
  return renderSlideSvg(compiled, index) ?? "";
}

export function slideCount(): number {
  return compiled ? compiled.deck.slides.length : 0;
}

export function slideAspect(): number {
  const size = compiled?.deck.slide;
  return size && size.height > 0 ? size.width / size.height : 16 / 9;
}

export async function reloadAfterPull(): Promise<void> {
  await document.reloadOpen();
  cachedCtx = null;
  cachedFonts = null;
  await fullCompile();
  await recomputeRefs();
}

document.setSlideCountProvider(slideCount);
document.onYamlChanged(() => {
  scheduleLive();
  scheduleRefs();
});
project.onVfsEvent(() => {
  if (document.isSelfSaving()) return;
  void files.refreshFiles();
  scheduleFull();
  scheduleRefs();
});
project.onProjectLoaded(async () => {
  cachedCtx = null;
  cachedFonts = null;
  await fullCompile();
  await recomputeRefs();
});
