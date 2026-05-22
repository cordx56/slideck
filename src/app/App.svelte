<script lang="ts">
  import { onMount } from "svelte";
  import { FetchAssetResolver } from "../load/assets";
  import {
    compileDeck,
    renderSlideSvg,
    type CompiledDeck,
  } from "../pipeline";
  import { downloadBytes } from "../lib/download";
  import { registerFonts } from "../lib/fonts-register";
  import type { PipelineError } from "../lib/error";

  // Phase 1: サンプルを読み込み SVG プレビューする最小ビューア。
  // Phase 3 で 3 ペインエディタに置き換える。
  let compiled = $state<CompiledDeck | null>(null);
  let errors = $state<PipelineError[]>([]);
  let current = $state(0);
  let loading = $state(true);
  let exporting = $state(false);

  const slideCount = $derived(compiled ? compiled.deck.slides.length : 0);
  const svg = $derived(
    compiled ? (renderSlideSvg(compiled, current) ?? "") : "",
  );

  function go(delta: number) {
    if (!compiled) return;
    current = Math.max(0, Math.min(slideCount - 1, current + delta));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  }

  async function exportPdf() {
    if (!compiled || exporting) return;
    exporting = true;
    try {
      // pdf-lib は重いので必要時に動的ロードして初期バンドルから外す。
      const { renderPdf } = await import("../render/pdf");
      const { bytes, errors: pdfErrors } = await renderPdf(compiled);
      downloadBytes(bytes, "slides.pdf", "application/pdf");
      if (pdfErrors.length > 0) errors = pdfErrors;
    } finally {
      exporting = false;
    }
  }

  onMount(async () => {
    const base = `${import.meta.env.BASE_URL}examples/basic/`;
    const result = await compileDeck(new FetchAssetResolver(base));
    compiled = result.compiled ?? null;
    errors = result.errors;
    loading = false;
    if (compiled) await registerFonts(compiled.fonts);
  });
</script>

<svelte:window on:keydown={onKey} />

<main>
  <header>
    <strong>Slider</strong>
    <span class="dim">examples/basic</span>
    {#if compiled}
      <span class="nav">
        <button onclick={() => go(-1)} disabled={current === 0}>←</button>
        <span>{current + 1} / {slideCount}</span>
        <button onclick={() => go(1)} disabled={current >= slideCount - 1}
          >→</button
        >
        <button onclick={exportPdf} disabled={exporting}>
          {exporting ? "出力中..." : "Export PDF"}
        </button>
      </span>
    {/if}
  </header>

  {#if loading}
    <p class="status">読み込み中...</p>
  {:else if !compiled}
    <p class="status error">読み込みに失敗しました。</p>
  {:else}
    <div class="stage">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html svg}
    </div>
    <nav class="thumbs">
      {#each compiled.deck.slides as slide, i (slide.id)}
        <button
          class:active={i === current}
          onclick={() => (current = i)}
          title={slide.id}>{i + 1}</button
        >
      {/each}
    </nav>
  {/if}

  {#if errors.length > 0}
    <ul class="errors">
      {#each errors as err (err.message)}
        <li>{err.message}</li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  .dim {
    color: var(--fg-dim);
    font-size: 0.85rem;
  }
  .nav {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #0b0b0f;
  }
  .stage :global(svg) {
    max-width: 100%;
    max-height: 100%;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  }
  .thumbs {
    display: flex;
    gap: 6px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    overflow-x: auto;
  }
  .thumbs button.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .status {
    padding: 24px;
  }
  .errors {
    margin: 0;
    padding: 12px 32px;
    background: #2a1620;
    color: var(--error);
    font-size: 0.85rem;
    max-height: 30vh;
    overflow: auto;
  }
  .error {
    color: var(--error);
  }
</style>
