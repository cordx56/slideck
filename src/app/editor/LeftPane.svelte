<script lang="ts">
  import { store } from "../store.svelte";
  import type { MirElement } from "../../ir/mir";

  const slides = $derived(store.compiled?.deck.slides ?? []);

  function label(el: MirElement): string {
    switch (el.type) {
      case "text":
        return el.text.length > 24 ? el.text.slice(0, 24) + "…" : el.text;
      case "image":
        return el.src;
      case "group":
        return el.layout ? `layout: ${el.layout}` : "";
      default:
        return "";
    }
  }
</script>

<aside class="left">
  <section>
    <h2>パレット</h2>
    <div class="palette">
      {#each ["Text", "Image", "Rect", "Group"] as kind (kind)}
        <button disabled title="インスペクタ書き戻しは Phase 5">+ {kind}</button>
      {/each}
    </div>
  </section>

  <section>
    <h2>アウトライン</h2>
    {#each slides as slide, i (slide.id)}
      <button
        class="slide-head"
        class:active={i === store.currentSlide}
        onclick={() => store.goSlide(i)}
      >
        <span class="idx">{i + 1}</span>
        {slide.id}
      </button>
      {#if i === store.currentSlide}
        <div class="tree">
          {#each slide.elements as el (el)}
            {@render node(el, 0)}
          {/each}
        </div>
      {/if}
    {/each}
  </section>
</aside>

{#snippet node(el: MirElement, depth: number)}
  <div class="node" style="padding-left:{8 + depth * 14}px">
    <span class="type">{el.type}</span>
    <span class="lbl">{label(el)}</span>
  </div>
  {#if el.type === "group"}
    {#each el.children as child (child)}
      {@render node(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

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
  .slide-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 5px 6px;
  }
  .slide-head.active {
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
  .tree {
    margin: 2px 0 8px;
  }
  .node {
    display: flex;
    gap: 6px;
    padding: 2px 0;
    color: var(--fg-dim);
    white-space: nowrap;
    overflow: hidden;
  }
  .type {
    color: var(--accent);
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
  }
  .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
