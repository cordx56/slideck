<script lang="ts">
  import { store } from "../store.svelte";

  const slides = $derived(store.compiled?.deck.slides ?? []);
  const svg = $derived(store.renderSvg(store.currentSlide));

  let thumbEls = $state<HTMLButtonElement[]>([]);

  // サムネイル列にフォーカスがある時、左右キーでスライドを移動する。
  function onThumbKey(e: KeyboardEvent) {
    let target: number;
    if (e.key === "ArrowLeft") target = store.currentSlide - 1;
    else if (e.key === "ArrowRight") target = store.currentSlide + 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = store.slideCount - 1;
    else return;
    e.preventDefault();
    store.goSlide(target);
    // フォーカスを移動先サムネイルへ追従させる (連続移動 + 可視化)。
    thumbEls[store.currentSlide]?.focus();
  }
</script>

<div class="center">
  <div class="stage">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html svg}
  </div>

  <!-- keydown は内部のフォーカス中サムネイル button から委譲で受ける -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <nav class="thumbs" onkeydown={onThumbKey}>
    {#each slides as slide, i (slide.id)}
      <button
        bind:this={thumbEls[i]}
        class="thumb"
        class:active={i === store.currentSlide}
        onclick={() => store.goSlide(i)}
        title={slide.id}
      >
        <div class="thumb-svg">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html store.renderSvg(i)}
        </div>
        <span class="thumb-no">{i + 1}</span>
      </button>
    {/each}
  </nav>
</div>

<style>
  .center {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: #0b0b0f;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .stage :global(svg) {
    max-width: 100%;
    max-height: 100%;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  }
  .thumbs {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    overflow-x: auto;
    background: var(--bg);
  }
  .thumb {
    position: relative;
    flex: 0 0 auto;
    padding: 0;
    width: 132px;
    height: 74px;
    overflow: hidden;
    border: 2px solid var(--border);
    border-radius: 4px;
    background: #000;
  }
  /* キーボードフォーカスもマウス選択と同じ accent ボーダーで統一する */
  .thumb.active,
  .thumb:focus-visible {
    border-color: var(--accent);
  }
  .thumb:focus {
    outline: none;
  }
  .thumb-svg {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .thumb-svg :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .thumb-no {
    position: absolute;
    left: 4px;
    bottom: 2px;
    font-size: 11px;
    color: var(--fg);
    text-shadow: 0 0 4px #000;
  }
</style>
