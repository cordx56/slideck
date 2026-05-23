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

  // Left (FileTree) / right (CodeMirror) pane widths. Resizable by dragging the border, persisted in localStorage.
  const LW = "slideck:leftW";
  const RW = "slideck:rightW";
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const loadW = (k: string, d: number) => {
    const v = Number(localStorage.getItem(k));
    return v > 0 ? v : d;
  };
  let leftWidth = $state(loadW(LW, 240));
  let rightWidth = $state(loadW(RW, 460));

  function startResize(which: "left" | "right", e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (which === "left") leftWidth = clamp(startLeft + dx, 160, 600);
      else rightWidth = clamp(startRight - dx, 240, 800);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(LW, String(leftWidth));
      localStorage.setItem(RW, String(rightWidth));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  async function onZipPicked(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await store.importZip(file);
    } catch (err) {
      alert(`Could not open ZIP: ${String(err)}`);
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
      const { renderPdf } = await import("@slideck/core/pdf");
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

<div class="editor" style="grid-template-columns: {leftWidth}px 5px 1fr 5px {rightWidth}px">
  <header class="topbar">
    {#if store.serverMode}
      <span class="home" title="Disk-linked mode">slideck</span>
    {:else}
      <button class="home" title="Project list" onclick={() => (location.hash = "")}>
        slideck
      </button>
    {/if}
    <span class="proj">{store.currentProject}</span>
    <span class="file">{store.openPath}{store.dirty ? " ●" : ""}</span>
    {#if store.errors.length > 0}
      <span class="err" title={errorTitle}>⚠ {store.errors.length} errors</span>
    {:else}
      <span class="ok">✓ OK</span>
    {/if}

    <span class="spacer"></span>

    <button onclick={() => zipInput.click()} title="Import ZIP">Import ZIP</button>
    <input bind:this={zipInput} type="file" accept=".zip" hidden onchange={onZipPicked} />
    <button onclick={() => store.exportZip()} title="Export project as ZIP"> Export ZIP </button>

    <button onclick={present}>Present</button>
    <button class="pdf" onclick={exportPdf} disabled={exporting}>
      {#if exporting}<Spinner />{/if}
      {exporting ? "Exporting..." : "Export PDF"}
    </button>
  </header>

  <FileTree />
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="splitter"
    role="separator"
    aria-orientation="vertical"
    title="Drag to resize"
    onpointerdown={(e) => startResize("left", e)}
  ></div>
  <CenterPane />
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="splitter"
    role="separator"
    aria-orientation="vertical"
    title="Drag to resize"
    onpointerdown={(e) => startResize("right", e)}
  ></div>
  <RightPane />
</div>

<style>
  .editor {
    display: grid;
    /* grid-template-columns is set inline (variable width) */
    grid-template-rows: 48px 1fr;
    height: 100vh;
  }
  .splitter {
    cursor: col-resize;
    background: var(--border);
    transition: background 0.15s;
  }
  .splitter:hover {
    background: var(--accent);
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
