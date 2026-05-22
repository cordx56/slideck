<script lang="ts">
  import { store } from "../store.svelte";

  const slides = $derived(store.compiled?.deck.slides ?? []);
  const svg = $derived(store.renderSvg(store.currentSlide));
</script>

<div class="center">
  <div class="stage">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html svg}
  </div>

  <nav class="thumbs">
    {#each slides as slide, i (slide.id)}
      <button
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
  .thumb.active {
    border-color: var(--accent);
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
