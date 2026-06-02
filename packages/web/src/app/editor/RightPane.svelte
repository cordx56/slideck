<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createEditor, type EditorHandle } from "./codemirror-setup";
  import FilePreview from "./FilePreview.svelte";
  import { store } from "../store.svelte";

  let host: HTMLDivElement;
  let handle: EditorHandle | undefined;
  // Ignore onChange / onCursorChange during programmatic updates -- file
  // switches and slide-driven cursor jumps both run through dispatch() and
  // would otherwise feed back into the store and loop.
  let applying = false;

  onMount(() => {
    handle = createEditor({
      parent: host,
      doc: store.yamlText,
      onChange: (t) => {
        if (!applying) store.setYaml(t);
      },
      onCursorChange: (offset) => {
        if (!applying) store.cursorMoved(offset);
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

  // Drive the cursor when the slide preview jumps somewhere (thumbnail click,
  // arrow nav). The store sets editorCursorTarget and we consume + reset it.
  $effect(() => {
    const target = store.editorCursorTarget;
    if (target === null || !handle) return;
    const len = handle.view.state.doc.length;
    const pos = Math.max(0, Math.min(len, target));
    applying = true;
    handle.view.dispatch({
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
    });
    applying = false;
    // Consume the request so the next jump to the same slide re-fires.
    store.editorCursorTarget = null;
  });
</script>

<div class="right">
  <!-- A single CodeMirror instance for any text file (.yaml/.txt/.md/...); the
       preview shows for binary files (images, fonts, ...). -->
  <div class="cm" class:hidden={!store.isTextOpen} bind:this={host}></div>
  {#if !store.isTextOpen}
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
