<script lang="ts">
  import LeftPane from "./LeftPane.svelte";
  import CenterPane from "./CenterPane.svelte";
  import RightPane from "./RightPane.svelte";
  import { store } from "../store.svelte";
  import { downloadBytes } from "../../lib/download";

  let exporting = $state(false);

  const errorTitle = $derived(store.errors.map((e) => e.message).join("\n"));

  async function exportPdf() {
    if (!store.compiled || exporting) return;
    exporting = true;
    try {
      const { renderPdf } = await import("../../render/pdf");
      const { bytes } = await renderPdf(store.compiled);
      downloadBytes(bytes, "slides.pdf", "application/pdf");
    } finally {
      exporting = false;
    }
  }

  function present() {
    location.hash = "#present";
  }
</script>

<div class="editor">
  <header class="topbar">
    <strong>Slider</strong>
    <span class="file">{store.entry}</span>
    {#if store.errors.length > 0}
      <span class="err" title={errorTitle}>⚠ {store.errors.length} エラー</span>
    {:else}
      <span class="ok">✓ OK</span>
    {/if}

    <span class="spacer"></span>

    <span class="nav">
      <button onclick={() => store.prev()} disabled={store.currentSlide === 0}
        >←</button
      >
      <span>{store.currentSlide + 1} / {store.slideCount}</span>
      <button
        onclick={() => store.next()}
        disabled={store.currentSlide >= store.slideCount - 1}>→</button
      >
    </span>
    <button onclick={present}>Present</button>
    <button onclick={exportPdf} disabled={exporting}>
      {exporting ? "出力中..." : "Export PDF"}
    </button>
  </header>

  <LeftPane />
  <CenterPane />
  <RightPane />
</div>

<style>
  .editor {
    display: grid;
    grid-template-columns: 240px 1fr 460px;
    grid-template-rows: 48px 1fr;
    height: 100vh;
  }
  .topbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }
  .file {
    color: var(--fg-dim);
    font-size: 0.85rem;
    font-family: ui-monospace, monospace;
  }
  .spacer {
    flex: 1;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
  }
  .err {
    color: var(--error);
    font-size: 0.8rem;
    cursor: help;
  }
  .ok {
    color: #9ece6a;
    font-size: 0.8rem;
  }
</style>
