<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createEditor, type EditorHandle } from "./codemirror-setup";
  import { store } from "../store.svelte";

  let host: HTMLDivElement;
  let handle: EditorHandle | undefined;
  // インスペクタ等からのプログラム更新中は onChange を無視してループを防ぐ。
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

  // store.yamlText が外部 (インスペクタ書き戻し) で変わったらエディタに反映。
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

<div class="right" bind:this={host}></div>

<style>
  .right {
    height: 100%;
    overflow: hidden;
    border-left: 1px solid var(--border);
    background: var(--bg-2);
  }
</style>
