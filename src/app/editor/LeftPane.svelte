<script lang="ts">
  import { store } from "../store.svelte";
  import Inspector from "./Inspector.svelte";

  const slides = $derived(store.compiled?.deck.slides ?? []);
  // 現在スライドの編集可能なソース要素 (AST 由来)。
  const sourceEls = $derived(store.sourceElements);

  function trim(s: string): string {
    return s.length > 22 ? s.slice(0, 22) + "…" : s;
  }
</script>

<aside class="left">
  <section>
    <h2>追加</h2>
    <div class="palette">
      {#each [["Text", "text"], ["Image", "image"], ["Rect", "rect"], ["Group", "group"]] as [labelText, kind] (kind)}
        <button onclick={() => store.addElement(kind)}>+ {labelText}</button>
      {/each}
    </div>
  </section>

  <section>
    <h2>スライド</h2>
    {#each slides as slide, i (slide.id)}
      <button
        class="slide-head"
        class:active={i === store.currentSlide}
        onclick={() => store.goSlide(i)}
      >
        <span class="idx">{i + 1}</span>
        {slide.id}
      </button>
    {/each}
  </section>

  <section>
    <h2>要素 (このスライド)</h2>
    {#if sourceEls.length === 0}
      <p class="empty">ソース要素なし (テーマ layout のみ)</p>
    {/if}
    {#each sourceEls as el (el.index)}
      <button
        class="el-row"
        class:active={el.index === store.selectedIndex}
        onclick={() => store.selectElement(el.index)}
      >
        <span class="type">{el.type}</span>
        <span class="lbl">{trim(el.summary)}</span>
      </button>
    {/each}
  </section>

  {#if store.selectedRef}
    <section>
      <h2>インスペクタ</h2>
      <Inspector />
    </section>
  {/if}
</aside>

<style>
  .left {
    height: 100%;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--bg-2);
    font-size: 0.85rem;
  }
  section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-dim);
  }
  .palette {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .palette button {
    font-size: 0.8rem;
    padding: 5px;
  }
  .slide-head,
  .el-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 5px 6px;
    color: var(--fg-dim);
  }
  .slide-head.active,
  .el-row.active {
    background: rgba(122, 162, 247, 0.12);
    color: var(--accent);
  }
  .idx {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    background: var(--bg-3);
    font-size: 0.7rem;
    color: var(--fg-dim);
  }
  .el-row .type {
    color: var(--accent);
    font-family: ui-monospace, monospace;
    font-size: 0.76rem;
  }
  .el-row .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    margin: 0;
    color: var(--fg-dim);
    font-size: 0.78rem;
  }
</style>
