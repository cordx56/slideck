<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createEditor, type EditorHandle } from "./codemirror-setup";
  import FilePreview from "./FilePreview.svelte";
  import { store } from "../store.svelte";

  let host: HTMLDivElement;
  let handle: EditorHandle | undefined;
  // Ignore onChange during programmatic updates (e.g. file switch) to avoid loops.
  let applying = false;

  onMount(() => {
    handle = createEditor({
      parent: host,
      doc: store.yamlText,
      onChange: (t) => {
        if (!applying) store.setYaml(t);
      },
      ctx: () => ({ vfs: store.vfs, openPath: store.openPath }),
    });
  });
  onDestroy(() => handle?.destroy());

  // Reflect when store.yamlText changes externally (file switch / inspector).
  $effect(() => {
    const text = store.yamlText;
    if (!handle) return;
    if (handle.view.state.doc.toString() === text) return;
    applying = true;
    handle.view.dispatch({
      changes: { from: 0, to: handle.view.state.doc.length, insert: text },
    });
    applying = false;
  });
</script>

<div class="right">
  <!-- Always a single CodeMirror instance. Hidden for non-YAML, showing the preview instead. -->
  <div class="cm" class:hidden={!store.isYamlOpen} bind:this={host}></div>
  {#if !store.isYamlOpen}
    <FilePreview path={store.openPath} />
  {/if}
</div>

<style>
  .right {
    height: 100%;
    min-width: 0;
    overflow: hidden;
    background: var(--bg-2);
  }
  .cm {
    height: 100%;
    overflow: hidden;
  }
  .cm.hidden {
    display: none;
  }
</style>
