<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createEditor, type EditorHandle } from "./codemirror-setup";
  import { store } from "../store.svelte";

  let host: HTMLDivElement;
  let handle: EditorHandle | undefined;

  onMount(() => {
    handle = createEditor({
      parent: host,
      doc: store.yamlText,
      onChange: (t) => store.setYaml(t),
    });
  });
  onDestroy(() => handle?.destroy());
</script>

<div class="right" bind:this={host}></div>

<style>
  .right {
    height: 100%;
    overflow: hidden;
    border-left: 1px solid var(--border);
    background: var(--bg-2);
  }
</style>
