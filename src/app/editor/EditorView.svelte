<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import CenterPane from "./CenterPane.svelte";
  import RightPane from "./RightPane.svelte";
  import { store } from "../store.svelte";
  import Spinner from "../Spinner.svelte";
  import { downloadBytes } from "../../lib/download";
  import { handleGlobalShortcut } from "../keyboard/shortcuts";

  let exporting = $state(false);
  let zipInput: HTMLInputElement;

  const errorTitle = $derived(store.errors.map((e) => e.message).join("\n"));

  async function onZipPicked(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await store.importZip(file);
    } catch (err) {
      alert(`ZIP を開けませんでした: ${String(err)}`);
    }
    (e.target as HTMLInputElement).value = "";
  }

  function onKey(e: KeyboardEvent) {
    handleGlobalShortcut(e, {
      save: () => void store.save(),
      present,
      exportPdf: () => void exportPdf(),
    });
  }

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

<svelte:window on:keydown={onKey} />

<div class="editor">
  <header class="topbar">
    <button class="home" title="プロジェクト一覧" onclick={() => (location.hash = "")}>
      Slider
    </button>
    <span class="proj">{store.currentProject}</span>
    <span class="file">{store.openPath}{store.dirty ? " ●" : ""}</span>
    {#if store.errors.length > 0}
      <span class="err" title={errorTitle}>⚠ {store.errors.length} エラー</span>
    {:else}
      <span class="ok">✓ OK</span>
    {/if}

    <span class="spacer"></span>

    <button onclick={() => zipInput.click()} title="ZIP インポート">Import ZIP</button>
    <input
      bind:this={zipInput}
      type="file"
      accept=".zip"
      hidden
      onchange={onZipPicked}
    />
    <button onclick={() => store.exportZip()} title="プロジェクトを ZIP 出力">
      Export ZIP
    </button>
    <button onclick={() => store.save()} disabled={!store.dirty}>Save</button>

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
    <button class="pdf" onclick={exportPdf} disabled={exporting}>
      {#if exporting}<Spinner />{/if}
      {exporting ? "出力中..." : "Export PDF"}
    </button>
  </header>

  <FileTree />
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
  .home {
    font-weight: 700;
    background: transparent;
    border: none;
    padding: 4px 6px;
  }
  .home:hover {
    color: var(--accent);
  }
  .proj {
    font-size: 0.9rem;
    font-weight: 600;
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
  .pdf {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
