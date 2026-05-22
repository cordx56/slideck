<script lang="ts">
  import LeftPane from "./LeftPane.svelte";
  import CenterPane from "./CenterPane.svelte";
  import RightPane from "./RightPane.svelte";
  import { store } from "../store.svelte";
  import { downloadBytes } from "../../lib/download";
  import { supportsFileSystemAccess } from "../../load/fs-access";

  let exporting = $state(false);
  let zipInput: HTMLInputElement;

  const errorTitle = $derived(store.errors.map((e) => e.message).join("\n"));
  const fsa = supportsFileSystemAccess();

  async function openFolder() {
    try {
      await store.openFolder();
    } catch (e) {
      alert(`フォルダを開けませんでした: ${String(e)}`);
    }
  }

  async function onZipPicked(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await store.openZipFile(file);
    } catch (err) {
      alert(`ZIP を開けませんでした: ${String(err)}`);
    }
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (store.canSave) void store.save();
    }
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
    <strong>Slider</strong>
    <span class="file">{store.projectName}{store.dirty ? " *" : ""}</span>
    {#if store.errors.length > 0}
      <span class="err" title={errorTitle}>⚠ {store.errors.length} エラー</span>
    {:else}
      <span class="ok">✓ OK</span>
    {/if}

    <span class="spacer"></span>

    {#if fsa}
      <button onclick={openFolder} title="ローカルフォルダを開く">Open Folder</button>
    {/if}
    <button onclick={() => zipInput.click()} title="ZIP を開く">Open ZIP</button>
    <input
      bind:this={zipInput}
      type="file"
      accept=".zip"
      hidden
      onchange={onZipPicked}
    />
    {#if store.canSave}
      <button onclick={() => store.save()} disabled={store.saving || !store.dirty}>
        {store.saving ? "保存中..." : "Save"}
      </button>
    {/if}
    {#if store.projectKind === "zip"}
      <button onclick={() => store.exportZip()}>Download ZIP</button>
    {/if}

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
