<script lang="ts">
  import { store } from "../store.svelte";

  const slides = $derived(store.compiled?.deck.slides ?? []);
  const svg = $derived(store.renderSvg(store.currentSlide));
  const aspect = $derived(store.slideAspect);

  let thumbEls = $state<HTMLButtonElement[]>([]);

  // Thumbnail strip height. Resizable by dragging its top edge, persisted in localStorage.
  const TH = "slideck:thumbH";
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  let thumbH = $state(Number(localStorage.getItem(TH)) || 100);

  function startThumbResize(e: PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = thumbH;
    const move = (ev: PointerEvent) => {
      thumbH = clamp(startH + (startY - ev.clientY), 64, 360);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(TH, String(thumbH));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  // When the thumbnail strip has focus, arrow keys move between slides.
  function onThumbKey(e: KeyboardEvent) {
    let target: number;
    if (e.key === "ArrowLeft") target = store.currentSlide - 1;
    else if (e.key === "ArrowRight") target = store.currentSlide + 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = store.slideCount - 1;
    else return;
    e.preventDefault();
    store.goSlide(target);
    // Move focus to the destination thumbnail (continuous nav + visibility).
    thumbEls[store.currentSlide]?.focus();
  }
</script>

<div class="center">
  <div class="stage">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html svg}
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="thumb-resizer"
    role="separator"
    aria-orientation="horizontal"
    title="Drag to resize"
    onpointerdown={startThumbResize}
  ></div>

  <!-- keydown is delegated from the focused thumbnail button inside -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <nav class="thumbs" style="height: {thumbH}px" onkeydown={onThumbKey}>
    {#each slides as slide, i (slide.id)}
      <button
        bind:this={thumbEls[i]}
        class="thumb"
        class:active={i === store.currentSlide}
        style="aspect-ratio: {aspect}"
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
  .thumb-resizer {
    flex: 0 0 auto;
    height: 6px;
    cursor: row-resize;
    background: var(--border);
    transition: background 0.15s;
  }
  .thumb-resizer:hover {
    background: var(--accent);
  }
  .thumbs {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--bg);
    box-sizing: border-box;
  }
  .thumb {
    position: relative;
    flex: 0 0 auto;
    padding: 0;
    height: 100%;
    width: auto;
    overflow: hidden;
    border: 2px solid var(--border);
    border-radius: 4px;
    background: #000;
  }
  /* unify keyboard focus with the same accent border as mouse selection */
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
    padding: 0 4px;
    font-size: 11px;
    color: #fff;
    background: #000;
    border-radius: 3px;
    box-shadow: 0 0 4px #000;
  }
</style>
